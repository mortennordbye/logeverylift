/**
 * Triathlon discipline config — single source of truth for swim / bike / run.
 *
 * Shared by the set editor, the log modal, the metrics action, and the triathlon
 * plan generator so per-sport units, distance presets, and pace/PR brackets are
 * defined exactly once.
 *
 * A null discipline (every existing exercise) is NOT triathlon work and never
 * touches this config — callers fall back to the "run" entry, which preserves
 * the current running-mode behavior byte-for-byte.
 */

import type { disciplineEnum } from "@/db/schema/exercises";

export type Discipline = (typeof disciplineEnum)[number];

/** How the live pace/speed badge is rendered for a discipline. */
export type PaceFormatter = "per100m" | "kmh" | "perKm";

/** A distance bracket used for pace/speed personal records. */
export type PaceBracket = {
  /** Short label, e.g. "1500 m" or "40 km". */
  label: string;
  /** Inclusive lower bound in meters. */
  min: number;
  /** Inclusive upper bound in meters. */
  max: number;
  /** Representative distance in meters (the canonical race distance). */
  rep: number;
};

export type DisciplineConfig = {
  /** Capitalized noun, e.g. "Swim". */
  label: string;
  /** Verb used on the log button, e.g. "Log Swim". */
  logVerb: string;
  /** Distance preset values, in meters. */
  distancePresetsM: number[];
  /** Human labels aligned 1:1 with distancePresetsM. */
  distanceLabels: string[];
  /** Unit the free-text distance input accepts ("m" or "km"). */
  inputUnit: "m" | "km";
  /** Sensible default distance in meters when none is set yet. */
  defaultDistanceM: number;
  /** Which pace/speed formatter to use. */
  paceFormatter: PaceFormatter;
  /** Whether the incline picker is shown (treadmill running only). */
  showIncline: boolean;
  /** Distance brackets for pace/speed PRs. */
  paceBrackets: PaceBracket[];
};

export const DISCIPLINES: Discipline[] = ["swim", "bike", "run"];

export const DISCIPLINE_CONFIG: Record<Discipline, DisciplineConfig> = {
  swim: {
    label: "Swim",
    logVerb: "Log Swim",
    distancePresetsM: [100, 200, 400, 750, 1500, 1900, 3800],
    distanceLabels: ["100m", "200m", "400m", "750m", "1.5km", "1.9km", "3.8km"],
    inputUnit: "m",
    defaultDistanceM: 1500,
    paceFormatter: "per100m",
    showIncline: false,
    paceBrackets: [
      { label: "100 m", min: 90, max: 110, rep: 100 },
      { label: "400 m", min: 360, max: 440, rep: 400 },
      { label: "750 m", min: 700, max: 800, rep: 750 },
      { label: "1500 m", min: 1400, max: 1600, rep: 1500 },
      { label: "1.9 km", min: 1800, max: 2000, rep: 1900 },
      { label: "3.8 km", min: 3600, max: 4000, rep: 3800 },
    ],
  },
  bike: {
    label: "Ride",
    logVerb: "Log Ride",
    distancePresetsM: [5000, 10000, 20000, 40000, 90000, 180000],
    distanceLabels: ["5km", "10km", "20km", "40km", "90km", "180km"],
    inputUnit: "km",
    defaultDistanceM: 40000,
    paceFormatter: "kmh",
    showIncline: false,
    paceBrackets: [
      { label: "20 km", min: 19000, max: 21000, rep: 20000 },
      { label: "40 km", min: 38000, max: 42000, rep: 40000 },
      { label: "90 km", min: 85000, max: 95000, rep: 90000 },
      { label: "180 km", min: 170000, max: 190000, rep: 180000 },
    ],
  },
  run: {
    label: "Run",
    logVerb: "Log Run",
    distancePresetsM: [500, 1000, 2000, 3000, 5000, 10000, 15000, 21097, 42195],
    distanceLabels: ["0.5km", "1km", "2km", "3km", "5km", "10km", "15km", "21km", "42km"],
    inputUnit: "km",
    defaultDistanceM: 5000,
    paceFormatter: "perKm",
    showIncline: true,
    paceBrackets: [
      { label: "1 km", min: 800, max: 1200, rep: 1000 },
      { label: "3 km", min: 2700, max: 3300, rep: 3000 },
      { label: "5 km", min: 4700, max: 5300, rep: 5000 },
      { label: "10 km", min: 9500, max: 10500, rep: 10000 },
      { label: "Half", min: 20000, max: 22000, rep: 21097 },
      { label: "Full", min: 41000, max: 44000, rep: 42195 },
    ],
  },
};

/** Resolve a (possibly null) discipline to its config, falling back to run. */
export function disciplineConfig(d: Discipline | null | undefined): DisciplineConfig {
  return DISCIPLINE_CONFIG[d ?? "run"];
}

/**
 * Distance brackets a given effort falls into for pace-PR tracking. An effort
 * can match more than one overlapping bracket; it matches none if its distance
 * sits outside every bracket window (e.g. an odd 7 km run). Pure — used by
 * endurance PR detection.
 */
export function matchingPaceBrackets(
  discipline: Discipline,
  distanceMeters: number,
): PaceBracket[] {
  return DISCIPLINE_CONFIG[discipline].paceBrackets.filter(
    (b) => distanceMeters >= b.min && distanceMeters <= b.max,
  );
}

/**
 * Pace as seconds per meter — the unit-agnostic comparison key for endurance
 * PRs (lower is always faster, for swim/bike/run alike). Returns Infinity when
 * distance is non-positive so a zero-distance effort never wins a pace PR.
 */
export function paceSecondsPerMeter(durationSeconds: number, distanceMeters: number): number {
  return distanceMeters > 0 ? durationSeconds / distanceMeters : Infinity;
}
