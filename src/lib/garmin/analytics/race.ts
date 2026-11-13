/**
 * The race page's models (docs/plans/garmin-insights-design.md, 2.13): the
 * taper dates, a pacing guide, bricks against fresh runs, and fluid need by
 * temperature. Pure. Guides, never predictions: no finish time (it needs
 * drag and course data the app does not have).
 */

import { phaseLayout } from "@/lib/utils/periodization";
import { bikeGuide, runGuide } from "@/lib/utils/race-plan";
import { addDays } from "../dates";
import type { RaceDistance } from "./overview";

/** The taper's first day: after the ramp and peak weeks of the cycle. */
export function taperStart(startDate: string, durationWeeks: number): string {
  const { rampWeeks, peakWeeks } = phaseLayout(durationWeeks);
  return addDays(startDate, (rampWeeks + peakWeeks) * 7);
}

/**
 * Race intensity: the race-day plan's own rule (bikeGuide and runGuide in
 * src/lib/utils/race-plan.ts; docs/plans/nutrition-and-race-day.md, 2.5), so
 * the race page and the plan show the same watts and ceilings for the same
 * bike time, athlete level and thresholds.
 */
/** Under this durability (2.7) the bike guide takes the lower end. */
export const LOW_DURABILITY = 0.9;

export type PacingGuide = {
  bikeWatts: [number, number] | null;
  bikeHrCeiling: number | null;
  /** Run speed range, m/s. */
  runSpeed: [number, number] | null;
  runHrCeiling: number | null;
};

export function pacingGuide(input: {
  distance: RaceDistance;
  /** The expected bike time: the race plan's, else the assumed speed (bikeContext in src/lib/race-plans.ts). */
  bikeHours: number;
  firstTimer: boolean;
  ftp: number | null;
  cs: number | null;
  lthrBike: number | null;
  lthrRun: number | null;
}): PacingGuide {
  const bike = bikeGuide(input.distance, input.bikeHours, input.ftp, input.lthrBike, input.firstTimer);
  const run = runGuide(input.distance, input.cs, input.lthrRun);
  return { bikeWatts: bike.watts, bikeHrCeiling: bike.hrCeiling, runSpeed: run.speed, runHrCeiling: run.hrCeiling };
}

export type RunSummary = { id: number; day: string; speed: number; hr: number; durationS: number };

export type BrickComparison = RunSummary & {
  /** Mean speed of fresh runs within ± 5 bpm of this run's mean HR, 90 days around it. */
  freshSpeed: number | null;
  freshCount: number;
  /** (brick speed - fresh speed) / fresh speed, in %. Negative: slower off the bike. */
  diffPct: number | null;
};

export const FRESH_HR_WINDOW = 5;

export function compareBricks(brickRuns: RunSummary[], freshRuns: RunSummary[]): BrickComparison[] {
  return brickRuns.map((b) => {
    const from = addDays(b.day, -90);
    const to = addDays(b.day, 90);
    const peers = freshRuns.filter((r) => r.day >= from && r.day <= to && Math.abs(r.hr - b.hr) <= FRESH_HR_WINDOW);
    const freshSpeed = peers.length ? peers.reduce((s, r) => s + r.speed, 0) / peers.length : null;
    return { ...b, freshSpeed, freshCount: peers.length, diffPct: freshSpeed ? ((b.speed - freshSpeed) / freshSpeed) * 100 : null };
  });
}

export type FuelSession = {
  id: number;
  day: string;
  name: string;
  sport: string;
  durationS: number;
  /** Garmin's sweat-loss estimate, ml. */
  sweatMl: number | null;
  /** Mean temperature from the watch, °C. */
  temperature: number | null;
  carbsG: number | null;
  fluidMl: number | null;
};

/** Sessions with a sweat estimate and a temperature needed before the fluid model shows. */
export const FUEL_MIN_SESSIONS = 5;

/**
 * Sweat loss per hour against temperature, by least squares, and the fluid
 * need it gives at a few temperatures. Null under FUEL_MIN_SESSIONS sessions
 * or when the temperatures span under 4 °C (no slope to see).
 */
export function sweatModel(sessions: FuelSession[]): { slope: number; intercept: number; n: number; at: { temperature: number; mlPerHour: number }[] } | null {
  const pts = sessions
    .filter((s) => s.sweatMl && s.temperature !== null && s.durationS >= 1800)
    .map((s) => [s.temperature!, s.sweatMl! / (s.durationS / 3600)] as const);
  if (pts.length < FUEL_MIN_SESSIONS) return null;
  const xs = pts.map(([x]) => x);
  if (Math.max(...xs) - Math.min(...xs) < 4) return null;
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, [, y]) => a + y, 0) / n;
  const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  const slope = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx;
  const intercept = my - slope * mx;
  return {
    slope,
    intercept,
    n,
    at: [10, 15, 20, 25, 30].map((t) => ({ temperature: t, mlPerHour: Math.max(0, Math.round((intercept + slope * t) / 50) * 50) })),
  };
}
