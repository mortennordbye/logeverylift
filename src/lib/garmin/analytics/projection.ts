/**
 * Fitness, fatigue and form run forward to race day (plan 2.13). Future daily
 * load is the mean daily load of the last 7 days, scaled week by week by the
 * cycle's periodized load multiplier against this week's. A band of ± 15 %
 * load shows how much the answer moves if you train a bit more or less.
 * Pure.
 */

import { deloadCadenceForLevel, periodizedLoad, type AthleteLevel, type TrainingGoal } from "@/lib/utils/periodization";
import { addDays } from "../dates";
import { ATL_DAYS, CTL_DAYS } from "./pmc";

export type ProjectionCycle = { startDate: string; durationWeeks: number; goal: TrainingGoal; athleteLevel: AthleteLevel | null };

export type Projection = {
  /** Days after today up to and including race day. */
  dates: string[];
  ctl: number[];
  atl: number[];
  tsb: number[];
  /** The form band: the lower and higher form of the 85 % and 115 % load runs, per day. */
  tsbLow: number[];
  tsbHigh: number[];
  raceDay: string;
  race: { tsb: number; ctl: number; peakCtl: number; dropPct: number; verdict: RaceVerdict };
};

/** Target on race morning (plan 2.13): form +10 to +25, fitness no more than 10 % under its peak. */
export const RACE_TSB = [10, 25] as const;
export const RACE_MAX_DROP_PCT = 10;
export const BAND = 0.15;
/** Longest projection; a race further out has none (the plan says too little that far ahead). */
export const MAX_DAYS = 365;

export type RaceVerdict = "on_target" | "too_tired" | "too_fresh" | "fitness_drop";

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

function multiplier(cycle: ProjectionCycle, date: string): number {
  const week = Math.max(1, Math.floor(daysBetween(cycle.startDate, date) / 7) + 1);
  return periodizedLoad(Math.min(week, cycle.durationWeeks), cycle.durationWeeks, cycle.goal, deloadCadenceForLevel(cycle.athleteLevel)).multiplier;
}

function run(ctl0: number, atl0: number, loads: number[]) {
  const ctl: number[] = [];
  const atl: number[] = [];
  const tsb: number[] = [];
  let c = ctl0;
  let a = atl0;
  for (const load of loads) {
    tsb.push(c - a);
    c += (load - c) / CTL_DAYS;
    a += (load - a) / ATL_DAYS;
    ctl.push(c);
    atl.push(a);
  }
  return { ctl, atl, tsb };
}

export function projectPmc(input: {
  today: string;
  raceDay: string;
  /** Fitness and fatigue at the end of today. */
  ctl: number;
  atl: number;
  /** Total daily load of the last 7 days, today included. */
  last7: number[];
  cycle: ProjectionCycle;
  /** Highest fitness so far (history), to judge the drop. */
  peakCtl: number;
}): Projection | null {
  const days = daysBetween(input.today, input.raceDay);
  if (days < 1 || days > MAX_DAYS || !input.last7.length) return null;
  const base = input.last7.reduce((s, v) => s + v, 0) / input.last7.length;
  const now = multiplier(input.cycle, input.today);
  const dates = Array.from({ length: days }, (_, i) => addDays(input.today, i + 1));
  const loads = dates.map((d) => (base * multiplier(input.cycle, d)) / now);
  const mid = run(input.ctl, input.atl, loads);
  const low = run(input.ctl, input.atl, loads.map((l) => l * (1 - BAND)));
  const high = run(input.ctl, input.atl, loads.map((l) => l * (1 + BAND)));

  const last = dates.length - 1;
  const raceTsb = mid.tsb[last];
  const raceCtl = mid.ctl[last];
  const peakCtl = Math.max(input.peakCtl, input.ctl, ...mid.ctl);
  const dropPct = peakCtl > 0 ? ((peakCtl - raceCtl) / peakCtl) * 100 : 0;
  const verdict: RaceVerdict =
    raceTsb < RACE_TSB[0] ? "too_tired" : dropPct > RACE_MAX_DROP_PCT ? "fitness_drop" : raceTsb > RACE_TSB[1] ? "too_fresh" : "on_target";
  return {
    dates,
    ctl: mid.ctl,
    atl: mid.atl,
    tsb: mid.tsb,
    // Form is linear in load, so the planned line always lies between the two runs.
    tsbLow: low.tsb.map((v, i) => Math.min(v, high.tsb[i])),
    tsbHigh: low.tsb.map((v, i) => Math.max(v, high.tsb[i])),
    raceDay: dates[last],
    race: { tsb: raceTsb, ctl: raceCtl, peakCtl, dropPct, verdict },
  };
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

/** One sentence on race morning, with the change to make when off target. */
export function projectionSentence(p: Projection): string {
  const { tsb, ctl, dropPct, verdict } = p.race;
  const head = `On the current plan you reach race day at form ${signed(tsb)} and fitness ${Math.round(ctl)}`;
  if (verdict === "too_tired") return `${head}. Target is +${RACE_TSB[0]} to +${RACE_TSB[1]}: start the taper earlier or cut its load.`;
  if (verdict === "fitness_drop") return `${head}, ${Math.round(dropPct)} % under your peak. Keep it within ${RACE_MAX_DROP_PCT} %: shorten the taper.`;
  if (verdict === "too_fresh") return `${head}. Above +${RACE_TSB[1]} the taper is longer than it needs to be.`;
  return `${head}, in the target range.`;
}
