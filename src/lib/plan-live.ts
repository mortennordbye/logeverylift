/**
 * Conditions that hide soft-deleted plan rows (docs/plans/revisions.md, 2.4).
 *
 * Every read of programs, program_exercises, program_sets or training_cycles
 * uses one of these, or says why it reads deleted rows with a
 * `// plan-read: includes deleted (<why>)` comment. The guard test in
 * src/__tests__/plan-write-guard.test.ts fails the build otherwise.
 */

import { plannedSessions, programExercises, programSets, programs, trainingCycles } from "@/db/schema";
import { isNull } from "drizzle-orm";

export const livePrograms = isNull(programs.deletedAt);
export const liveProgramExercises = isNull(programExercises.deletedAt);
export const liveProgramSets = isNull(programSets.deletedAt);
export const liveCycles = isNull(trainingCycles.deletedAt);
export const livePlannedSessions = isNull(plannedSessions.deletedAt);

// In a relational `with` block, filter inline:
//   programSets: { where: (ps, { isNull }) => isNull(ps.deletedAt), ... }

/**
 * A slot keeps its program id when the program is soft deleted (a hard delete
 * used to null it). Read such a slot as a slot with no program.
 */
export function liveSlotProgram<S extends { programId: number | null; program?: { deletedAt: Date | null } | null }>(
  slot: S,
): S {
  if (slot.program?.deletedAt != null) return { ...slot, programId: null, program: null };
  return slot;
}
