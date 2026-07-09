"use server";

import { db } from "@/db";
import { exercises } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { createExerciseSchema } from "@/lib/validators/workout";
import type { ActionResult, Exercise } from "@/types/workout";
import { asc, eq, isNull, or, and } from "drizzle-orm";

/**
 * Get exercises visible to the current user:
 * all system exercises (userId IS NULL) plus the user's own custom exercises.
 */
export async function getAllExercises(): Promise<ActionResult<Exercise[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select()
      .from(exercises)
      .where(or(isNull(exercises.userId), eq(exercises.userId, auth.user.id)))
      .orderBy(asc(exercises.name));
    return { success: true, data: rows };
  } catch (error) {
    console.error("[getAllExercises] failed", error);
    return { success: false, error: "Failed to fetch exercises" };
  }
}

/**
 * Create a custom exercise owned by the current user.
 */
export async function createCustomExercise(
  data: unknown,
): Promise<ActionResult<Exercise>> {
  const auth = await requireSession();
  try {
    const validation = createExerciseSchema.safeParse(data);
    if (!validation.success) {
      return {
        success: false,
        error: "Invalid input data",
        fieldErrors: validation.error.flatten().fieldErrors,
      };
    }

    const { name, category, bodyArea, muscleGroup, equipment, movementPattern, exerciseType } = validation.data;

    // Name must not clash with a system exercise or the user's own custom exercises.
    const existing = await db.query.exercises.findFirst({
      where: (ex, { eq, or, isNull, and }) =>
        and(
          eq(ex.name, name),
          or(isNull(ex.userId), eq(ex.userId, auth.user.id)),
        ),
    });

    if (existing) {
      return {
        success: false,
        error: "An exercise with this name already exists",
      };
    }

    const [exercise] = await db
      .insert(exercises)
      .values({
        name,
        category,
        isCustom: true,
        userId: auth.user.id,
        bodyArea,
        muscleGroup,
        equipment,
        movementPattern,
        exerciseType,
      })
      .returning();

    return { success: true, data: exercise };
  } catch (error) {
    console.error("[createCustomExercise] failed", error);
    return { success: false, error: "Failed to create exercise. Please try again." };
  }
}

/**
 * Delete a custom exercise owned by the current user.
 */
export async function deleteCustomExercise(id: number): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  try {
    const existing = await db.query.exercises.findFirst({
      where: (ex, { eq, and }) =>
        and(
          eq(ex.id, id),
          eq(ex.isCustom, true),
          eq(ex.userId, auth.user.id),
        ),
    });
    if (!existing) {
      return { success: false, error: "Exercise not found or not deletable" };
    }
    await db.delete(exercises).where(
      and(
        eq(exercises.id, id),
        eq(exercises.isCustom, true),
        eq(exercises.userId, auth.user.id),
      ),
    );
    return { success: true, data: undefined };
  } catch (error) {
    console.error("[deleteCustomExercise] failed", error);
    return { success: false, error: "Failed to delete exercise. Please try again." };
  }
}

/**
 * Update a custom exercise owned by the current user.
 */
export async function updateCustomExercise(
  id: number,
  data: unknown,
): Promise<ActionResult<Exercise>> {
  const auth = await requireSession();
  try {
    const validation = createExerciseSchema.safeParse(data);
    if (!validation.success) {
      return {
        success: false,
        error: "Invalid input data",
        fieldErrors: validation.error.flatten().fieldErrors,
      };
    }

    const { name, category, bodyArea, muscleGroup, equipment, movementPattern, exerciseType } = validation.data;

    // Verify ownership
    const existing = await db.query.exercises.findFirst({
      where: (ex, { eq, and }) => and(eq(ex.id, id), eq(ex.userId, auth.user.id)),
    });

    if (!existing) {
      return { success: false, error: "Exercise not found or not editable" };
    }

    // Name clash check (exclude self)
    const clash = await db.query.exercises.findFirst({
      where: (ex, { eq, or, isNull, and, ne }) =>
        and(
          eq(ex.name, name),
          ne(ex.id, id),
          or(isNull(ex.userId), eq(ex.userId, auth.user.id)),
        ),
    });

    if (clash) {
      return { success: false, error: "An exercise with this name already exists" };
    }

    const [updated] = await db
      .update(exercises)
      .set({ name, category, bodyArea: bodyArea ?? null, muscleGroup: muscleGroup ?? null, equipment: equipment ?? null, movementPattern: movementPattern ?? null, exerciseType: exerciseType ?? null })
      .where(and(eq(exercises.id, id), eq(exercises.userId, auth.user.id)))
      .returning();

    return { success: true, data: updated };
  } catch (error) {
    console.error("[updateCustomExercise] failed", error);
    return { success: false, error: "Failed to update exercise. Please try again." };
  }
}
