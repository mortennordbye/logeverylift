/**
 * Pure pieces of the Garmin Overview tab: a body signal with its own normal
 * range, and the state of the race the active cycle builds to.
 */

import { periodizedLoad, deloadCadenceForLevel, type AthleteLevel, type TrainingGoal, type TrainingPhase } from "@/lib/utils/periodization";
import { addDays } from "../dates";

export type Point = { date: string; value: number };

export type BodySignal = {
  /** Newest value in the window, and its date. */
  value: number | null;
  date: string | null;
  /** The last `days` days, oldest first, for the tile's line. */
  points: Point[];
  /** Your normal: a stored band, else mean ± 1 SD of the 28 days before the newest value. */
  normal: [number, number] | null;
  /** Where the newest value sits against the normal. */
  state: "below" | "within" | "above" | null;
};

/** Days of history needed before a mean ± SD range counts as "your normal". */
export const NORMAL_MIN_POINTS = 10;

export function normalRange(values: number[]): [number, number] | null {
  if (values.length < NORMAL_MIN_POINTS) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return [mean - sd, mean + sd];
}

/**
 * One tile's data from a dated series (any order, gaps allowed). `band`
 * overrides the computed normal, for signals that have their own (HRV).
 * `days` is the history kept for the chart; the newest value counts only
 * when it is at most `fresh` days old (default: `days`).
 */
export function bodySignal(series: Point[], today: string, opts: { days?: number; fresh?: number; band?: [number, number] | null } = {}): BodySignal {
  const days = opts.days ?? 14;
  const sorted = [...series].filter((p) => Number.isFinite(p.value) && p.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const newest = sorted.at(-1) ?? null;
  const from = addDays(today, -(days - 1));
  const points = sorted.filter((p) => p.date >= from);
  let normal = opts.band ?? null;
  if (!normal && newest) {
    const base = addDays(newest.date, -28);
    normal = normalRange(sorted.filter((p) => p.date >= base && p.date < newest.date).map((p) => p.value));
  }
  const value = newest && newest.date >= addDays(today, -((opts.fresh ?? days) - 1)) ? newest.value : null;
  const state = value === null || !normal ? null : value < normal[0] ? "below" : value > normal[1] ? "above" : "within";
  return { value, date: value === null ? null : newest!.date, points, normal, state };
}

export type RaceDistance = "full" | "half";

export const RACE_LABEL: Record<RaceDistance, string> = { full: "Ironman", half: "Ironman 70.3" };

/** Race distances in metres per leg. */
export const RACE_LEGS: Record<RaceDistance, { swim: number; bike: number; run: number }> = {
  full: { swim: 3800, bike: 180_000, run: 42_195 },
  half: { swim: 1900, bike: 90_000, run: 21_097 },
};

export type CycleForRace = {
  name: string;
  startDate: string | null;
  durationWeeks: number;
  goal: TrainingGoal;
  athleteLevel: AthleteLevel | null;
  raceDate: string | null;
  raceDistance: RaceDistance | null;
};

export type RaceStatus = {
  cycleName: string;
  /** The race date, or the cycle's last day when no race is set (raceSet false). */
  raceDay: string;
  raceSet: boolean;
  distance: RaceDistance | null;
  daysToRace: number;
  /** 1-based week of the cycle today, clamped to the cycle. Null before the start. */
  week: number | null;
  phase: TrainingPhase | null;
  isDeload: boolean;
};

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export function raceStatus(cycle: CycleForRace | null, today: string): RaceStatus | null {
  if (!cycle?.startDate) return null;
  const lastDay = addDays(cycle.startDate, cycle.durationWeeks * 7 - 1);
  const raceDay = cycle.raceDate ?? lastDay;
  const elapsed = daysBetween(cycle.startDate, today);
  const week = elapsed < 0 ? null : Math.min(cycle.durationWeeks, Math.floor(elapsed / 7) + 1);
  const load = week ? periodizedLoad(week, cycle.durationWeeks, cycle.goal, deloadCadenceForLevel(cycle.athleteLevel)) : null;
  return {
    cycleName: cycle.name,
    raceDay,
    raceSet: cycle.raceDate !== null,
    distance: cycle.raceDistance,
    daysToRace: daysBetween(today, raceDay),
    week,
    phase: load?.phase ?? null,
    isDeload: load?.isDeload ?? false,
  };
}

// ── Garmin's own numbers ────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Garmin's HRV status word (hrv daily summary `status`), or null for NONE and unknown words. */
export const HRV_STATUS_LABEL: Record<string, string> = { BALANCED: "Balanced", UNBALANCED: "Unbalanced", LOW: "Low", POOR: "Poor" };

export type IntensityWeek = {
  /** Garmin's rule: moderate minutes plus vigorous minutes counted twice. */
  minutes: number;
  goal: number | null;
  /** Monday to Sunday of the week holding `date`; 0 for a day with no summary or still to come. */
  days: { date: string; moderate: number; vigorous: number }[];
};

/** Intensity minutes for the Monday-start week of `date`, from daily summaries (user_summary). */
export function intensityWeek(rows: { date: string; data: Json }[], date: string, monday: string): IntensityWeek {
  const byDate = new Map(rows.map((r) => [r.date, r.data]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const j = d <= date ? byDate.get(d) : undefined;
    return { date: d, moderate: num(j?.moderateIntensityMinutes) ?? 0, vigorous: num(j?.vigorousIntensityMinutes) ?? 0 };
  });
  const goal = num(byDate.get(date)?.intensityMinutesGoal);
  return { minutes: days.reduce((s, d) => s + d.moderate + 2 * d.vigorous, 0), goal: goal && goal > 0 ? goal : null, days };
}

export type FitnessAgePart = { key: string; label: string; value: number; unit: string; target: number | null; potentialAge: number | null };

export type FitnessAge = {
  age: number;
  chronological: number | null;
  /** What Garmin says would lower it, most impact first; parts with no target are context. */
  parts: FitnessAgePart[];
};

const FITNESS_AGE_PARTS: Record<string, { label: string; unit: string }> = {
  rhr: { label: "Resting HR", unit: "bpm" },
  bodyFat: { label: "Body fat", unit: "%" },
  bmi: { label: "BMI", unit: "" },
  vigorousDaysAvg: { label: "Vigorous days a week", unit: "" },
  vigorousMinutesAvg: { label: "Vigorous minutes a week", unit: "min" },
};

/** Garmin's fitness age answer (fitnessage-service), or null when it has no age. */
export function parseFitnessAge(j: Json | null | undefined): FitnessAge | null {
  const age = num(j?.fitnessAge);
  if (age === null) return null;
  const comps = (j?.components ?? {}) as Record<string, Json>;
  const parts = Object.entries(FITNESS_AGE_PARTS).flatMap(([key, meta]) => {
    const c = comps[key];
    const value = num(c?.value);
    if (value === null) return [];
    return [{ part: { key, ...meta, value, target: num(c.targetValue), potentialAge: num(c.potentialAge) }, priority: num(c.priority) ?? 99 }];
  });
  parts.sort((a, b) => a.priority - b.priority);
  return { age: Math.round(age * 10) / 10, chronological: num(j?.chronologicalAge), parts: parts.map((p) => p.part) };
}

/**
 * The mean of each point's `days` calendar days (it and the days before), for
 * points with at least `min` values in that window. Steps are judged on a week,
 * as one lazy day says little.
 */
export function rollingMean(series: Point[], days = 7, min = 4): Point[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.flatMap((p) => {
    const from = addDays(p.date, -(days - 1));
    const win = sorted.filter((q) => q.date >= from && q.date <= p.date);
    return win.length >= min ? [{ date: p.date, value: Math.round(win.reduce((s, q) => s + q.value, 0) / win.length) }] : [];
  });
}
