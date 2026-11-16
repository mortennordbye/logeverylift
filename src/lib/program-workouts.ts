/**
 * The structured endurance exercises of programs as step trees
 * (docs/plans/one-program-model.md, 2). One read for every place that needs
 * a program's planned steps: compliance, the week, the session page and the
 * guided player.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, programs } from "@/db/schema";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import { parseWorkout, type Workout, type WorkoutSport } from "@/lib/utils/workout-steps";
import { and, asc, inArray, isNotNull, eq } from "drizzle-orm";

type Executor = Pick<typeof db, "select">;

/** One structured exercise of a program, in exercise order. */
export type ProgramWorkout = { programExerciseId: number; sport: WorkoutSport; workout: Workout };

/**
 * Per program id, its structured exercises as checked step trees. A program
 * with none is absent. An exercise whose rows fail the check (which the write
 * guard prevents) is left out and logged.
 */
export async function programWorkouts(ex: Executor, programIds: number[]): Promise<Map<number, ProgramWorkout[]>> {
  const out = new Map<number, ProgramWorkout[]>();
  const ids = [...new Set(programIds)];
  if (!ids.length) return out;
  const rows = await ex
    .select({
      programId: programs.id,
      programName: programs.name,
      programExerciseId: programExercises.id,
      orderIndex: programExercises.orderIndex,
      poolLengthM: programExercises.poolLengthM,
      notes: programExercises.notes,
      discipline: exercises.discipline,
      set: programSets,
    })
    .from(programs)
    .innerJoin(programExercises, eq(programExercises.programId, programs.id))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .innerJoin(programSets, eq(programSets.programExerciseId, programExercises.id))
    .where(and(inArray(programs.id, ids), livePrograms, liveProgramExercises, liveProgramSets, isNotNull(programSets.stepKind)))
    .orderBy(asc(programExercises.orderIndex), asc(programExercises.id), asc(programSets.setNumber));

  const bySlot = new Map<number, typeof rows>();
  for (const r of rows) bySlot.set(r.programExerciseId, [...(bySlot.get(r.programExerciseId) ?? []), r]);
  for (const [programExerciseId, list] of bySlot) {
    const first = list[0];
    if (first.discipline == null) continue;
    const built = buildWorkout(
      list.map((r) => r.set as StepRow),
      { sport: first.discipline, name: first.programName, poolLengthM: first.poolLengthM, description: first.notes },
    );
    const parsed = "workout" in built ? parseWorkout(built.workout) : null;
    if (!parsed?.ok) {
      console.error("[program-workouts] invalid_steps", { programExerciseId });
      continue;
    }
    out.set(first.programId, [...(out.get(first.programId) ?? []), { programExerciseId, sport: first.discipline, workout: parsed.workout }]);
  }
  return out;
}
