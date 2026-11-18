import { and, asc, eq, isNull } from "drizzle-orm";
import { exercises, programExercises, programSets, programs } from "../../src/db/schema";
import { workoutToRows } from "../../src/lib/utils/program-steps";
import { parseWorkout } from "../../src/lib/utils/workout-steps";
import type { testDb } from "./reset";

/**
 * A program of one built-in swim, bike or run exercise whose sets are the
 * steps of `workout`, named after it (docs/plans/one-program-model.md): what a
 * structured session runs. Returns the program id.
 */
export async function insertStepProgram(db: ReturnType<typeof testDb>, userId: string, workout: unknown): Promise<number> {
  const parsed = parseWorkout(workout);
  if (!parsed.ok) throw new Error(`insertStepProgram: ${JSON.stringify(parsed.errors)}`);
  const w = parsed.workout;
  const [ex] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.discipline, w.sport), isNull(exercises.userId)))
    .orderBy(asc(exercises.id))
    .limit(1);
  const [program] = await db.insert(programs).values({ userId, name: w.name }).returning({ id: programs.id });
  const [pe] = await db
    .insert(programExercises)
    .values({ programId: program.id, exerciseId: ex.id, orderIndex: 0, progressionAdvance: "manual", poolLengthM: w.poolLengthM ?? null, rideTest: w.test ?? null })
    .returning({ id: programExercises.id });
  await db.insert(programSets).values(workoutToRows(w).map((r) => ({ ...r, programExerciseId: pe.id, restTimeSeconds: 0 })));
  return program.id;
}
