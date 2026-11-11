/**
 * Three-band intensity distribution and the polarization index (2.9).
 * low < 85 % LTHR, mid 85 to 100 %, high > LTHR.
 */

import { sampleDurations } from "./load";

export type Bands = { low: number; mid: number; high: number };

export const EMPTY_BANDS: Bands = { low: 0, mid: 0, high: 0 };

/** Seconds per band from an HR stream. */
export function bandsFromStream(t: (number | null)[], hr: (number | null)[], lthr: number): Bands {
  const durations = sampleDurations(t);
  const out = { ...EMPTY_BANDS };
  hr.forEach((h, i) => {
    if (h === null || h <= 0 || !durations[i]) return;
    if (h < 0.85 * lthr) out.low += durations[i];
    else if (h <= lthr) out.mid += durations[i];
    else out.high += durations[i];
  });
  return out;
}

/** Fallback from Garmin's five HR zones: 1 and 2 low, 3 and 4 mid, 5 high. */
export function bandsFromZones(secondsInZone: (number | null)[]): Bands {
  const z = secondsInZone.map((s) => (s && s > 0 ? s : 0));
  return { low: (z[0] ?? 0) + (z[1] ?? 0), mid: (z[2] ?? 0) + (z[3] ?? 0), high: z[4] ?? 0 };
}

export function addBands(a: Bands, b: Bands): Bands {
  return { low: a.low + b.low, mid: a.mid + b.mid, high: a.high + b.high };
}

/**
 * Polarization index: log10(low / mid x high x 100), bands as fractions.
 * Null with no high-intensity time (the index is not defined). A zero mid uses 0.01.
 */
export function polarizationIndex(b: Bands): number | null {
  const total = b.low + b.mid + b.high;
  if (total <= 0 || b.high <= 0) return null;
  const low = b.low / total;
  const mid = Math.max(b.mid / total, 0.01);
  const high = b.high / total;
  return Math.log10((low / mid) * high * 100);
}

export type DistributionLabel = "polarized" | "pyramidal" | "threshold" | "mixed" | "no_high" | "no_data";

export function distributionLabel(b: Bands): DistributionLabel {
  const total = b.low + b.mid + b.high;
  if (total <= 0) return "no_data";
  if (b.high <= 0) return "no_high";
  const pi = polarizationIndex(b);
  if (pi !== null && pi > 2 && b.low > b.mid && b.high > b.mid) return "polarized";
  if (b.low > b.mid && b.mid > b.high) return "pyramidal";
  if (b.mid >= b.low && b.mid >= b.high) return "threshold";
  return "mixed";
}
