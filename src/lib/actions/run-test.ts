"use server";

/**
 * Save of a run threshold test's result (docs/plans/run-logger.md, 4.10):
 * "New threshold pace 5:30 /km · LTHR 176 · Save" on the run summary. The
 * values are worked out again here from the stored run, never taken from the
 * client, and each is added as a threshold row through the same path as the
 * training numbers page (`addThreshold`): source test, protocol run_30min
 * with its input, measured on the run's date. Every % target then reads the
 * new values; runs keep the thresholds frozen in their plan.
 */

import { db } from "@/db";
import { rideEvents, rides } from "@/db/schema";
import { PlanConflictError, PlanStateError, addThreshold } from "@/lib/athlete-profile";
import { rideStepLogs } from "@/lib/bike-exercise-view";
import { enduranceEnabledFor } from "@/lib/endurance";
import { runThresholdTest } from "@/lib/run-test";
import { getUserSettings } from "@/lib/user-settings";
import type { RidePlan } from "@/lib/utils/ride-timeline";
import { runTestThresholds } from "@/lib/utils/run-test";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const saveSchema = z.object({ rideId: z.number().int().positive() });

export async function saveRunThreshold(data: unknown): Promise<ActionResult<{ lthr: number | null; speed: number | null }>> {
  const auth = await requireSession();
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  try {
    if (!(await enduranceEnabledFor(userId))) return { success: false, error: "Endurance features are not on for this account" };
    const [ride] = await db.select().from(rides).where(and(eq(rides.id, parsed.data.rideId), eq(rides.userId, userId), eq(rides.sport, "run")));
    if (!ride) return { success: false, error: "Not found" };
    const plan = ride.plan as RidePlan;
    const events = (await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq))).map((e) => ({
      seq: e.seq,
      kind: e.kind,
      value: e.value,
      at: e.at.getTime(),
      stepKey: e.stepKey,
    }));
    const { logs, timeline } = await rideStepLogs(userId, { plan, events, serverNow: Date.now(), ride: { sessionId: ride.sessionId, heartbeatAt: ride.heartbeatAt?.getTime() ?? null } });
    if (timeline.status !== "finished" && timeline.status !== "ended_early") return { success: false, error: "The run is still running" };
    const { timeZone } = await getUserSettings(userId);
    const test = await runThresholdTest(userId, { plan, startedAt: ride.startedAt, timeZone }, logs, timeline, events);
    if (!test?.result) return { success: false, error: "This run gives no threshold" };
    // Under the threshold lock: a stored row of this test, date and value is kept, so two saves add one row each.
    for (const row of runTestThresholds(test.result)) {
      await addThreshold(
        { userId, writer: "user" },
        { kind: row.kind, value: row.value, source: "test", protocol: "run_30min", testData: row.testData, measuredOn: test.measuredOn },
        { once: true },
      );
    }
    revalidatePath("/programs", "layout");
    revalidatePath("/more/account", "layout");
    return { success: true, data: { lthr: test.result.lthr, speed: test.result.speed } };
  } catch (e) {
    if (e instanceof PlanStateError) return { success: false, error: e.message };
    if (e instanceof PlanConflictError) return { success: false, error: "This changed somewhere else. Reload and try again." };
    console.error("[saveRunThreshold] failed", { rideId: parsed.data.rideId });
    return { success: false, error: "Could not save" };
  }
}
