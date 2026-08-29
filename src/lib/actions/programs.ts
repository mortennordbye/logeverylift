"use server";

/**
 * Programs Server Actions
 *
 * CRUD operations for workout programs, their exercise slots, and planned sets.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, programs } from "@/db/schema";
import { exerciseTypeFromPattern, programOverrideForRole } from "@/lib/utils/exercise-type";
import type { ProgressionAdvance } from "@/lib/utils/progression";
import { requireSession } from "@/lib/utils/session";
import {
  addExerciseToProgramSchema,
  addProgramSetSchema,
  applyProgressionToPlanSchema,
  createProgramSchema,
  deleteProgramSetSchema,
  importProgramSchema,
  removeExerciseFromProgramSchema,
  reorderProgramExercisesSchema,
  reorderProgramSetsSchema,
  setProgramExerciseApplyToPlanSchema,
  setProgramExerciseProgressionSchema,
  setProgramExerciseSetDefaultsSchema,
  setProgramExerciseTypeSchema,
  updateProgramSchema,
  updateProgramSetSchema,
} from "@/lib/validators/workout";
import type {
  ActionResult,
  ExportedProgram,
  ExportedPrograms,
  Program,
  ProgramExercise,
  ProgramSet,
  ProgramWithExercises,
} from "@/types/workout";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────────────────
// Programs
// ─────────────────────────────────────────────────────────────────────────────

export async function getPrograms(): Promise<ActionResult<Program[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select()
      .from(programs)
      .where(eq(programs.userId, auth.user.id))
      .orderBy(asc(programs.name));
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getProgramWithExercises(
  programId: number,
): Promise<ActionResult<ProgramWithExercises>> {
  const auth = await requireSession();
  try {
    const program = await db.query.programs.findFirst({
      where: and(
        eq(programs.id, programId),
        eq(programs.userId, auth.user.id),
      ),
      with: {
        programExercises: {
          orderBy: (pe, { asc }) => [asc(pe.orderIndex)],
          with: {
            exercise: true,
            programSets: {
              orderBy: (ps, { asc }) => [asc(ps.setNumber)],
            },
          },
        },
      },
    });

    if (!program) {
      return { success: false, error: "Program not found" };
    }

    return { success: true, data: program as ProgramWithExercises };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getProgramsWithExercises(
  ids: number[],
): Promise<Record<number, ProgramWithExercises>> {
  if (ids.length === 0) return {};
  const auth = await requireSession();
  try {
    const rows = await db.query.programs.findMany({
      where: and(
        inArray(programs.id, ids),
        eq(programs.userId, auth.user.id),
      ),
      with: {
        programExercises: {
          orderBy: (pe, { asc }) => [asc(pe.orderIndex)],
          with: {
            exercise: true,
            programSets: {
              orderBy: (ps, { asc }) => [asc(ps.setNumber)],
            },
          },
        },
      },
    });
    return Object.fromEntries(rows.map((p) => [p.id, p as ProgramWithExercises]));
  } catch {
    return {};
  }
}

export async function createProgram(
  data: unknown,
): Promise<ActionResult<Program>> {
  const auth = await requireSession();

  const validation = createProgramSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: "Invalid input" };
  }

  try {
    const [program] = await db
      .insert(programs)
      .values({ ...validation.data, userId: auth.user.id })
      .returning();

    revalidatePath("/programs");
    return { success: true, data: program };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateProgram(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();

  const validation = updateProgramSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: "Invalid input" };
  }

  try {
    await db
      .update(programs)
      .set({ name: validation.data.name })
      .where(
        and(
          eq(programs.id, validation.data.id),
          eq(programs.userId, auth.user.id),
        ),
      );

    revalidatePath("/programs");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteProgram(
  programId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  try {
    await db.delete(programs).where(
      and(eq(programs.id, programId), eq(programs.userId, auth.user.id))
    );
    revalidatePath("/programs");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteManyPrograms(
  programIds: number[],
): Promise<ActionResult<void>> {
  if (programIds.length === 0) return { success: true, data: undefined };
  const auth = await requireSession();
  try {
    await db.delete(programs).where(
      and(inArray(programs.id, programIds), eq(programs.userId, auth.user.id))
    );
    revalidatePath("/programs");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Program Exercises
// ─────────────────────────────────────────────────────────────────────────────

export async function addExerciseToProgram(
  data: unknown,
): Promise<ActionResult<ProgramExercise>> {
  const auth = await requireSession();
  try {
    const validation = addExerciseToProgramSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid input" };
    }

    // Verify the program belongs to the authenticated user
    const [prog] = await db
      .select({ userId: programs.userId })
      .from(programs)
      .where(eq(programs.id, validation.data.programId))
      .limit(1);
    if (!prog || prog.userId !== auth.user.id) {
      return { success: false, error: "Program not found" };
    }

    // Place at end if no orderIndex given
    if (validation.data.orderIndex === undefined) {
      const existing = await db
        .select()
        .from(programExercises)
        .where(eq(programExercises.programId, validation.data.programId));
      validation.data.orderIndex = existing.length;
    }

    const [pe] = await db
      .insert(programExercises)
      .values(validation.data as typeof programExercises.$inferInsert)
      .returning();

    revalidatePath(`/programs/${validation.data.programId}`);
    revalidatePath(`/programs/${validation.data.programId}/workout`);
    return { success: true, data: pe };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function removeExerciseFromProgram(
  programExerciseId: number,
  programId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = removeExerciseFromProgramSchema.safeParse({
    programExerciseId,
    programId,
  });
  if (!validation.success) return { success: false, error: "Invalid input" };
  try {
    const [prog] = await db
      .select({ userId: programs.userId })
      .from(programs)
      .where(eq(programs.id, validation.data.programId))
      .limit(1);
    if (!prog || prog.userId !== auth.user.id) {
      return { success: false, error: "Program not found" };
    }
    await db
      .delete(programExercises)
      .where(
        and(
          eq(programExercises.id, validation.data.programExerciseId),
          eq(programExercises.programId, validation.data.programId),
        ),
      );
    revalidatePath(`/programs/${validation.data.programId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateProgramExerciseIncrement(
  programExerciseId: number,
  incrementKg: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  if (incrementKg < 0 || incrementKg > 100) {
    return { success: false, error: "Increment must be between 0 and 100 kg" };
  }
  try {
    const [check] = await db
      .select({ userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    const [pe] = await db
      .update(programExercises)
      .set({ overloadIncrementKg: incrementKg.toString() })
      .where(eq(programExercises.id, programExerciseId))
      .returning({ programId: programExercises.programId });
    if (pe) {
      revalidatePath(`/programs/${pe.programId}/workout/exercises/${programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/exercises/${programExerciseId}`);
    }
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Set (or clear) the per-program exercise-type override. Pass null to clear it
 * and inherit the exercise's intrinsic type.
 */
export async function setProgramExerciseType(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = setProgramExerciseTypeSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }
  const { programExerciseId, exerciseType } = validation.data;
  try {
    const [check] = await db
      .select({ userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    const [pe] = await db
      .update(programExercises)
      .set({ exerciseType })
      .where(eq(programExercises.id, programExerciseId))
      .returning({ programId: programExercises.programId });
    if (pe) {
      revalidatePath(`/programs/${pe.programId}/workout/exercises/${programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/exercises/${programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}`);
    }
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[setProgramExerciseType] failed", err);
    return { success: false, error: "Failed to update exercise type" };
  }
}

/**
 * Opt in (or out of) rewriting the planned sets when a suggestion is accepted.
 */
export async function setProgramExerciseApplyToPlan(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = setProgramExerciseApplyToPlanSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }
  const { programExerciseId, applyToPlan } = validation.data;
  try {
    const [check] = await db
      .select({ userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    const [pe] = await db
      .update(programExercises)
      .set({ progressionApplyToPlan: applyToPlan })
      .where(eq(programExercises.id, programExerciseId))
      .returning({ programId: programExercises.programId });
    if (pe) {
      revalidatePath(`/programs/${pe.programId}/workout/exercises/${programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/exercises/${programExerciseId}`);
    }
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[setProgramExerciseApplyToPlan] failed", err);
    return { success: false, error: "Failed to update plan setting" };
  }
}

/**
 * Write accepted progression suggestions into the planned sets, so the next
 * session opens at the new numbers.
 *
 * Only runs when the slot has opted in — the client gates on the same flag, but
 * a stale tab must not be able to move someone's plan after they switched it
 * off. Warm-up sets are filtered out server-side for the same reason: they
 * never carry a suggestion, so a request naming one is not something the UI
 * could have produced.
 */
export async function applyProgressionToPlan(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = applyProgressionToPlanSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }
  const { programExerciseId, updates } = validation.data;

  try {
    const [slot] = await db
      .select({
        userId: programs.userId,
        programId: programs.id,
        applyToPlan: programExercises.progressionApplyToPlan,
      })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!slot || slot.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    // Opted out since the page rendered — leaving the plan alone *is* the
    // requested state, so this is a success, not an error the user must act on.
    if (!slot.applyToPlan) return { success: true, data: undefined };

    // Every id must be a working set of this slot. Anything else is dropped
    // rather than trusted, so a tampered payload can't reach another program.
    const owned = await db
      .select({ id: programSets.id })
      .from(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, programExerciseId),
          inArray(
            programSets.id,
            updates.map((u) => u.programSetId),
          ),
          eq(programSets.setType, "working"),
        ),
      );
    const ownedIds = new Set(owned.map((r) => r.id));
    const applicable = updates.filter((u) => ownedIds.has(u.programSetId));
    if (applicable.length === 0) {
      console.error("[applyProgressionToPlan] no applicable sets", {
        programExerciseId,
      });
      return { success: false, error: "Nothing to apply" };
    }

    await db.transaction(async (tx) => {
      for (const u of applicable) {
        await tx
          .update(programSets)
          .set({
            // decimal(6,2): fix the scale here so float noise from the
            // increment rounding (32.500000000000004) never reaches the column.
            ...(u.weightKg !== undefined
              ? { weightKg: u.weightKg.toFixed(2) }
              : {}),
            ...(u.targetReps !== undefined ? { targetReps: u.targetReps } : {}),
            ...(u.durationSeconds !== undefined
              ? { durationSeconds: u.durationSeconds }
              : {}),
            ...(u.distanceMeters !== undefined
              ? { distanceMeters: u.distanceMeters }
              : {}),
          })
          .where(eq(programSets.id, u.programSetId));
      }
    });

    // Deliberately not revalidating the live workout route: the caller already
    // holds the same values as a session override, so refreshing it mid-set
    // would re-render the list the lifter is touching for no visible change.
    // The plan views are what need to be correct next time they are opened.
    revalidatePath(`/programs/${slot.programId}/exercises/${programExerciseId}`);
    revalidatePath(`/programs/${slot.programId}`);
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[applyProgressionToPlan] failed", { programExerciseId }, err);
    return { success: false, error: "Failed to update the plan" };
  }
}

export async function updateProgramExerciseIncrementReps(
  programExerciseId: number,
  incrementReps: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  if (!Number.isInteger(incrementReps) || incrementReps < 0 || incrementReps > 100) {
    return { success: false, error: "Increment must be a whole number between 0 and 100" };
  }
  try {
    const [check] = await db
      .select({ userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    const [pe] = await db
      .update(programExercises)
      .set({ overloadIncrementReps: incrementReps })
      .where(eq(programExercises.id, programExerciseId))
      .returning({ programId: programExercises.programId });
    if (pe) {
      revalidatePath(`/programs/${pe.programId}/workout/exercises/${programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/exercises/${programExerciseId}`);
    }
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * The mode value that corresponds to an advance.
 *
 * `progression_mode` is retired and nothing reads it, but it is kept populated
 * for one release (E-12): program sharing and export both still emit it, and a
 * client or an export written before the axes existed has nothing else to read.
 * It is written here so those wire formats never go stale rather than because
 * the engine cares.
 */
const LEGACY_MODE_FOR_ADVANCE: Record<ProgressionAdvance, string> = {
  none: "none",
  manual: "manual",
  load: "weight",
  reps: "reps",
  double: "double",
  duration: "time",
  distance: "distance",
};

/**
 * Write one or more progression axes for an exercise.
 *
 * Every axis here changes how the window is *judged*, so the write stamps
 * `progressionConfigAt` and the engine drops sessions logged before it. Without
 * that, switching preset or scope re-scores five sessions of history under the
 * new rule and the dot count moves for reasons the lifter cannot see (E-13).
 * The increments and the plan opt-in deliberately do not stamp it: they change
 * what an advance writes, not what counts as a clear.
 */
export async function setProgramExerciseProgression(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = setProgramExerciseProgressionSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }
  const { programExerciseId, ...axes } = validation.data;
  try {
    const [check] = await db
      .select({ userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }

    const updates: Record<string, unknown> = { progressionConfigAt: new Date() };
    if (axes.advance !== undefined) {
      updates.progressionAdvance = axes.advance;
      updates.progressionMode = LEGACY_MODE_FOR_ADVANCE[axes.advance];
    }
    if (axes.scope !== undefined) updates.progressionScope = axes.scope;
    if (axes.requiredHits !== undefined)
      updates.progressionRequiredHits = axes.requiredHits;
    if (axes.regress !== undefined) updates.progressionRegress = axes.regress;
    if (axes.backoffPct !== undefined)
      updates.progressionBackoffPct = axes.backoffPct;
    if (axes.backoffAfter !== undefined)
      updates.progressionBackoffAfter = axes.backoffAfter;
    if (axes.readiness !== undefined)
      updates.progressionReadiness = axes.readiness;

    const [pe] = await db
      .update(programExercises)
      .set(updates)
      .where(eq(programExercises.id, programExerciseId))
      .returning({ programId: programExercises.programId });
    if (pe) {
      revalidatePath(`/programs/${pe.programId}/workout/exercises/${programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/exercises/${programExerciseId}`);
    }
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[setProgramExerciseProgression] failed", err);
    return { success: false, error: "Failed to update progression" };
  }
}

/**
 * Set the rep range and the effort cap across every working set of a slot.
 *
 * Both live on `program_sets` because a top set and its back-offs can carry
 * different values, and SetEditView still edits them one set at a time. The
 * exercise sheet writes them together because picking a preset is a statement
 * about the exercise: "work 6 to 8 reps" is not a claim about set 2 alone.
 *
 * A new range clamps each set's `target_reps` into it. Without that the write
 * leaves the prescription outside the bounds it was just given, which the set
 * validator would reject on the next edit and the engine would have to correct
 * behind the lifter's back.
 */
export async function setProgramExerciseSetDefaults(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = setProgramExerciseSetDefaultsSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }
  const { programExerciseId, repRangeMin, repRangeMax, targetRir } =
    validation.data;
  try {
    const [check] = await db
      .select({ userId: programs.userId, programId: programExercises.programId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, programExerciseId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }

    const working = await db
      .select({ id: programSets.id, targetReps: programSets.targetReps })
      .from(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, programExerciseId),
          eq(programSets.setType, "working"),
        ),
      );

    for (const set of working) {
      const updates: Record<string, unknown> = {};
      if (repRangeMin !== undefined) updates.repRangeMin = repRangeMin;
      if (repRangeMax !== undefined) updates.repRangeMax = repRangeMax;
      if (targetRir !== undefined) updates.targetRir = targetRir;
      if (
        repRangeMin != null &&
        repRangeMax != null &&
        set.targetReps != null &&
        (set.targetReps < repRangeMin || set.targetReps > repRangeMax)
      ) {
        updates.targetReps = Math.min(Math.max(set.targetReps, repRangeMin), repRangeMax);
      }
      if (Object.keys(updates).length === 0) continue;
      await db.update(programSets).set(updates).where(eq(programSets.id, set.id));
    }

    // Both of these change how a session is judged — the range is what an
    // advance measures against, the cap is axis 3 — so they stamp the config
    // clock like the axes on the exercise do (E-13).
    await db
      .update(programExercises)
      .set({ progressionConfigAt: new Date() })
      .where(eq(programExercises.id, programExerciseId));

    revalidatePath(`/programs/${check.programId}/workout/exercises/${programExerciseId}`);
    revalidatePath(`/programs/${check.programId}/exercises/${programExerciseId}`);
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[setProgramExerciseSetDefaults] failed", err);
    return { success: false, error: "Failed to update the sets" };
  }
}

export async function reorderProgramExercises(
  programId: number,
  orderedIds: number[],
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = reorderProgramExercisesSchema.safeParse({
    programId,
    orderedIds,
  });
  if (!validation.success) return { success: false, error: "Invalid input" };
  try {
    const [prog] = await db
      .select({ userId: programs.userId })
      .from(programs)
      .where(eq(programs.id, validation.data.programId))
      .limit(1);
    if (!prog || prog.userId !== auth.user.id) {
      return { success: false, error: "Program not found" };
    }
    await Promise.all(
      validation.data.orderedIds.map((id, index) =>
        db
          .update(programExercises)
          .set({ orderIndex: index })
          .where(
            and(
              eq(programExercises.id, id),
              eq(programExercises.programId, validation.data.programId),
            ),
          ),
      ),
    );
    revalidatePath(`/programs/${validation.data.programId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Program Sets
// ─────────────────────────────────────────────────────────────────────────────

export async function addProgramSet(
  data: unknown,
): Promise<ActionResult<ProgramSet>> {
  const auth = await requireSession();
  try {
    const validation = addProgramSetSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid input" };
    }

    // Verify ownership via programExercise → program
    const [peCheck] = await db
      .select({ programId: programExercises.programId, userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, validation.data.programExerciseId))
      .limit(1);
    if (!peCheck || peCheck.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }

    const [ps] = await db
      .insert(programSets)
      .values(validation.data as typeof programSets.$inferInsert)
      .returning();

    // Look up programId to revalidate the correct paths
    const [pe] = await db
      .select({ programId: programExercises.programId })
      .from(programExercises)
      .where(eq(programExercises.id, validation.data.programExerciseId))
      .limit(1);

    if (pe) {
      revalidatePath(`/programs/${pe.programId}/workout/exercises/${validation.data.programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/exercises/${validation.data.programExerciseId}`);
      revalidatePath(`/programs/${pe.programId}/workout`);
    }

    return { success: true, data: ps };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateProgramSet(
  data: unknown,
): Promise<ActionResult<ProgramSet>> {
  const auth = await requireSession();
  try {
    const validation = updateProgramSetSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid input" };
    }

    const { id, ...rest } = validation.data;

    // Verify ownership via programSet → programExercise → program
    const [check] = await db
      .select({ userId: programs.userId, programId: programs.id, programExerciseId: programExercises.id })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programSets.id, id))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    // Strip undefined values so partial updates don't overwrite existing fields
    const updates = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    ) as Partial<typeof programSets.$inferInsert>;
    const [ps] = await db
      .update(programSets)
      .set(updates)
      .where(eq(programSets.id, id))
      .returning();

    revalidatePath(`/programs/${check.programId}/exercises/${check.programExerciseId}`);
    revalidatePath(`/programs/${check.programId}/workout/exercises/${check.programExerciseId}`);

    return { success: true, data: ps };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteProgramSet(
  programSetId: number,
  programId: number,
  programExerciseId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = deleteProgramSetSchema.safeParse({ programSetId });
  if (!validation.success) return { success: false, error: "Invalid input" };
  try {
    // Verify ownership of the set itself via programSet → programExercise →
    // program. Checking only the caller-supplied programId would let a caller
    // name their own program and delete any other user's set.
    const [check] = await db
      .select({ userId: programs.userId })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programSets.id, validation.data.programSetId))
      .limit(1);
    if (!check || check.userId !== auth.user.id) {
      return { success: false, error: "Program not found" };
    }
    await db
      .delete(programSets)
      .where(eq(programSets.id, validation.data.programSetId));
    revalidatePath(`/programs/${programId}/workout/exercises/${programExerciseId}`);
    revalidatePath(`/programs/${programId}/workout`);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function reorderProgramSets(
  programExerciseId: number,
  orderedIds: number[],
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = reorderProgramSetsSchema.safeParse({
    programExerciseId,
    orderedIds,
  });
  if (!validation.success) return { success: false, error: "Invalid input" };
  try {
    // Verify ownership via programExercise → program
    const [peCheck] = await db
      .select({ programId: programExercises.programId, userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programExercises.id, validation.data.programExerciseId))
      .limit(1);
    if (!peCheck || peCheck.userId !== auth.user.id) {
      return { success: false, error: "Not found" };
    }
    await Promise.all(
      validation.data.orderedIds.map((id, index) =>
        db
          .update(programSets)
          .set({ setNumber: index + 1 })
          .where(
            and(
              eq(programSets.id, id),
              eq(programSets.programExerciseId, validation.data.programExerciseId),
            ),
          ),
      ),
    );
    const [pe] = await db
      .select({ programId: programExercises.programId })
      .from(programExercises)
      .where(eq(programExercises.id, validation.data.programExerciseId))
      .limit(1);
    if (pe) {
      revalidatePath(
        `/programs/${pe.programId}/workout/exercises/${validation.data.programExerciseId}`,
      );
      revalidatePath(
        `/programs/${pe.programId}/exercises/${validation.data.programExerciseId}`,
      );
    }
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Program Import / Export
// ─────────────────────────────────────────────────────────────────────────────

export async function exportProgram(
  programId: number,
): Promise<ActionResult<ExportedProgram>> {
  const auth = await requireSession();

  const result = await getProgramWithExercises(programId);
  if (!result.success) return result;

  const program = result.data;
  if (program.userId !== auth.user.id) {
    return { success: false, error: "Program not found" };
  }

  const payload: ExportedProgram = {
    version: 1,
    exportedAt: new Date().toISOString(),
    program: {
      name: program.name,
      exercises: program.programExercises.map((pe, i) => ({
        idx: pe.orderIndex ?? i,
        notes: pe.notes ?? null,
        incKg: Number(pe.overloadIncrementKg ?? 2.5),
        incReps: pe.overloadIncrementReps ?? 0,
        mode: pe.progressionMode ?? "manual",
        hits: pe.progressionRequiredHits ?? null,
        applyToPlan: pe.progressionApplyToPlan ?? false,
        exercise: {
          name: pe.exercise.name,
          category: pe.exercise.category,
          area: pe.exercise.bodyArea ?? null,
          muscle: pe.exercise.muscleGroup ?? null,
          equipment: pe.exercise.equipment ?? null,
          pattern: pe.exercise.movementPattern ?? null,
          // Resolved role (per-program override wins) so a re-import reproduces it.
          type: pe.exerciseType ?? pe.exercise.exerciseType ?? null,
        },
        sets: pe.programSets.map((s) => ({
          n: s.setNumber,
          reps: s.targetReps ?? null,
          kg: s.weightKg != null ? Number(s.weightKg) : null,
          durSec: s.durationSeconds ?? null,
          distM: s.distanceMeters ?? null,
          rest: s.restTimeSeconds ?? 0,
          type: s.setType ?? "working",
          rir: s.targetRir ?? null,
          startDelay: s.startDelaySeconds ?? null,
          repMin: s.repRangeMin ?? null,
          repMax: s.repRangeMax ?? null,
        })),
      })),
    },
  };

  return { success: true, data: payload };
}

export async function exportAllPrograms(): Promise<ActionResult<ExportedPrograms>> {
  const auth = await requireSession();
  const userId = auth.user.id;

  try {
    const userPrograms = await db.query.programs.findMany({
      where: eq(programs.userId, userId),
      with: {
        programExercises: {
          orderBy: [asc(programExercises.orderIndex)],
          with: {
            exercise: true,
            programSets: { orderBy: [asc(programSets.setNumber)] },
          },
        },
      },
    });

    return {
      success: true,
      data: {
        version: 1,
        exportedAt: new Date().toISOString(),
        programs: userPrograms.map((p) => ({
          name: p.name,
          exercises: p.programExercises.map((pe, i) => ({
            idx: pe.orderIndex ?? i,
            notes: pe.notes ?? null,
            incKg: Number(pe.overloadIncrementKg ?? 2.5),
            incReps: pe.overloadIncrementReps ?? 0,
            mode: pe.progressionMode ?? "manual",
            hits: pe.progressionRequiredHits ?? null,
            applyToPlan: pe.progressionApplyToPlan ?? false,
            exercise: {
              name: pe.exercise.name,
              category: pe.exercise.category,
              area: pe.exercise.bodyArea ?? null,
              muscle: pe.exercise.muscleGroup ?? null,
              equipment: pe.exercise.equipment ?? null,
              pattern: pe.exercise.movementPattern ?? null,
              // Resolved role (per-program override wins) so a re-import reproduces it.
              type: pe.exerciseType ?? pe.exercise.exerciseType ?? null,
            },
            sets: pe.programSets.map((s) => ({
              n: s.setNumber,
              reps: s.targetReps ?? null,
              kg: s.weightKg != null ? Number(s.weightKg) : null,
              durSec: s.durationSeconds ?? null,
              distM: s.distanceMeters ?? null,
              rest: s.restTimeSeconds ?? 0,
              type: s.setType ?? "working",
              rir: s.targetRir ?? null,
              startDelay: s.startDelaySeconds ?? null,
              repMin: s.repRangeMin ?? null,
              repMax: s.repRangeMax ?? null,
            })),
          })),
        })),
      },
    };
  } catch (err) {
    console.error("exportAllPrograms failed:", err);
    return { success: false, error: "Failed to export programs" };
  }
}

export async function importProgram(
  data: unknown,
): Promise<ActionResult<{ count: number; programNames: string[]; skippedExercises: string[] }>> {
  const auth = await requireSession();

  const parsed = importProgramSchema.safeParse(data);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue
      ? `${firstIssue.path.join(".") || "root"}: ${firstIssue.message}`
      : null;
    return {
      success: false,
      error: detail
        ? `Invalid program data — ${detail}`
        : "Invalid program data. Make sure you copied the full response from the AI.",
    };
  }

  // Normalise to array regardless of single vs multi format
  const programList = "programs" in parsed.data ? parsed.data.programs : [parsed.data.program];

  // Collect all unique exercise names across all programs
  const allSlots = programList.flatMap((p) => p.exercises);
  const names = [...new Set(allSlots.map((e) => e.exercise.name))];
  // name → { id, defaultType }. defaultType is the exercise's intrinsic type;
  // it's compared against the slot's role to decide the per-program override.
  const exerciseMap = new Map<string, { id: number; defaultType: string | null }>();

  if (names.length > 0) {
    const matched = await db
      .select({ id: exercises.id, name: exercises.name, exerciseType: exercises.exerciseType })
      .from(exercises)
      .where(
        and(
          inArray(exercises.name, names),
          or(isNull(exercises.userId), eq(exercises.userId, auth.user.id)),
        ),
      );
    for (const ex of matched) {
      exerciseMap.set(ex.name, { id: ex.id, defaultType: ex.exerciseType });
    }
  }

  // Create any unrecognised exercises as custom (only if not already in library)
  for (const slot of allSlots) {
    const exName = slot.exercise.name;
    if (exerciseMap.has(exName)) continue;

    const rows = await db
      .insert(exercises)
      .values({
        name: exName,
        category: slot.exercise.category,
        isCustom: true,
        userId: auth.user.id,
        bodyArea: slot.exercise.area ?? undefined,
        muscleGroup: slot.exercise.muscle ?? undefined,
        equipment: slot.exercise.equipment ?? undefined,
        movementPattern: slot.exercise.pattern ?? undefined,
        exerciseType:
          slot.exercise.type ??
          exerciseTypeFromPattern(slot.exercise.pattern) ??
          undefined,
      })
      .onConflictDoNothing()
      .returning({ id: exercises.id, exerciseType: exercises.exerciseType });

    if (rows.length > 0) {
      exerciseMap.set(exName, { id: rows[0].id, defaultType: rows[0].exerciseType });
    } else {
      // Race condition: another request inserted it first
      const [existing] = await db
        .select({ id: exercises.id, exerciseType: exercises.exerciseType })
        .from(exercises)
        .where(and(
          eq(exercises.name, exName),
          or(isNull(exercises.userId), eq(exercises.userId, auth.user.id)),
        ))
        .limit(1);
      if (existing) exerciseMap.set(exName, { id: existing.id, defaultType: existing.exerciseType });
    }
  }

  // Import each program in a transaction
  const programNames: string[] = [];
  const skippedExercises: string[] = [];
  try {
    for (const programData of programList) {
      await db.transaction(async (tx) => {
        const [program] = await tx
          .insert(programs)
          .values({ name: programData.name, userId: auth.user.id })
          .returning({ id: programs.id });

        for (const slot of programData.exercises) {
          const entry = exerciseMap.get(slot.exercise.name);
          if (!entry) {
            if (!skippedExercises.includes(slot.exercise.name)) {
              skippedExercises.push(slot.exercise.name);
            }
            continue;
          }

          // The slot's type is the exercise's role in THIS program. Persist it as
          // a program-level override only when it differs from the exercise's
          // intrinsic default — otherwise inherit (null). New exercises whose
          // default we just set from this same type therefore get no override.
          const overrideType = programOverrideForRole(slot.exercise.type, entry.defaultType);

          const [pe] = await tx
            .insert(programExercises)
            .values({
              programId: program.id,
              exerciseId: entry.id,
              orderIndex: slot.idx,
              notes: slot.notes ?? undefined,
              overloadIncrementKg: slot.incKg.toString(),
              overloadIncrementReps: slot.incReps,
              progressionMode: slot.mode,
              progressionRequiredHits: slot.hits ?? null,
              progressionApplyToPlan: slot.applyToPlan ?? false,
              exerciseType: overrideType,
            })
            .returning({ id: programExercises.id });

          if (slot.sets.length > 0) {
            await tx.insert(programSets).values(
              slot.sets.map((s) => ({
                programExerciseId: pe.id,
                setNumber: s.n,
                targetReps: s.reps ?? undefined,
                weightKg: s.kg != null ? s.kg.toString() : undefined,
                durationSeconds: s.durSec ?? undefined,
                distanceMeters: s.distM ?? undefined,
                restTimeSeconds: s.rest,
                setType: s.type,
                targetRir: s.rir ?? undefined,
                startDelaySeconds: s.startDelay ?? undefined,
                // Half a range is not a range: the engine needs both bounds,
                // so a truncated pair is dropped rather than half-restored.
                ...(s.repMin != null && s.repMax != null
                  ? { repRangeMin: s.repMin, repRangeMax: s.repMax }
                  : {}),
              })),
            );
          }
        }
      });
      programNames.push(programData.name);
    }

    revalidatePath("/programs");
    return { success: true, data: { count: programNames.length, programNames, skippedExercises } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
