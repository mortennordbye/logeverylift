"use server";

/**
 * Fuel logs, products, sweat tests and race plans from the app
 * (docs/plans/nutrition-and-race-day.md, 6). Endurance features only (D18),
 * except a fuel log on a Garmin activity, which needs only the activity to be
 * the user's (as before E1).
 */

import { enduranceEnabledFor } from "@/lib/endurance";
import { addProduct, addSweatTest, deleteProduct, deleteSweatTest, NutritionError, saveFuelLog, updateProduct } from "@/lib/nutrition";
import { PlanConflictError, PlanNotFoundError, PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { saveRacePlan } from "@/lib/race-plans";
import { requireSession } from "@/lib/utils/session";
import { fuelLogInput, productChange, productInput, racePlanInput, sweatTestInput } from "@/lib/validators/nutrition";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ENDURANCE_OFF = "Endurance features are not on for this account";

function known(e: unknown): string | null {
  if (e instanceof NutritionError || e instanceof PlanNotFoundError || e instanceof PlanStateError || e instanceof PlanConflictError) return e.message;
  return null;
}

const invalid = (error: z.ZodError) => ({ success: false as const, error: "Invalid input", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> });

/** Save or clear the fuel log of one session (an app session or a Garmin activity). */
export async function saveFuelLogAction(data: unknown): Promise<ActionResult<{ id: number | null }>> {
  const auth = await requireSession();
  const parsed = fuelLogInput.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.workoutSessionId != null && !(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  try {
    const row = await saveFuelLog(auth.user.id, parsed.data);
    revalidatePath("/more/nutrition");
    if (parsed.data.garminActivityId != null) {
      revalidatePath(`/more/garmin/activity/${parsed.data.garminActivityId}`);
      revalidatePath("/more/garmin/race");
    }
    return { success: true, data: { id: row?.id ?? null } };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[saveFuelLogAction] failed", { sessionId: parsed.data.workoutSessionId ?? null, activityId: parsed.data.garminActivityId ?? null });
    return { success: false, error: "Failed to save the fuel log" };
  }
}

const productOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), product: productInput }),
  z.object({ op: z.literal("update"), product: productChange }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
]);

/** Add, change or delete one of the user's fuel products. */
export async function manageFuelProduct(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = productOp.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  try {
    const d = parsed.data;
    let id: number;
    if (d.op === "add") id = (await addProduct(auth.user.id, d.product)).id;
    else if (d.op === "update") {
      const { id: pid, ...change } = d.product;
      id = (await updateProduct(auth.user.id, pid, change)).id;
    } else {
      await deleteProduct(auth.user.id, d.id);
      id = d.id;
    }
    revalidatePath("/more/nutrition");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[manageFuelProduct] failed", { op: parsed.data.op });
    return { success: false, error: "Failed to save the product" };
  }
}

const sweatOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), test: sweatTestInput }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
]);

/** Add or delete a sweat-rate test. */
export async function manageSweatTest(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = sweatOp.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  try {
    const d = parsed.data;
    let id: number;
    if (d.op === "add") id = (await addSweatTest(auth.user.id, d.test)).id;
    else {
      await deleteSweatTest(auth.user.id, d.id);
      id = d.id;
    }
    revalidatePath("/more/nutrition");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[manageSweatTest] failed", { op: parsed.data.op });
    return { success: false, error: "Failed to save the sweat test" };
  }
}

const racePlanSave = z.object({
  raceId: z.number().int().positive(),
  expectedVersion: z.number().int().positive().optional(),
  change: racePlanInput,
});

/** Change a race's plan inputs (the first save creates the plan). */
export async function saveRacePlanAction(data: unknown): Promise<ActionResult<{ id: number; version: number }>> {
  const auth = await requireSession();
  const parsed = racePlanSave.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  const ctx: PlanWriteContext = { userId: auth.user.id, writer: "user" };
  try {
    const r = await saveRacePlan(ctx, parsed.data.raceId, parsed.data.change, parsed.data.expectedVersion);
    revalidatePath(`/races/${parsed.data.raceId}/plan`);
    return { success: true, data: r };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[saveRacePlanAction] failed", { raceId: parsed.data.raceId });
    return { success: false, error: "Failed to save the race plan" };
  }
}
