/**
 * The whole-exercise check for endurance steps, run inside a plan write
 * (docs/plans/one-program-model.md, 1.1). A write that leaves a structured
 * exercise invalid throws, so the transaction rolls back.
 *
 * A strength exercise has no step rows; the first query finds none and the
 * check ends there.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, programs } from "@/db/schema";
import { checkStepRows, stepProblemText, type StepRow } from "@/lib/utils/program-steps";
import type { WorkoutSport } from "@/lib/utils/workout-steps";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

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
