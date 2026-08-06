"use server";

import { db } from "@/db";
import { customWeightUsage } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { z } from "zod";

const logCustomWeightSchema = z.object({
  exerciseId: z.number().int().positive(),
  weightKg: z.number().positive().max(1000),
});

/**
 * Record that a set was saved with a manually typed weight rather than a
 * preset. Fire-and-forget from the set editors — the write is telemetry for
 * tuning the preset ladder, never something the user waits on.
 */
export async function logCustomWeight(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = logCustomWeightSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await db.insert(customWeightUsage).values({
      userId: auth.user.id,
      exerciseId: parsed.data.exerciseId,
      weightKg: parsed.data.weightKg,
    });
    return { success: true, data: null };
  } catch (e) {
    console.error("[logCustomWeight] failed", e);
    return { success: false, error: "Failed to log custom weight" };
  }
}
