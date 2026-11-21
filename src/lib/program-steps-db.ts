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
import { EMPTY_STEP_FIELDS, checkStepRows, plainSetsToStepRows, stepOfRow, stepProblemText, workoutToRows, type PlannedStepSnapshot, type StepRow } from "@/lib/utils/program-steps";
import type { Tx } from "@/lib/plan-revisions";
import { WORKOUT_LIMITS, type Workout, type WorkoutSport } from "@/lib/utils/workout-steps";
import { and, asc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";

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
    .select({ discipline: exercises.discipline, poolLengthM: programExercises.poolLengthM, rideTest: programExercises.rideTest, name: programs.name })
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
    test: slot?.rideTest,
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
  const step = stepOfRow(row.set as StepRow, row.discipline);
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
      targetHeartRateZone: null,
      setType: "working",
      // The tree has no rest after a step (a rest is a step of its own), so the
      // rest a row had stays with its place. Not on a bike or a run: their rests
      // are rest steps, and the workout screen would run the row's too
      // (bike-ride-logger, step 1; run-logger, step 1). A run keeps the rest of
      // a plain set it replaces for a moment, and restsToSteps below moves it
      // to a rest step, so the editor's first save over plain sets keeps it.
      restTimeSeconds:
        workout.sport === "run" && prev?.stepKind == null && row.blockId == null
          ? (prev?.restTimeSeconds ?? 0)
          : workout.sport === "bike" || workout.sport === "run"
            ? 0
            : (prev?.restTimeSeconds ?? 0),
      peakDistanceMeters: keepsAnchor && row.distanceMeters != null ? prev.peakDistanceMeters : null,
      peakDurationSeconds: keepsAnchor && row.durationSeconds != null ? prev.peakDurationSeconds : null,
      sessionRole: keepsAnchor ? prev.sessionRole : null,
    };
    if (prev) await tx.update(programSets).set(values).where(eq(programSets.id, prev.id));
    else await tx.insert(programSets).values({ ...values, programExerciseId });
  }
  const gone = old.slice(next.length).map((r) => r.id);
  if (gone.length) await tx.update(programSets).set({ deletedAt: new Date() }).where(inArray(programSets.id, gone));
  await tx.update(programExercises).set({ poolLengthM: workout.poolLengthM ?? null, rideTest: workout.test ?? null }).where(eq(programExercises.id, programExerciseId));
  if (workout.sport === "run") {
    const slot = await stepSlot(tx, programExerciseId);
    if (slot) await restsToSteps(tx, programExerciseId, slot);
  }
  await assertStepRows(tx, programExerciseId);
}

/**
 * A workout on the program that is open and started in the last 10 hours.
 * An older open one is abandoned: the app's failsafe (closeStaleOpenSessions
 * in src/lib/actions/workout-sessions.ts) closes it after 10 hours too.
 */
export async function recentOpenWorkoutOn(ex: Executor, userId: string, programId: number): Promise<boolean> {
  const [row] = await ex
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.programId, programId),
        eq(workoutSessions.isCompleted, false),
        gte(workoutSessions.startTime, new Date(Date.now() - 10 * 60 * 60 * 1000)),
      ),
    )
    .limit(1);
  return !!row;
}

type StepSlot = { sport: "bike" | "run"; programId: number; name: string; userId: string; endurance: boolean };

/** The slot's sport, program and owner when it is a bike or run exercise, else null. */
async function stepSlot(tx: Tx, programExerciseId: number): Promise<StepSlot | null> {
  // plan-read: includes deleted (the slot being written, for its sport and owner)
  const [slot] = await tx
    .select({ discipline: exercises.discipline, programId: programs.id, name: programs.name, userId: users.id, endurance: users.enduranceEnabled })
    .from(programExercises)
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .innerJoin(users, eq(users.id, programs.userId))
    .where(eq(programExercises.id, programExerciseId));
  if (slot?.discipline !== "bike" && slot?.discipline !== "run") return null;
  return { ...slot, sport: slot.discipline };
}

const liveSlotSets = (tx: Tx, programExerciseId: number) =>
  tx
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber), asc(programSets.id));

/** Give a set a new position; rows logged against it in an open workout move with it. */
async function moveSet(tx: Tx, userId: string, programSetId: number, setNumber: number) {
  await tx.update(programSets).set({ setNumber }).where(eq(programSets.id, programSetId));
  const open = tx
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, false)));
  await tx
    .update(workoutSets)
    .set({ setNumber })
    .where(and(eq(workoutSets.programSetId, programSetId), inArray(workoutSets.sessionId, open)));
}

/**
 * Plain bike and run sets as steps (docs/plans/bike-ride-logger.md, D3;
 * docs/plans/run-logger.md, step 1), when every
 * live set of the slot is plain: each set keeps its row (its id, its
 * weekly-sync anchor and role when the end keeps its kind), a zone stays a
 * zone target, and a rest after a set becomes a rest step. Sets no step can
 * hold stay plain (logged, not thrown), so no later write to the slot fails
 * on them. Returns whether rows changed.
 */
async function plainSetsToSteps(tx: Tx, programExerciseId: number, slot: StepSlot): Promise<boolean> {
  const old = await liveSlotSets(tx, programExerciseId);
  if (old.length === 0 || old.some((r) => r.stepKind != null)) return false;
  const out = plainSetsToStepRows(old, { sport: slot.sport, name: slot.name });
  if ("error" in out) {
    console.warn("[settleStepRows] left plain", { programExerciseId, sport: slot.sport, problem: out.error });
    return false;
  }
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
    const { setNumber, ...rest } = values;
    await tx.update(programSets).set(rest).where(eq(programSets.id, prev.id));
    if (prev.setNumber !== setNumber) await moveSet(tx, slot.userId, prev.id, setNumber);
  }
  return true;
}

/**
 * A bike or run step has no rest of its own: the rest is the rest step after it. A
 * rest written on a step row (the rest editor, a drag, an assistant's set
 * list) goes to the rest step right after it, or a new one, and the row's
 * rest goes back to 0. A step inside a repeat keeps no rest, so its rounds
 * stay the same. Returns whether rows changed.
 */
async function restsToSteps(tx: Tx, programExerciseId: number, slot: StepSlot): Promise<boolean> {
  const rows = await liveSlotSets(tx, programExerciseId);
  if (rows.length === 0 || rows.some((r) => r.stepKind == null) || rows.every((r) => r.restTimeSeconds === 0)) return false;
  const order: ({ id: number; setNumber: number } | { rest: number })[] = [];
  for (const [i, r] of rows.entries()) {
    order.push({ id: r.id, setNumber: r.setNumber });
    if (r.restTimeSeconds <= 0) continue;
    await tx.update(programSets).set({ restTimeSeconds: 0 }).where(eq(programSets.id, r.id));
    if (r.blockId != null) continue;
    const seconds = Math.max(WORKOUT_LIMITS.seconds.min, r.restTimeSeconds);
    const next = rows[i + 1];
    if (next?.stepKind === "rest" && next.blockId == null) {
      await tx.update(programSets).set({ durationSeconds: seconds, distanceMeters: null, endsOnLap: false }).where(eq(programSets.id, next.id));
    } else {
      order.push({ rest: seconds });
    }
  }
  for (const [i, e] of order.entries()) {
    if ("rest" in e) {
      await tx.insert(programSets).values({
        ...EMPTY_STEP_FIELDS,
        programExerciseId,
        setNumber: i + 1,
        stepKind: "rest",
        durationSeconds: e.rest,
        targetReps: null,
        weightKg: null,
        restTimeSeconds: 0,
      });
    } else if (e.setNumber !== i + 1) {
      await moveSet(tx, slot.userId, e.id, i + 1);
    }
  }
  return true;
}

/**
 * The end of every write to a slot's sets. For a bike or run slot
 * (docs/plans/bike-ride-logger.md, D3; docs/plans/run-logger.md, step 1):
 * plain sets of an endurance user become steps, unless a workout runs on the
 * program (the slot then stays plain until it ends, so the screen never
 * changes under the athlete), and a rest on a step row moves to a rest step.
 * Then the whole-exercise check. Returns whether these rules changed rows.
 */
export async function settleStepRows(tx: Tx, programExerciseId: number): Promise<boolean> {
  const slot = await stepSlot(tx, programExerciseId);
  let changed = false;
  if (slot) {
    if (slot.endurance && !(await recentOpenWorkoutOn(tx, slot.userId, slot.programId))) {
      changed = await plainSetsToSteps(tx, programExerciseId, slot);
    }
    changed = (await restsToSteps(tx, programExerciseId, slot)) || changed;
  }
  await assertStepRows(tx, programExerciseId);
  return changed;
}
