/**
 * Phase sizing for "Make a triathlon plan" (docs/plans/plan-tab-redesign.md,
 * P4). Pure: no database. From the season start and the A race it gives the
 * season's phases (general, base, build, peak, taper) in order, each starting
 * the day after the one before, with the taper ending on race day. The taper
 * length is the race's default (taperDaysFor, docs/plans/seasons.md 2.5).
 */

import type { PhaseType } from "@/lib/utils/periodization";
import { addDaysStr, daysBetweenStr, taperDaysFor, type RaceLike } from "@/lib/utils/seasons";

/** The phase names the plan gives. No type prefix (docs/design/plan-redesign/spec.md, Words). */
export const TRIATHLON_PHASE_NAMES: Record<Exclude<PhaseType, "transition">, string> = {
  general: "Aerobic base + strength",
  base: "Longer ride and run",
  build: "Swim, intervals, bricks",
  peak: "Race pace + open water",
  taper: "Taper",
};

/** Fewer training days than this before the taper is too short for a plan. Inference. */
export const PLAN_MIN_TRAINING_DAYS = 28;
/** More training days than this would make a phase longer than a cycle can be (364 days). */
export const PLAN_MAX_TRAINING_DAYS = 728;
/** A peak of two weeks once there are 12 weeks of training, else one. Coach convention. */
export const PEAK_DAYS_LONG = 14;
export const PEAK_DAYS_SHORT = 7;
export const PEAK_LONG_FROM_DAYS = 84;
/**
 * Of the days before the peak: general takes a fifth and base two fifths, in
 * whole weeks; build takes what is left, so the taper lands on race day.
 * Inference, from the base-heavy split in the periodization research.
 */
export const GENERAL_SHARE = 0.2;
export const BASE_SHARE = 0.4;

export type PlannedPhase = {
  phaseType: Exclude<PhaseType, "transition">;
  name: string;
  /** Length in days. */
  days: number;
  /** The cycle columns: whole weeks when the length is whole weeks, else days. */
  durationWeeks: number;
  durationDays: number | null;
  /** First and last day (inclusive), YYYY-MM-DD. */
  start: string;
  end: string;
};

type PlanRace = Pick<RaceLike, "raceDate" | "discipline" | "distance" | "distanceMeters">;

/** The cycle columns for a length in days. */
export function phaseColumns(days: number): { durationWeeks: number; durationDays: number | null } {
  return days % 7 === 0 ? { durationWeeks: days / 7, durationDays: null } : { durationWeeks: Math.ceil(days / 7), durationDays: days };
}

const wholeWeeks = (days: number) => Math.floor(days / 7) * 7;

/**
 * The phases from `startDate` to the race, or a sentence that says why there
 * can be no plan. Phases with no days are left out (a short build has no
 * general phase).
 */
export function triathlonPhases(startDate: string, race: PlanRace): PlannedPhase[] | string {
  const total = daysBetweenStr(startDate, race.raceDate) + 1;
  if (total < 1) return "The race is before the start date.";
  const taper = taperDaysFor(race);
  const training = total - taper;
  if (training < PLAN_MIN_TRAINING_DAYS) {
    return `A plan needs at least ${Math.ceil((PLAN_MIN_TRAINING_DAYS + taper) / 7)} weeks before the race. Pick an earlier start or a later race.`;
  }
  if (training > PLAN_MAX_TRAINING_DAYS) return "The race is more than two years away. Pick a later start.";

  const peak = training >= PEAK_LONG_FROM_DAYS ? PEAK_DAYS_LONG : PEAK_DAYS_SHORT;
  const beforePeak = training - peak;
  const general = wholeWeeks(beforePeak * GENERAL_SHARE);
  const base = wholeWeeks(beforePeak * BASE_SHARE);
  const build = beforePeak - general - base;

  const lengths: [PlannedPhase["phaseType"], number][] = [
    ["general", general],
    ["base", base],
    ["build", build],
    ["peak", peak],
    ["taper", taper],
  ];
  const out: PlannedPhase[] = [];
  let cursor = startDate;
  for (const [phaseType, days] of lengths) {
    if (days <= 0) continue;
    const end = addDaysStr(cursor, days - 1);
    out.push({ phaseType, name: TRIATHLON_PHASE_NAMES[phaseType], days, ...phaseColumns(days), start: cursor, end });
    cursor = addDaysStr(end, 1);
  }
  return out;
}
