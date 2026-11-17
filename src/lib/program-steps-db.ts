/**
 * The whole-exercise check for endurance steps, run inside a plan write
 * (docs/plans/one-program-model.md, 1.1). A write that leaves a structured
 * exercise invalid throws, so the transaction rolls back.
 *
 * A strength exercise has no step rows; the first query finds none and the
 * check ends there.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, programs, users, workoutSessions, workoutSets } from "@/db/schema";
import { checkStepRows, plainSetsToStepRows, stepOfRow, stepProblemText, workoutToRows, type PlannedStepSnapshot, type StepRow } from "@/lib/utils/program-steps";
import type { Tx } from "@/lib/plan-revisions";
import type { Workout, WorkoutSport } from "@/lib/utils/workout-steps";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

type Executor = Pick<typeof db, "select">;

/** A write that would leave a structured exercise invalid. The message names the sets. */
export class StepRowsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepRowsError";
  }

  // Actions report String(err); the user reads the message alone.
  override toString(): string {
    return this.message;
  }
}

/** Throws StepRowsError when the exercise holds steps that break a rule. */
export async function assertStepRows(ex: Executor, programExerciseId: number): Promise<void> {
  const [any] = await ex
    .select({ id: programSets.id })
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNotNull(programSets.stepKind), isNull(programSets.deletedAt)))
    .limit(1);
  if (!any) return;

  // plan-read: includes deleted (the slot being written, for its sport and pool length)
  const [slot] = await ex
    .select({ discipline: exercises.discipline, poolLengthM: programExercises.poolLengthM, name: programs.name })
    .from(programExercises)
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(eq(programExercises.id, programExerciseId));
  const rows = await ex
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber), asc(programSets.id));
  const problems = checkStepRows(rows as StepRow[], {
    sport: (slot?.discipline ?? null) as WorkoutSport | null,
    name: slot?.name ?? "Session",
    poolLengthM: slot?.poolLengthM,
  });
  if (problems.length) throw new StepRowsError(stepProblemText(problems));
}

/**
 * The plan of one step row as a logged step keeps it, with the user's
 * threshold values now. Null when the row is not a step.
 */
export async function plannedStepSnapshot(ex: Executor, programSetId: number, userId: string): Promise<PlannedStepSnapshot | null> {
  const [row] = await ex
    .select({ set: programSets, discipline: exercises.discipline })
    // plan-read: includes deleted (a step removed mid-workout still logs with its plan)
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(eq(programSets.id, programSetId));
  if (!row?.discipline) return null;
  const step = stepOfRow(row.set as StepRow);
  if (!step) return null;
  const { thresholdValues } = await import("@/lib/session-compliance");
  return { v: 2, sport: row.discipline, step, blockId: row.set.blockId, blockRound: row.set.blockRound, thresholds: await thresholdValues(userId) };
}

/**
 * Replace an exercise's sets with a step tree, in a plan write's transaction
 * (docs/plans/one-program-model.md, step 4). Rows are matched by position, so
 * a step keeps its id (and the rows logged against it keep their link) while
 * its place stays; extra rows are added and left-over ones soft-deleted. A
 * row keeps its weekly-sync anchor and role only when it stays outside a
 * repeat block with the same kind of end, and its rest after the step stays
 * with its place. Throws StepRowsError when the
 * result breaks a rule.
 */
export async function replaceExerciseSteps(tx: Tx, programExerciseId: number, workout: Workout): Promise<void> {
  const next = workoutToRows(workout);
  const old = await tx
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber), asc(programSets.id));
  for (const [i, row] of next.entries()) {
    const prev = old[i];
    const keepsAnchor =
      prev != null &&
      row.blockId == null &&
      ((prev.peakDistanceMeters != null && row.distanceMeters != null) || (prev.peakDurationSeconds != null && row.durationSeconds != null));
    const values = {
      ...row,
      targetReps: null,
      repRangeMin: null,
      repRangeMax: null,
      weightKg: null,
      targetRir: null,
      startDelaySeconds: null,
      inclinePercent: null,
      targetHeartRateZone: null,
      setType: "working",
      // The tree has no rest after a step (a rest is a step of its own), so the
      // rest a row had stays with its place.
      restTimeSeconds: prev?.restTimeSeconds ?? 0,
      peakDistanceMeters: keepsAnchor && row.distanceMeters != null ? prev.peakDistanceMeters : null,
      peakDurationSeconds: keepsAnchor && row.durationSeconds != null ? prev.peakDurationSeconds : null,
      sessionRole: keepsAnchor ? prev.sessionRole : null,
    };
    if (prev) await tx.update(programSets).set(values).where(eq(programSets.id, prev.id));
    else await tx.insert(programSets).values({ ...values, programExerciseId });
  }
  const gone = old.slice(next.length).map((r) => r.id);
  if (gone.length) await tx.update(programSets).set({ deletedAt: new Date() }).where(inArray(programSets.id, gone));
  await tx.update(programExercises).set({ poolLengthM: workout.poolLengthM ?? null }).where(eq(programExercises.id, programExerciseId));
  await assertStepRows(tx, programExerciseId);
}

/**
 * A bike exercise of an endurance user always holds steps
 * (docs/plans/bike-ride-logger.md, D3). When every live set of the slot is a
 * plain set, they become steps in the plan write's transaction: each set keeps
 * its row (its id, its weekly-sync anchor and role when the end keeps its
 * kind), a zone stays a zone target, and a rest after a set becomes a rest
 * step. A slot of another sport, another user, no sets, or sets that are
 * already steps is left alone. Returns whether rows changed; throws
 * StepRowsError when a set fits no step.
 */
export async function bikeSetsToSteps(tx: Tx, programExerciseId: number): Promise<boolean> {
  // plan-read: includes deleted (the slot being written, for its sport and owner)
  const [slot] = await tx
    .select({ discipline: exercises.discipline, name: programs.name, userId: users.id, endurance: users.enduranceEnabled })
    .from(programExercises)
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .innerJoin(users, eq(users.id, programs.userId))
    .where(eq(programExercises.id, programExerciseId));
  if (slot?.discipline !== "bike" || !slot.endurance) return false;
  const old = await tx
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber), asc(programSets.id));
  if (old.length === 0 || old.some((r) => r.stepKind != null)) return false;
  const out = plainSetsToStepRows(old, { sport: "bike", name: slot.name });
  if ("error" in out) throw new StepRowsError(`These bike sets cannot become steps: ${out.error}`);
  const bySetNumber = new Map(old.map((r) => [r.setNumber, r]));
  for (const { from, ...row } of out.rows) {
    const prev = from != null ? bySetNumber.get(from) : undefined;
    const keepsDistance = prev?.peakDistanceMeters != null && row.distanceMeters != null;
    const keepsDuration = prev?.peakDurationSeconds != null && row.durationSeconds != null;
    const values = {
      ...row,
      targetReps: null,
      repRangeMin: null,
      repRangeMax: null,
      weightKg: null,
      targetRir: null,
      startDelaySeconds: null,
      inclinePercent: null,
      targetHeartRateZone: null,
      setType: "working",
      // The rest is a step of its own now; the workout screen would add the row's too.
      restTimeSeconds: 0,
      peakDistanceMeters: keepsDistance ? prev.peakDistanceMeters : null,
      peakDurationSeconds: keepsDuration ? prev.peakDurationSeconds : null,
      sessionRole: keepsDistance || keepsDuration ? prev.sessionRole : null,
    };
    if (!prev) {
      await tx.insert(programSets).values({ ...values, programExerciseId });
      continue;
    }
    await tx.update(programSets).set(values).where(eq(programSets.id, prev.id));
    // A rest step moves the sets after it; rows logged in an open workout move with their set.
    if (prev.setNumber !== row.setNumber) {
      const open = tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, slot.userId), eq(workoutSessions.isCompleted, false)));
      await tx
        .update(workoutSets)
        .set({ setNumber: row.setNumber })
        .where(and(eq(workoutSets.programSetId, prev.id), inArray(workoutSets.sessionId, open)));
    }
  }
  await assertStepRows(tx, programExerciseId);
  return true;
}

/** The end of every write to a slot's sets: plain bike sets become steps (D3), then the whole-exercise check. */
export async function settleStepRows(tx: Tx, programExerciseId: number): Promise<void> {
  if (!(await bikeSetsToSteps(tx, programExerciseId))) await assertStepRows(tx, programExerciseId);
}
