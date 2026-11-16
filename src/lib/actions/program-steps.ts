"use server";

/**
 * Save an endurance exercise's steps from the in-app step editor
 * (docs/plans/one-program-model.md, step 4). The editor sends the whole step
 * tree; the rows are replaced by position so set ids stay where the steps do.
 */

import { db } from "@/db";
import { exercises, programExercises, programs } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { liveProgramExercises, livePrograms } from "@/lib/plan-live";
import { planWrite, PlanNotFoundError } from "@/lib/plan-revisions";
import { StepRowsError, replaceExerciseSteps } from "@/lib/program-steps-db";
import { requireSession } from "@/lib/utils/session";
import { parseWorkout } from "@/lib/utils/workout-steps";
import type { ActionResult } from "@/types/workout";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const saveExerciseStepsSchema = z.object({
  programExerciseId: z.number().int().positive(),
  workout: z.unknown(),
});

export async function saveExerciseSteps(data: unknown): Promise<ActionResult<{ programId: number }>> {
  const auth = await requireSession();
  const parsed = saveExerciseStepsSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: "Endurance features are not on for this account" };
  const tree = parseWorkout(parsed.data.workout);
  if (!tree.ok) return { success: false, error: tree.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join(". ") };

  try {
    const [slot] = await db
      .select({ programId: programExercises.programId, discipline: exercises.discipline, userId: programs.userId })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(and(eq(programExercises.id, parsed.data.programExerciseId), eq(programs.userId, auth.user.id), liveProgramExercises, livePrograms));
    if (!slot) return { success: false, error: "Not found" };
    if (slot.discipline !== tree.workout.sport) return { success: false, error: "The steps are for another sport than this exercise" };

    await planWrite({ userId: auth.user.id, writer: "user" }, async (w) => {
      await w.touch({ type: "program", id: slot.programId });
      await replaceExerciseSteps(w.tx, parsed.data.programExerciseId, tree.workout);
    });
    revalidatePath(`/programs/${slot.programId}/exercises/${parsed.data.programExerciseId}`);
    revalidatePath(`/programs/${slot.programId}/workout`, "layout");
    revalidatePath(`/programs/${slot.programId}`);
    return { success: true, data: { programId: slot.programId } };
  } catch (e) {
    if (e instanceof StepRowsError) return { success: false, error: e.message };
    if (e instanceof PlanNotFoundError) return { success: false, error: "Not found" };
    console.error("[saveExerciseSteps] failed", { programExerciseId: parsed.data.programExerciseId });
    return { success: false, error: "Failed to save the steps" };
  }
}

const editDayOnlySchema = z.object({ plannedSessionId: z.number().int().positive() });

/**
 * Change one dated session's steps for that day only (docs/plans/one-program-model.md,
 * decision 2): the session gets its own copy of its program, and the answer
 * names the copy's first exercise for the step editor.
 */
export async function editDayOnly(data: unknown): Promise<ActionResult<{ programId: number; programExerciseId: number }>> {
  const auth = await requireSession();
  const parsed = editDayOnlySchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: "Endurance features are not on for this account" };
  try {
    const { applySessionOp } = await import("@/lib/planned-sessions");
    const { row } = await applySessionOp({ userId: auth.user.id, writer: "user" }, { op: "own_day", id: parsed.data.plannedSessionId });
    const [first] = await db
      .select({ id: programExercises.id })
      .from(programExercises)
      .where(and(eq(programExercises.programId, row.programId!), liveProgramExercises))
      .orderBy(programExercises.orderIndex, programExercises.id)
      .limit(1);
    revalidatePath(`/planned/${parsed.data.plannedSessionId}`);
    revalidatePath("/week");
    return { success: true, data: { programId: row.programId!, programExerciseId: first.id } };
  } catch (e) {
    const { appErrorMessage } = await import("@/lib/step-results");
    const msg = appErrorMessage(e) ?? (e instanceof Error && e.name === "SessionInputError" ? e.message : null);
    if (msg) return { success: false, error: msg };
    console.error("[editDayOnly] failed", { plannedSessionId: parsed.data.plannedSessionId });
    return { success: false, error: "Failed to make a copy for this day" };
  }
}
