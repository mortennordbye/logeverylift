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
 */
export function bodySignal(series: Point[], today: string, opts: { days?: number; band?: [number, number] | null } = {}): BodySignal {
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
  const value = newest && newest.date >= from ? newest.value : null;
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
