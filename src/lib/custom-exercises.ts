/**
 * Creating a custom exercise, as plain server code rather than a Server Action:
 * it takes a resolved `userId`, so the app's action (after requireSession) and
 * the MCP `create_exercise` tool (after its own auth) share one rule, and
 * nothing here is reachable from the client.
 *
 * A name is unique among system exercises, and per user among custom ones
 * (the indexes on `exercises`). A custom exercise may not take a system name.
 *
 * Also the rule for which exercises a user may see and log.
 */

import { db } from "@/db";
import { exercises, programExercises, programs } from "@/db/schema";
import { liveProgramExercises, livePrograms } from "@/lib/plan-live";
import type { CreateExerciseInput } from "@/lib/validators/workout";
import type { ActionResult, Exercise } from "@/types/workout";
import { and, eq, exists, isNull, or } from "drizzle-orm";

export const NAME_TAKEN = "An exercise with this name already exists";

/** Postgres unique_violation: a concurrent create of the same name. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function createCustomExerciseFor(
  userId: string,
  input: Omit<CreateExerciseInput, "isCustom">,
): Promise<ActionResult<Exercise>> {
  const { name, category, bodyArea, muscleGroup, equipment, movementPattern, exerciseType, discipline, isTimed } = input;

  const [existing] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.name, name), or(isNull(exercises.userId), eq(exercises.userId, userId))))
    .limit(1);
  if (existing) return { success: false, error: NAME_TAKEN };

  try {
    const [exercise] = await db
      .insert(exercises)
      .values({
        name,
        category,
        isCustom: true,
        userId,
        bodyArea,
        muscleGroup,
        equipment,
        movementPattern,
        exerciseType,
        discipline,
        isTimed: isTimed ?? false,
      })
      .returning();
    return { success: true, data: exercise };
  } catch (e) {
    if (isUniqueViolation(e)) return { success: false, error: NAME_TAKEN };
    throw e;
  }
}

/**
 * The exercise if this user can see it: a built-in one, their own custom one,
 * or another user's custom one that a program they copied still uses.
 */
export async function findVisibleExercise(exerciseId: number, userId: string) {
  const [row] = await db
    .select()
    .from(exercises)
    .where(
      and(
        eq(exercises.id, exerciseId),
        or(
          isNull(exercises.userId),
          eq(exercises.userId, userId),
          exists(
            db
              .select({ id: programExercises.id })
              .from(programExercises)
              .innerJoin(programs, eq(programs.id, programExercises.programId))
              .where(and(eq(programExercises.exerciseId, exercises.id), eq(programs.userId, userId), liveProgramExercises, livePrograms)),
          ),
        ),
      ),
    );
  return row ?? null;
}
