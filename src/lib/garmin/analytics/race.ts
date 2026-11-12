/**
 * The race page's models (docs/plans/garmin-insights-design.md, 2.13): the
 * taper dates, a pacing guide, bricks against fresh runs, and fluid need by
 * temperature. Pure. Guides, never predictions: no finish time (it needs
 * drag and course data the app does not have).
 */

import { phaseLayout } from "@/lib/utils/periodization";
import { addDays } from "../dates";
import type { RaceDistance } from "./overview";

/** The taper's first day: after the ramp and peak weeks of the cycle. */
export function taperStart(startDate: string, durationWeeks: number): string {
  const { rampWeeks, peakWeeks } = phaseLayout(durationWeeks);
  return addDays(startDate, (rampWeeks + peakWeeks) * 7);
}

/**
 * Race intensity as a share of threshold. Bike: share of FTP (plan 2.13:
 * 68 to 75 % for a full; 75 to 82 % for a 70.3). Run: share of critical speed
 * (about 80 to 85 % full, 85 to 90 % 70.3). Heart-rate ceiling: the top of the
 * low band, 85 % of LTHR (zones.ts), the same for both.
 */
export const PACING: Record<RaceDistance, { bike: [number, number]; run: [number, number] }> = {
  full: { bike: [0.68, 0.75], run: [0.8, 0.85] },
  half: { bike: [0.75, 0.82], run: [0.85, 0.9] },
};
export const HR_CEILING_SHARE = 0.85;
/** Under this durability (2.7) the bike guide takes the lower end. */
export const LOW_DURABILITY = 0.9;

export type PacingGuide = {
  bikeWatts: [number, number] | null;
  bikeHrCeiling: number | null;
  /** Run speed range, m/s. */
  runSpeed: [number, number] | null;
  runHrCeiling: number | null;
};

export function pacingGuide(input: { distance: RaceDistance; ftp: number | null; cs: number | null; lthrBike: number | null; lthrRun: number | null }): PacingGuide {
  const p = PACING[input.distance];
  return {
    bikeWatts: input.ftp ? [Math.round(input.ftp * p.bike[0]), Math.round(input.ftp * p.bike[1])] : null,
    bikeHrCeiling: input.lthrBike ? Math.round(input.lthrBike * HR_CEILING_SHARE) : null,
    runSpeed: input.cs ? [input.cs * p.run[0], input.cs * p.run[1]] : null,
    runHrCeiling: input.lthrRun ? Math.round(input.lthrRun * HR_CEILING_SHARE) : null,
  };
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
