/** Automatic FTP from the last 90 days of rides (docs/plans/bike-sessions.md, section 3, D1). */

import { db } from "@/db";
import { garminActivityMetrics } from "@/db/schema";
import { addThreshold, listThresholds } from "@/lib/athlete-profile";
import { userToday } from "@/lib/user-settings";
import { ftpMoved } from "@/lib/utils/bike-numbers";
import { toDateStr } from "@/lib/utils/cycle-position";
import { currentThresholds } from "@/lib/utils/thresholds";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { addDays } from "./dates";
import type { Efforts } from "./analytics/efforts";
import { THRESHOLD_DAYS, ftpBasis, ftpEstimate } from "./analytics/trends";

/** The FTP estimate on `today` (YYYY-MM-DD) with its basis text, or null with no ride that gives one. */
export async function loadFtpEstimate(userId: string, today: string): Promise<{ value: number; basis: string } | null> {
  const rows = await db
    .select({
      id: garminActivityMetrics.garminActivityId,
      day: garminActivityMetrics.day,
      efforts: sql<Efforts>`${garminActivityMetrics.metrics}->'efforts'`,
    })
    .from(garminActivityMetrics)
    .where(
      and(
        eq(garminActivityMetrics.userId, userId),
        eq(garminActivityMetrics.sport, "bike"),
        gte(garminActivityMetrics.day, addDays(today, -(THRESHOLD_DAYS - 1))),
        lte(garminActivityMetrics.day, today),
        sql`${garminActivityMetrics.metrics} ? 'efforts'`,
      ),
    );
  const est = ftpEstimate(
    rows.map((r) => ({ id: r.id, day: r.day, sport: "bike", indoor: false, durationS: null, efforts: r.efforts, decoupling: null, watchLthr: null })),
    today,
  );
  return est ? { value: est.value, basis: ftpBasis(est) } : null;
}

/**
 * After a sync: store the estimate as a threshold with source garmin when it
 * moved by 3 % or more. A current manual or test FTP pins it: nothing is written.
 */
export async function updateFtpEstimate(userId: string, now: Date): Promise<void> {
  const today = toDateStr(await userToday(userId, now));
  const est = await loadFtpEstimate(userId, today);
  if (!est) return;
  const current = currentThresholds(await listThresholds(userId)).ftp;
  if (current && current.source !== "garmin") return;
  if (current && !ftpMoved(current.value, est.value)) return;
  await addThreshold(
    { userId, writer: "sync", reason: "FTP estimate from your rides" },
    { kind: "ftp", value: est.value, measuredOn: today, source: "garmin", notes: est.basis },
  );
}
