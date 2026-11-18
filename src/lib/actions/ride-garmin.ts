"use server";

/**
 * The summary's Garmin controls (docs/plans/bike-ride-logger.md, 4.8 and
 * section 5): Undo of a fill, and Pick when two Garmin rides match.
 */

import { garminAllowedFor } from "@/lib/garmin/access";
import { pickRideActivity, undoRideFill } from "@/lib/ride-garmin";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const undoSchema = z.object({ rideId: z.number().int().positive() });

/** Restore what the ride's steps held before Garmin filled them; the same activity never fills this ride again. */
export async function undoRideGarminFill(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = undoSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    if (!(await garminAllowedFor(auth.user.id))) return { success: false, error: "Not found" };
    if (!(await undoRideFill(auth.user.id, parsed.data.rideId))) return { success: false, error: "Not found" };
    revalidatePath("/programs", "layout");
    return { success: true, data: null };
  } catch {
    console.error("[undoRideGarminFill] failed", { rideId: parsed.data.rideId });
    return { success: false, error: "Failed to undo" };
  }
}

const pickSchema = z.object({ rideId: z.number().int().positive(), garminActivityId: z.number().int().positive() });

/** Fill the ride from one of the Garmin rides that match it. */
export async function pickRideGarminActivity(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = pickSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    if (!(await garminAllowedFor(auth.user.id))) return { success: false, error: "Not found" };
    const r = await pickRideActivity(auth.user.id, parsed.data.rideId, parsed.data.garminActivityId);
    if (r === "not_found") return { success: false, error: "Not found" };
    if (r === "already_filled") return { success: false, error: "The ride is already filled from Garmin" };
    revalidatePath("/programs", "layout");
    return { success: true, data: null };
  } catch {
    console.error("[pickRideGarminActivity] failed", { rideId: parsed.data.rideId });
    return { success: false, error: "Failed to fill the ride" };
  }
}
