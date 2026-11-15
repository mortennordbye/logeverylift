"use server";

/**
 * The bike numbers in the app (docs/plans/bike-sessions.md, section 3): FTP
 * back to automatic, and custom bike HR zones. Writes go through the revision
 * layer as the user, so Plan history shows them with Undo.
 */

import { PlanConflictError, PlanNotFoundError, PlanStateError, addThreshold, saveAthleteProfile } from "@/lib/athlete-profile";
import { getBikeNumbers, type BikeNumbers } from "@/lib/bike-numbers";
import { enduranceEnabledFor } from "@/lib/endurance";
import { bandsFromFloors } from "@/lib/garmin/analytics/thresholds";
import { loadFtpEstimate } from "@/lib/garmin/ftp-estimate";
import { userToday } from "@/lib/user-settings";
import { zoneFloorsError } from "@/lib/utils/bike-numbers";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function known(e: unknown, action: string): ActionResult<never> {
  if (e instanceof PlanNotFoundError || e instanceof PlanStateError) return { success: false, error: e.message };
  if (e instanceof PlanConflictError) return { success: false, error: "This changed somewhere else. Reload and try again." };
  console.error(`[bikeNumbers] ${action} failed`, e);
  return { success: false, error: "Could not save" };
}

function refresh() {
  revalidatePath("/more/thresholds");
  revalidatePath("/planned/[id]", "page");
}

/** The bike numbers for the Thresholds page; `endurance` says whether custom zones can be set. */
export async function getBikeNumbersData(): Promise<ActionResult<{ numbers: BikeNumbers; endurance: boolean }>> {
  const auth = await requireSession();
  try {
    const [numbers, endurance] = await Promise.all([getBikeNumbers(auth.user.id), enduranceEnabledFor(auth.user.id)]);
    return { success: true, data: { numbers, endurance } };
  } catch (e) {
    console.error("[bikeNumbers] getBikeNumbersData failed", e);
    return { success: false, error: "Could not load your bike numbers" };
  }
}

/** Store the current estimate as the FTP with source garmin: a pin by hand or test no longer applies. */
export async function setFtpAutomatic(): Promise<ActionResult<{ value: number }>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const today = toDateStr(await userToday(userId));
    const est = await loadFtpEstimate(userId, today);
    if (!est) return { success: false, error: "No ride with power in the last 90 days. Set your FTP by hand." };
    const { threshold } = await addThreshold(
      { userId, writer: "user" },
      { kind: "ftp", value: est.value, measuredOn: today, source: "garmin", notes: est.basis },
    );
    refresh();
    return { success: true, data: { value: threshold.value } };
  } catch (e) {
    return known(e, "setFtpAutomatic");
  }
}

const zonesSchema = z.union([
  z.object({ floors: z.array(z.number().int()).length(5), maxHr: z.number().int() }).strict(),
  z.object({ clear: z.literal(true) }).strict(),
]);

/** Set custom bike HR zones from five zone starts and max HR, or clear them to follow Garmin. */
export async function saveBikeHrZones(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = zonesSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  let bikeHrZones = null;
  if ("floors" in parsed.data) {
    const err = zoneFloorsError(parsed.data.floors, parsed.data.maxHr);
    if (err) return { success: false, error: err };
    bikeHrZones = bandsFromFloors(parsed.data.floors, parsed.data.maxHr);
  }
  try {
    await saveAthleteProfile({ userId: auth.user.id, writer: "user" }, { bikeHrZones });
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "saveBikeHrZones");
  }
}
