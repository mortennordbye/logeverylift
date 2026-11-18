"use server";

/**
 * Save of an FTP test ride's result (docs/plans/bike-ride-logger.md, 4.9):
 * "New FTP 186 W · Save" on the ride summary. The FTP is worked out again
 * here from the stored ride, never taken from the client, and added as a
 * threshold row through the same path as the training numbers page
 * (`addThreshold`): source test, the ramp or 20 min protocol with its input,
 * measured on the ride's date. Every % FTP target then shows the new watts;
 * rides keep the FTP frozen in their plan.
 */

import { PlanConflictError, PlanStateError, addThreshold } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { rideReport } from "@/lib/ride-report";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const saveSchema = z.object({ rideId: z.number().int().positive() });

export async function saveRideFtp(data: unknown): Promise<ActionResult<{ ftp: number }>> {
  const auth = await requireSession();
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  try {
    if (!(await enduranceEnabledFor(userId))) return { success: false, error: "Endurance features are not on for this account" };
    const report = await rideReport(userId, { rideId: parsed.data.rideId });
    if (!report) return { success: false, error: "Not found" };
    if (report.status !== "finished" && report.status !== "ended_early") return { success: false, error: "The ride is still running" };
    const t = report.ftpTest;
    if (!t || t.proposedFtp === null || !t.protocol || !t.testData) return { success: false, error: "This ride gives no FTP" };
    // Under the threshold lock: a stored row of this test, date and value is kept, so two saves add one row.
    await addThreshold(
      { userId, writer: "user" },
      { kind: "ftp", value: t.proposedFtp, source: "test", protocol: t.protocol, testData: t.testData, measuredOn: t.measuredOn },
      { once: true },
    );
    revalidatePath("/programs", "layout");
    revalidatePath("/more/account", "layout");
    return { success: true, data: { ftp: t.proposedFtp } };
  } catch (e) {
    if (e instanceof PlanStateError) return { success: false, error: e.message };
    if (e instanceof PlanConflictError) return { success: false, error: "This changed somewhere else. Reload and try again." };
    console.error("[saveRideFtp] failed", { rideId: parsed.data.rideId });
    return { success: false, error: "Could not save" };
  }
}
