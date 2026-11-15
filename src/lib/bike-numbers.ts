/**
 * The numbers a bike session resolves against (docs/plans/bike-sessions.md,
 * section 3): the FTP with its basis, the FTP the watch uses, and the HR zones.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { garminActivityMetrics, garminDays } from "@/db/schema";
import { getAthleteProfile, listThresholds } from "@/lib/athlete-profile";
import { garminCyclingBands } from "@/lib/garmin/analytics/thresholds";
import { loadFtpEstimate } from "@/lib/garmin/ftp-estimate";
import { userToday } from "@/lib/user-settings";
import { ftpChangedFrom } from "@/lib/utils/bike-numbers";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { ZoneSet } from "@/lib/utils/workout-steps";
import { and, desc, eq, sql } from "drizzle-orm";

export type BikeNumbers = {
  ftp: {
    value: number;
    /** "best 60 min on 10 Nov"; null for a manual or test value. */
    basis: string | null;
    source: "manual" | "test" | "garmin";
    /** The value before the last automatic update, shown once; null otherwise. */
    changedFrom: number | null;
  } | null;
  /** functionalThresholdPower of the newest ride; null when no ride has it. */
  watchFtp: number | null;
  /** Custom zones, else Garmin CYCLING zones; null means the % LTHR tables (estimate). */
  zones: ZoneSet | null;
  /**
   * The automatic estimate from the last 90 days of rides, also while a manual
   * or test FTP pins it. Optional so other callers can build BikeNumbers without it.
   */
  estimate?: { value: number; basis: string } | null;
  /** The Garmin CYCLING zones, also while custom zones override them. */
  garminZones?: ZoneSet | null;
};

export async function getBikeNumbers(userId: string): Promise<BikeNumbers> {
  const today = toDateStr(await userToday(userId));
  const [rows, estimate, profile, [watch], [snapshot]] = await Promise.all([
    listThresholds(userId),
    loadFtpEstimate(userId, today),
    getAthleteProfile(userId),
    db
      .select({ ftp: sql<number>`(${garminActivityMetrics.metrics}->'thresholds'->>'ftp')::float8` })
      .from(garminActivityMetrics)
      .where(
        and(
          eq(garminActivityMetrics.userId, userId),
          eq(garminActivityMetrics.sport, "bike"),
          sql`${garminActivityMetrics.metrics}->'thresholds'->>'ftp' is not null`,
        ),
      )
      .orderBy(desc(garminActivityMetrics.day), desc(garminActivityMetrics.garminActivityId))
      .limit(1),
    db
      .select({ data: garminDays.data })
      .from(garminDays)
      .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "hr_zones")))
      .orderBy(desc(garminDays.calendarDate))
      .limit(1),
  ]);

  const ftpRows = rows.filter((r) => r.kind === "ftp");
  const cur = ftpRows[0];
  const garminBands = garminCyclingBands(snapshot?.data);
  const garminZones: ZoneSet | null = garminBands ? { source: "garmin", hr: garminBands } : null;
  const custom = profile?.bikeHrZones;

  return {
    ftp: cur
      ? {
          value: cur.value,
          // An automatic write keeps its basis in notes.
          basis: cur.source === "garmin" ? cur.notes : null,
          source: cur.source,
          changedFrom: ftpChangedFrom(ftpRows, today),
        }
      : null,
    watchFtp: watch?.ftp ?? null,
    zones: custom?.length === 5 ? { source: "custom", hr: custom } : garminZones,
    estimate,
    garminZones,
  };
}
