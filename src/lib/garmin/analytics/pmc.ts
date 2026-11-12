/**
 * Fitness, fatigue and form (2.3), per sport and in total.
 *
 *   CTL(t) = CTL(t-1) + (load(t) - CTL(t-1)) / 42   fitness
 *   ATL(t) = ATL(t-1) + (load(t) - ATL(t-1)) / 7    fatigue
 *   TSB(t) = CTL(t-1) - ATL(t-1)                    form on the morning of day t
 *
 * Cold start: CTL and ATL start at the mean daily load of the first 28 days
 * (or fewer, if the series is shorter). The first CALIBRATION_DAYS are marked
 * calibrating. Strength counts in total fitness and fatigue (decision O-2).
 */

import { addDays } from "../dates";
import { SPORTS, type Sport } from "./sport";

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
export const CALIBRATION_DAYS = 42;

export type Track = "total" | Sport;
export const TRACKS: Track[] = ["total", ...SPORTS];

export type DayLoad = Partial<Record<Sport, number>>;

export type PmcPoint = { ctl: number; atl: number; tsb: number; load: number };

export type PmcDay = {
  date: string;
  calibrating: boolean;
  tracks: Record<Track, PmcPoint>;
  /** CTL(t) - CTL(t-7), total. Null in the first week. */
  ramp: number | null;
  /** Mean / SD of total daily load over the last 7 days. Null when SD is 0 or under 7 days. */
  monotony: number | null;
};

function totalOf(day: DayLoad | undefined): number {
  return SPORTS.reduce((s, sp) => s + (day?.[sp] ?? 0), 0);
}

function loadOf(day: DayLoad | undefined, track: Track) {
  return track === "total" ? totalOf(day) : (day?.[track] ?? 0);
}

/** One row per date from start to end (inclusive). Days without load are rest days. */
export function computePmc(loads: Record<string, DayLoad>, start: string, end: string): PmcDay[] {
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  if (!dates.length) return [];

  const seedDays = dates.slice(0, 28);
  const prev = {} as Record<Track, { ctl: number; atl: number }>;
  for (const track of TRACKS) {
    const seed = seedDays.reduce((s, d) => s + loadOf(loads[d], track), 0) / seedDays.length;
    prev[track] = { ctl: seed, atl: seed };
  }

  const out: PmcDay[] = [];
  dates.forEach((date, i) => {
    const tracks = {} as Record<Track, PmcPoint>;
    for (const track of TRACKS) {
      const load = loadOf(loads[date], track);
      const tsb = prev[track].ctl - prev[track].atl;
      const ctl = prev[track].ctl + (load - prev[track].ctl) / CTL_DAYS;
      const atl = prev[track].atl + (load - prev[track].atl) / ATL_DAYS;
      tracks[track] = { ctl, atl, tsb, load };
      prev[track] = { ctl, atl };
    }
    const week = dates.slice(Math.max(0, i - 6), i + 1).map((d) => totalOf(loads[d]));
    const mean = week.reduce((a, b) => a + b, 0) / week.length;
    const sd = Math.sqrt(week.reduce((a, b) => a + (b - mean) ** 2, 0) / week.length);
    out.push({
      date,
      calibrating: i < CALIBRATION_DAYS,
      tracks,
      ramp: i >= 7 ? tracks.total.ctl - out[i - 7].tracks.total.ctl : null,
      monotony: week.length === 7 && sd > 0 ? mean / sd : null,
    });
  });
  return out;
}

export type RampBand = "normal" | "fast" | "warning";

/** Up to 5 a week is normal, 5 to 8 fast, above 8 a warning. */
export function rampBand(ramp: number): RampBand {
  return ramp > 8 ? "warning" : ramp > 5 ? "fast" : "normal";
}
