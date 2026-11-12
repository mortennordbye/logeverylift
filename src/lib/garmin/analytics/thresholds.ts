/**
 * Thresholds as they were on an activity's date (2.1): max HR, resting HR,
 * LTHR and FTP. Source order: the activity's own FIT time-in-zone message,
 * then the nearest stored hr_zones snapshot, then nothing.
 */

export type Thresholds = {
  maxHr: number | null;
  restHr: number | null;
  lthr: number | null;
  /** Power FTP for this activity's sport; Garmin's running power FTP is not a cycling FTP. */
  ftp: number | null;
  source: "fit" | "snapshot" | "none";
};

type Json = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** The FIT time-in-zone message that covers the whole session. */
export function sessionZoneMessage(timeInZone: unknown): Json | null {
  if (!Array.isArray(timeInZone)) return null;
  const msgs = timeInZone.filter((m): m is Json => m !== null && typeof m === "object");
  return msgs.find((m) => m.referenceMesg === "session") ?? msgs[0] ?? null;
}

/** hr_zones snapshot: an array of { sport, maxHeartRateUsed, restingHeartRateUsed, lactateThresholdHeartRateUsed, zoneNFloor }. */
export function snapshotZones(snapshot: unknown, sport: "CYCLING" | "DEFAULT"): Json | null {
  if (!Array.isArray(snapshot)) return null;
  const rows = snapshot.filter((r): r is Json => r !== null && typeof r === "object");
  return rows.find((r) => r.sport === sport) ?? rows.find((r) => r.sport === "DEFAULT") ?? null;
}

export function thresholdsFor(input: { timeInZone: unknown; snapshot: unknown; isBike: boolean }): Thresholds {
  const fit = sessionZoneMessage(input.timeInZone);
  if (fit && num(fit.thresholdHeartRate) && num(fit.maxHeartRate)) {
    return {
      maxHr: num(fit.maxHeartRate),
      restHr: num(fit.restingHeartRate),
      lthr: num(fit.thresholdHeartRate),
      ftp: num(fit.functionalThresholdPower),
      source: "fit",
    };
  }
  const snap = snapshotZones(input.snapshot, input.isBike ? "CYCLING" : "DEFAULT");
  if (snap && num(snap.maxHeartRateUsed)) {
    return {
      maxHr: num(snap.maxHeartRateUsed),
      restHr: num(snap.restingHeartRateUsed),
      lthr: num(snap.lactateThresholdHeartRateUsed),
      ftp: null,
      source: "snapshot",
    };
  }
  return { maxHr: null, restHr: null, lthr: null, ftp: null, source: "none" };
}
