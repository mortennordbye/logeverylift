"use server";

/** The effort of a paired Garmin ride, from the after-ride view (docs/plans/bike-sessions.md, 5.5). */

import { db } from "@/db";
import { workoutSessions } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const rideRpeSchema = z.object({ plannedSessionId: z.number().int().positive(), rpe: z.number().int().min(1).max(10).nullable() });

export async function setRideRpe(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = rideRpeSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: "Endurance features are not on for this account" };
  try {
    const rows = await db
      .update(workoutSessions)
      .set({ rpe: parsed.data.rpe })
      .where(and(eq(workoutSessions.userId, auth.user.id), eq(workoutSessions.plannedSessionId, parsed.data.plannedSessionId), eq(workoutSessions.source, "garmin")))
      .returning({ id: workoutSessions.id });
    if (!rows.length) return { success: false, error: "No Garmin ride is paired with this session" };
    revalidatePath(`/planned/${parsed.data.plannedSessionId}`);
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[setRideRpe] failed", { plannedSessionId: parsed.data.plannedSessionId }, e instanceof Error ? e.message : "unknown");
    return { success: false, error: "Failed to save the effort" };
  }
}
