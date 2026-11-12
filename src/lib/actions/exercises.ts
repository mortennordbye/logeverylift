"use server";

import { db } from "@/db";
import { exerciseNotes, exercises, programExercises, programs, workoutSessions, workoutSets } from "@/db/schema";
import { getSystemExercises } from "@/lib/data/exercises";
import { liveProgramExercises, livePrograms } from "@/lib/plan-live";
import { requireSession } from "@/lib/utils/session";
import { createExerciseSchema, upsertExerciseNoteSchema } from "@/lib/validators/workout";
import type { ActionResult, Exercise } from "@/types/workout";
import { asc, eq, and, exists, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Get exercises visible to the current user:
 * all system exercises (userId IS NULL) plus the user's own custom exercises.
 */
export async function getAllExercises(): Promise<ActionResult<Exercise[]>> {
  const auth = await requireSession();
  try {
    // The system half is identical for every user and comes from the `use
    // cache` loader; only the caller's own custom rows hit the DB per request.
    const [system, custom] = await Promise.all([
      getSystemExercises(),
      db
        .select()
        .from(exercises)
        .where(eq(exercises.userId, auth.user.id))
        .orderBy(asc(exercises.name)),
    ]);
    const rows = [...system, ...custom].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
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

    // The picker routes render this list server-side. Callers also call
    // router.refresh(), but invalidation should not depend on them doing so.
    revalidatePath("/exercises");
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
    // The foreign keys cascade: deleting the exercise would delete every set
    // ever logged with it, and every program slot that uses it. So an
    // exercise in use stays (docs/plans/revisions.md, owner decision 4).
    // Any user's logged sets: a friend who copied a program with this
    // exercise logs against the same row.
    const [logged] = await db
      .select({ userId: workoutSessions.userId })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
      .where(eq(workoutSets.exerciseId, id))
      .orderBy(sql`${workoutSessions.userId} = ${auth.user.id} desc`)
      .limit(1);
    if (logged) {
      return {
        success: false,
        error:
          logged.userId === auth.user.id
            ? "This exercise has logged sets in your history, so it can't be deleted. Deleting it would delete those sets."
            : "A friend who copied one of your programs has logged sets with this exercise, so it can't be deleted. Deleting it would delete their sets.",
      };
    }
    const usedIn = await db
      .select({ name: programs.name, userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(and(eq(programExercises.exerciseId, id), liveProgramExercises, livePrograms));
    if (usedIn.length > 0) {
      const own = [...new Set(usedIn.filter((p) => p.userId === auth.user.id).map((p) => p.name))];
      return {
        success: false,
        error:
          own.length > 0
            ? `This exercise is used in ${own.map((n) => `"${n}"`).join(", ")}. Remove it from ${own.length === 1 ? "that program" : "those programs"} first.`
            : "This exercise is used in a program a friend copied from you, so it can't be deleted.",
      };
    }
    await db.delete(exercises).where(
      and(
        eq(exercises.id, id),
        eq(exercises.isCustom, true),
        eq(exercises.userId, auth.user.id),
      ),
    );
    revalidatePath("/exercises");
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

    revalidatePath("/exercises");
    return { success: true, data: updated };
  } catch (error) {
    console.error("[updateCustomExercise] failed", error);
    return { success: false, error: "Failed to update exercise. Please try again." };
  }
}

/**
 * The exercise if this user can see it: a built-in one, their own custom one,
 * or another user's custom one that a program they copied still uses.
 */
async function findVisibleExercise(exerciseId: number, userId: string) {
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

/**
 * An exercise for its detail page, with the current user's own note on it.
 */
export async function getExerciseWithNote(
  exerciseId: number,
): Promise<ActionResult<{ exercise: Exercise; note: string | null }>> {
  const auth = await requireSession();
  try {
    const exercise = await findVisibleExercise(exerciseId, auth.user.id);
    if (!exercise) return { success: false, error: "Not found" };
    const [row] = await db
      .select({ note: exerciseNotes.note })
      .from(exerciseNotes)
      .where(and(eq(exerciseNotes.userId, auth.user.id), eq(exerciseNotes.exerciseId, exerciseId)));
    return { success: true, data: { exercise, note: row?.note ?? null } };
  } catch (error) {
    console.error("[getExerciseWithNote] failed", { exerciseId }, error);
    return { success: false, error: "Failed to load exercise" };
  }
}

/**
 * Save the current user's note on an exercise. An empty note deletes it.
 */
export async function upsertExerciseNote(data: unknown): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const parsed = upsertExerciseNoteSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { exerciseId, note } = parsed.data;
  try {
    if (!(await findVisibleExercise(exerciseId, auth.user.id))) {
      return { success: false, error: "Not found" };
    }
    if (note === "") {
      await db
        .delete(exerciseNotes)
        .where(and(eq(exerciseNotes.userId, auth.user.id), eq(exerciseNotes.exerciseId, exerciseId)));
    } else {
      await db
        .insert(exerciseNotes)
        .values({ userId: auth.user.id, exerciseId, note })
        .onConflictDoUpdate({
          target: [exerciseNotes.userId, exerciseNotes.exerciseId],
          set: { note, updatedAt: new Date() },
        });
    }
    revalidatePath(`/exercises/${exerciseId}`);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("[upsertExerciseNote] failed", { exerciseId }, error);
    return { success: false, error: "Failed to save note" };
  }
}
