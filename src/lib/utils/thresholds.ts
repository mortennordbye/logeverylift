/**
 * Thresholds and field tests (docs/plans/athlete-profile.md, 2.3; decision
 * D12). Pure rules: what each kind means, its range, how a field test turns
 * into a value, how a pace is typed and shown in the user's units, which value
 * is current, and when it is stale.
 *
 * Stored metric: watts, bpm, and m/s for the two paces. The research says to
 * store pace as speed, because pace ranges invert
 * (docs/research/endurance-training-reference.md, "Every workout format
 * reduces to the same tree").
 */

import type { ThresholdKind, ThresholdProtocol } from "@/db/schema/athlete-profile";
import { FTP_FACTOR } from "@/lib/garmin/analytics/trends";
import { DEFAULT_UNITS, METERS_PER_MILE, METERS_PER_YARD, type Units } from "@/lib/utils/units";

export const THRESHOLD_LABEL: Record<ThresholdKind, string> = {
  ftp: "FTP",
  lthr_bike: "Threshold HR, bike",
  lthr_run: "Threshold HR, run",
  run_threshold_pace: "Threshold run pace",
  swim_css: "Swim CSS",
  max_hr: "Max HR",
};

/** How a kind is typed and shown: watts, bpm, run pace or swim pace. */
export type ThresholdMeasure = "watts" | "bpm" | "runPace" | "swimPace";

export const THRESHOLD_MEASURE: Record<ThresholdKind, ThresholdMeasure> = {
  ftp: "watts",
  lthr_bike: "bpm",
  lthr_run: "bpm",
  max_hr: "bpm",
  run_threshold_pace: "runPace",
  swim_css: "swimPace",
};

/** Allowed stored values per kind (metric). Outside is refused. */
export const THRESHOLD_RANGE: Record<ThresholdKind, { min: number; max: number }> = {
  ftp: { min: 50, max: 600 },
  lthr_bike: { min: 80, max: 230 },
  lthr_run: { min: 80, max: 230 },
  max_hr: { min: 80, max: 230 },
  // 12:00 to 2:00 per km.
  run_threshold_pace: { min: 1000 / 720, max: 1000 / 120 },
  // 4:00 to 0:50 per 100 m.
  swim_css: { min: 100 / 240, max: 100 / 50 },
};

/** Live threshold rows a user may keep per kind. */
export const THRESHOLDS_PER_KIND_MAX = 100;

/** Weeks after which a threshold reads as stale (research: retest every 4-8 weeks, a convention). */
export const THRESHOLD_STALE_WEEKS = 8;

/** Why a value is refused, or null when it is in range. */
export function thresholdRangeError(kind: ThresholdKind, value: number): string | null {
  const r = THRESHOLD_RANGE[kind];
  if (!Number.isFinite(value) || value < r.min - 1e-9 || value > r.max + 1e-9) {
    return `${THRESHOLD_LABEL[kind]} must be between ${formatThreshold(kind, r.min)} and ${formatThreshold(kind, r.max)}`;
  }
  return null;
}

// ── Pace in the user's units ─────────────────────────────────────────────────

/** Meters in the unit a pace is per: a km or a mile for runs, 100 m or 100 yd for swims. */
export function paceUnitMeters(measure: "runPace" | "swimPace", units: Units = DEFAULT_UNITS): number {
  if (measure === "runPace") return units.distance === "mi" ? METERS_PER_MILE : 1000;
  return units.swim === "yd" ? 100 * METERS_PER_YARD : 100;
}

export function paceUnitLabel(measure: "runPace" | "swimPace", units: Units = DEFAULT_UNITS): string {
  return measure === "runPace" ? `/${units.distance}` : `/100${units.swim}`;
}

/** Seconds per unit (a typed pace) as m/s. */
export function paceToSpeed(secondsPerUnit: number, unitMeters: number): number {
  return unitMeters / secondsPerUnit;
}

/** m/s as seconds per unit. */
export function speedToPace(speed: number, unitMeters: number): number {
  return unitMeters / speed;
}

/** "4:30", from seconds. */
export function minSec(totalSeconds: number): string {
  let m = Math.floor(totalSeconds / 60);
  let s = Math.round(totalSeconds - m * 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "4:30" or "270" as seconds; null when it is not a time. */
export function parseMinSec(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/** A stored value as text in the user's units: "265 W", "168 bpm", "4:30 /km", "1:45 /100m". */
export function formatThreshold(kind: ThresholdKind, value: number, units: Units = DEFAULT_UNITS): string {
  const measure = THRESHOLD_MEASURE[kind];
  if (measure === "watts") return `${Math.round(value)} W`;
  if (measure === "bpm") return `${Math.round(value)} bpm`;
  return `${minSec(speedToPace(value, paceUnitMeters(measure, units)))} ${paceUnitLabel(measure, units)}`;
}

/**
 * A typed value in the user's units as the stored value: a number for watts
 * and bpm, a min:ss pace for the two paces. Null when it cannot be read.
 */
export function parseThresholdInput(kind: ThresholdKind, text: string, units: Units = DEFAULT_UNITS): number | null {
  const measure = THRESHOLD_MEASURE[kind];
  if (measure === "watts" || measure === "bpm") {
    const n = Number(text.trim());
    return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
  }
  const seconds = parseMinSec(text);
  if (seconds == null || seconds <= 0) return null;
  return paceToSpeed(seconds, paceUnitMeters(measure, units));
}

// ── Field tests ──────────────────────────────────────────────────────────────

export type ProtocolInput = { key: string; label: string; kind: "seconds" | "bpm" | "watts" | "meters" };

export type ProtocolSpec = {
  protocol: ThresholdProtocol;
  name: string;
  /** The steps in plain words. */
  steps: string[];
  inputs: ProtocolInput[];
  /** The research line and its evidence label. */
  evidence: string;
};

/**
 * The field test for each kind that has one. Max HR has none: the research
 * gives no protocol, so it is typed in or taken from the watch.
 */
export const PROTOCOLS: Partial<Record<ThresholdKind, ProtocolSpec>> = {
  // Friel's 30-minute test: mean HR of the last 20 minutes approximates LTHR
  // (docs/research/endurance-training-reference.md:96, Study for the method).
  lthr_run: {
    protocol: "run_30min",
    name: "30-minute run test",
    steps: [
      "Warm up for 15 minutes, easy.",
      "Run 30 minutes alone, as hard as you can hold for the whole time. No race, no partner.",
      "Press lap at 10 minutes, so your watch shows the last 20 minutes on their own.",
      "Enter the average heart rate of the last 20 minutes.",
    ],
    inputs: [{ key: "avgHrLast20", label: "Average HR, last 20 min", kind: "bpm" }],
    evidence: "Friel 30-minute test (research line 96)",
  },
  // The same test. The research gives HR only; pace from the last 20 minutes is Inference.
  run_threshold_pace: {
    protocol: "run_30min",
    name: "30-minute run test",
    steps: [
      "Warm up for 15 minutes, easy.",
      "Run 30 minutes alone, as hard as you can hold for the whole time, on a flat route or a track.",
      "Press lap at 10 minutes, so your watch shows the last 20 minutes on their own.",
      "Enter the distance of the last 20 minutes.",
    ],
    inputs: [{ key: "distanceLast20Meters", label: "Distance, last 20 min", kind: "meters" }],
    evidence: "Friel 30-minute test (research line 96); pace from it is Inference",
  },
  lthr_bike: {
    protocol: "bike_30min",
    name: "30-minute ride test",
    steps: [
      "Warm up for 15 minutes, easy.",
      "Ride 30 minutes alone, as hard as you can hold for the whole time. A trainer or a flat road.",
      "Press lap at 10 minutes, so your device shows the last 20 minutes on their own.",
      "Enter the average heart rate of the last 20 minutes.",
    ],
    inputs: [{ key: "avgHrLast20", label: "Average HR, last 20 min", kind: "bpm" }],
    evidence: "Friel 30-minute test (research line 96)",
  },
  // FTP = 0.95 x best 20-minute power: coach convention, the app's Garmin rule (FTP_FACTOR).
  ftp: {
    protocol: "bike_30min",
    name: "30-minute ride test",
    steps: [
      "Warm up for 15 minutes, easy, with three short hard efforts.",
      "Ride 30 minutes alone, as hard as you can hold for the whole time, with a power meter or smart trainer.",
      "Enter the average power of your best 20 minutes. FTP is 95% of it.",
    ],
    inputs: [{ key: "avgPowerBest20", label: "Average power, best 20 min", kind: "watts" }],
    evidence: "20-minute power x 0.95 (Coach convention, research section on thresholds)",
  },
  // CSS = (400 - 200) / (T400 - T200) (research line 92, Coach convention plus study).
  swim_css: {
    protocol: "css_400_200",
    name: "400 m and 200 m swim test",
    steps: [
      "Warm up for 10-15 minutes.",
      "Swim 400 m as fast as you can hold. Note the time.",
      "Rest fully, 5-10 minutes easy.",
      "Swim 200 m as fast as you can. Note the time.",
    ],
    inputs: [
      { key: "t400Seconds", label: "400 m time", kind: "seconds" },
      { key: "t200Seconds", label: "200 m time", kind: "seconds" },
    ],
    evidence: "Critical swim speed from 400/200 m (research line 92)",
  },
};

/** The other swim test: Friel's T-time from a 1000 m time trial (research line 92). */
export const SWIM_T1000: ProtocolSpec = {
  protocol: "swim_t1000",
  name: "1000 m swim test",
  steps: ["Warm up for 10-15 minutes.", "Swim 1000 m as fast as you can hold. Note the time."],
  inputs: [{ key: "t1000Seconds", label: "1000 m time", kind: "seconds" }],
  evidence: "Friel T-time from 1000 m (research line 92)",
};

export function protocolsFor(kind: ThresholdKind): ProtocolSpec[] {
  const main = PROTOCOLS[kind];
  if (!main) return [];
  return kind === "swim_css" ? [main, SWIM_T1000] : [main];
}

/** Which protocols can set which kind. */
export const PROTOCOL_KINDS: Record<ThresholdProtocol, ThresholdKind[]> = {
  run_30min: ["lthr_run", "run_threshold_pace"],
  bike_30min: ["lthr_bike", "ftp"],
  css_400_200: ["swim_css"],
  swim_t1000: ["swim_css"],
};

const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/**
 * The value a field test gives for a kind, or an error. The value is stored
 * metric; the range check runs after this.
 */
export function valueFromTest(
  kind: ThresholdKind,
  protocol: ThresholdProtocol,
  data: Record<string, unknown>,
): { value: number } | { error: string } {
  if (!PROTOCOL_KINDS[protocol].includes(kind)) return { error: `The ${protocol} test does not set ${THRESHOLD_LABEL[kind]}` };
  if (protocol === "css_400_200") {
    const t400 = pos(data.t400Seconds);
    const t200 = pos(data.t200Seconds);
    if (!t400 || !t200) return { error: "Enter both the 400 m and the 200 m time" };
    if (t400 <= t200) return { error: "The 400 m time must be longer than the 200 m time" };
    return { value: 200 / (t400 - t200) };
  }
  if (protocol === "swim_t1000") {
    const t = pos(data.t1000Seconds);
    if (!t) return { error: "Enter the 1000 m time" };
    return { value: 1000 / t };
  }
  if (kind === "run_threshold_pace") {
    const d = pos(data.distanceLast20Meters);
    if (!d) return { error: "Enter the distance of the last 20 minutes" };
    return { value: d / 1200 };
  }
  if (kind === "ftp") {
    const p = pos(data.avgPowerBest20);
    if (!p) return { error: "Enter the average power of the best 20 minutes" };
    return { value: Math.round(p * FTP_FACTOR) };
  }
  const hr = pos(data.avgHrLast20);
  if (!hr) return { error: "Enter the average heart rate of the last 20 minutes" };
  return { value: Math.round(hr) };
}

/** Whether a given value agrees with the one a test gives (within 1%). */
export function agreesWithTest(given: number, fromTest: number): boolean {
  return Math.abs(given - fromTest) <= Math.max(0.01 * fromTest, 1e-6);
}

// ── Current value and staleness ──────────────────────────────────────────────

export type ThresholdRowLike = { id: number; kind: ThresholdKind; measuredOn: string; deletedAt?: Date | string | null };

/** The current row per kind: the live row with the latest date, then the highest id. */
export function currentThresholds<T extends ThresholdRowLike>(rows: T[]): Partial<Record<ThresholdKind, T>> {
  const out: Partial<Record<ThresholdKind, T>> = {};
  for (const r of rows) {
    if (r.deletedAt) continue;
    const cur = out[r.kind];
    if (!cur || r.measuredOn > cur.measuredOn || (r.measuredOn === cur.measuredOn && r.id > cur.id)) out[r.kind] = r;
  }
  return out;
}

/** Whole weeks from a date (YYYY-MM-DD) to today (YYYY-MM-DD). */
export function weeksSince(measuredOn: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${measuredOn}T00:00:00Z`);
  return Math.max(0, Math.floor(ms / (7 * 86_400_000)));
}

export function isStale(measuredOn: string, today: string): boolean {
  return weeksSince(measuredOn, today) >= THRESHOLD_STALE_WEEKS;
}
