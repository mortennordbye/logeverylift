"use server";

import { TRI_DISTANCES } from "@/db/schema";
import { PlanStateError } from "@/lib/plan-revisions";
import { createTriathlonPlan } from "@/lib/triathlon-plan";
import { requireSession } from "@/lib/utils/session";
import { seasonFieldsSchema } from "@/lib/validators/seasons";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** "Make a triathlon plan" in New season: the session and the input check around createTriathlonPlan (src/lib/triathlon-plan.ts). */
const generateTriathlonPlanSchema = seasonFieldsSchema.omit({ endDate: true }).extend({
  race: z.object({
    name: z.string().trim().min(1).max(100),
    raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    distance: z.enum(TRI_DISTANCES),
  }),
  restDays: z.array(z.number().int().min(1).max(7)).max(2).optional(),
  level: z.enum(["novice", "intermediate", "advanced"]).optional(),
  /** The user confirmed the first phase takes the scheduled start (addPhase `takeStart`). */
  takeStart: z.boolean().optional(),
});

export async function generateTriathlonPlan(data: unknown): Promise<ActionResult<{ seasonId: number }>> {
  const auth = await requireSession();
  const parsed = generateTriathlonPlanSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const { seasonId } = await createTriathlonPlan({ userId: auth.user.id, writer: "user" }, parsed.data);
    revalidatePath("/cycles");
    revalidatePath(`/seasons/${seasonId}`);
    revalidatePath("/");
    return { success: true, data: { seasonId } };
  } catch (err) {
    if (err instanceof PlanStateError) return { success: false, error: err.message };
    console.error("[generateTriathlonPlan] failed", err);
    return { success: false, error: "Failed to generate plan" };
  }
}
