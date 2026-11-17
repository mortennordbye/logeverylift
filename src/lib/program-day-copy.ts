/**
 * One-day program copies (docs/plans/one-program-model.md, decision 2).
 *
 * A dated session that changes for that day only runs its own copy of the
 * program, so the template and the other days keep theirs. Only an
 * endurance-only program is copied: strength progression reads its history by
 * program, and a copy would start a lifter with none. A copy is hidden from
 * program lists (`listedPrograms`) and soft-deleted when its session goes
 * back to the template, runs another program, or is removed.
 *
 * Runs inside a plan write's transaction.
 */

import { exercises, programExercises, programSets, programs } from "@/db/schema";
import { PlanStateError, type PlanWriteSession } from "@/lib/plan-revisions";
import { assertStepRows, settleStepRows } from "@/lib/program-steps-db";
import { workoutToRows } from "@/lib/utils/program-steps";
import type { Workout } from "@/lib/utils/workout-steps";
import { and, asc, eq, isNull } from "drizzle-orm";

/** The program a session runs as its own copy, or a new copy of it. Returns the copy's id. */
export async function copyProgramForDay(w: PlanWriteSession, userId: string, sessionId: number, programId: number): Promise<number> {
  const tx = w.tx;
  const [program] = await tx.select().from(programs).where(and(eq(programs.id, programId), eq(programs.userId, userId), isNull(programs.deletedAt)));
  if (!program) throw new PlanStateError("Program not found");
  if (program.forPlannedSessionId === sessionId) return program.id;
  const slots = await tx
    .select({ pe: programExercises, discipline: exercises.discipline })
    .from(programExercises)
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(programExercises.programId, programId), isNull(programExercises.deletedAt)))
    .orderBy(asc(programExercises.orderIndex), asc(programExercises.id));
  if (!slots.length || slots.some((s) => s.discipline == null)) {
    throw new PlanStateError("Only a swim, bike or run program can change for one day. A strength day changes the program itself.");
  }
  const [copy] = await tx.insert(programs).values({ userId, name: program.name, forPlannedSessionId: sessionId }).returning({ id: programs.id });
  w.create({ type: "program", id: copy.id });
  for (const { pe } of slots) {
    const { id: oldId, programId: _p, deletedAt: _d, ...rest } = pe;
    void _p;
    void _d;
    const [newPe] = await tx.insert(programExercises).values({ ...rest, programId: copy.id }).returning({ id: programExercises.id });
    const sets = await tx.select().from(programSets).where(and(eq(programSets.programExerciseId, oldId), isNull(programSets.deletedAt))).orderBy(asc(programSets.setNumber));
    if (sets.length) {
      await tx.insert(programSets).values(
        sets.map(({ id: _id, programExerciseId: _pe, deletedAt: _del, ...s }) => {
          void _id;
          void _pe;
          void _del;
          // The weekly sync scales the template's programs; a one-day copy keeps this week's values.
          return { ...s, programExerciseId: newPe.id, peakDistanceMeters: null, peakDurationSeconds: null };
        }),
      );
      await settleStepRows(tx, newPe.id);
    }
  }
  return copy.id;
}

/** A one-day program holding one structured exercise (the readiness swap's easy session). Returns its id. */
export async function dayProgramFromWorkout(w: PlanWriteSession, userId: string, sessionId: number, workout: Workout): Promise<number> {
  const tx = w.tx;
  const [sport] = await tx
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.discipline, workout.sport), isNull(exercises.userId)))
    .orderBy(asc(exercises.id))
    .limit(1);
  if (!sport) throw new PlanStateError("No built-in exercise for this sport");
  const [program] = await tx.insert(programs).values({ userId, name: workout.name, forPlannedSessionId: sessionId }).returning({ id: programs.id });
  w.create({ type: "program", id: program.id });
  const [pe] = await tx
    .insert(programExercises)
    .values({ programId: program.id, exerciseId: sport.id, orderIndex: 0, progressionAdvance: "manual", poolLengthM: workout.poolLengthM ?? null })
    .returning({ id: programExercises.id });
  await tx.insert(programSets).values(workoutToRows(workout).map((r) => ({ ...r, programExerciseId: pe.id, restTimeSeconds: 0 })));
  await assertStepRows(tx, pe.id);
  return program.id;
}

/** Remove a session's one-day copy when the session stops running it. */
export async function dropDayCopy(w: PlanWriteSession, sessionId: number, programId: number | null): Promise<void> {
  if (programId == null) return;
  // plan-read: includes deleted (only whether this program is the session's own copy)
  const [p] = await w.tx.select({ forPlannedSessionId: programs.forPlannedSessionId }).from(programs).where(eq(programs.id, programId));
  if (p?.forPlannedSessionId !== sessionId) return;
  await w.touch({ type: "program", id: programId }, { action: "delete" });
  await w.tx.update(programs).set({ deletedAt: new Date() }).where(eq(programs.id, programId));
}
