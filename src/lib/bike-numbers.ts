/**
 * The numbers a bike session resolves against (docs/plans/bike-sessions.md,
 * section 3): the FTP with its basis, the FTP the watch uses, and the HR zones.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { thresholdValues } from "@/lib/session-compliance";
import type { ZoneSet } from "@/lib/utils/workout-steps";

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
};

/** Contract stub: the current FTP threshold only. S1 builds the rest. */
export async function getBikeNumbers(userId: string): Promise<BikeNumbers> {
  const t = await thresholdValues(userId);
  return {
    ftp: t.ftp !== undefined ? { value: t.ftp, basis: null, source: "manual", changedFrom: null } : null,
    watchFtp: null,
    zones: null,
  };
}
