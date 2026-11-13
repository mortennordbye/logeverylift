/**
 * Race-day plan rules (docs/plans/nutrition-and-race-day.md, 2.5 and 2.6;
 * research: docs/research/endurance-training-reference.md, the bike race
 * target table and the half-distance appendix). Pure. Guides, never a finish
 * prediction. Every leg keeps its evidence label.
 *
 * The bike and run bands are the one rule for both the race plan and the
 * Garmin race page (pacingGuide in src/lib/garmin/analytics/race.ts).
 * Clock times are plain "HH:MM" strings: no Intl, no toLocale*.
 */

import { CARB_CEILING_G_H, type Evidence } from "./fueling";

export type PlanDistance = "full" | "half";
export const PLAN_DISTANCES: readonly PlanDistance[] = ["full", "half"];

/** Leg lengths in metres (src/db/schema/seasons.ts, TRI_DISTANCES). */
export const LEG_METERS: Record<PlanDistance, { swim: number; bike: number; run: number }> = {
  full: { swim: 3800, bike: 180000, run: 42200 },
  half: { swim: 1900, bike: 90000, run: 21100 },
};

/**
 * Bike IF bands. Half: 0.75-0.85, first-timer 0.70-0.75 (appendix, coach
 * convention). Full: first-timer 0.65-0.70 (coach convention); the general
 * top 0.75 is the TSS-cap formula at about 5.3 h (inference).
 */
export const BIKE_IF: Record<PlanDistance, { general: [number, number]; firstTimer: [number, number] }> = {
  full: { general: [0.65, 0.75], firstTimer: [0.65, 0.7] },
  half: { general: [0.75, 0.85], firstTimer: [0.7, 0.75] },
};
/** The bike TSS a race should stay inside (full 250-300, half about 170, 180 max). */
export const BIKE_TSS_CAP: Record<PlanDistance, [number, number]> = { full: [250, 300], half: [170, 180] };
/** Run guide as a share of threshold (or critical) speed. Not in the research: inference. */
export const RUN_SPEED_SHARE: Record<PlanDistance, [number, number]> = { full: [0.8, 0.85], half: [0.85, 0.9] };
/** Heart-rate ceiling as a share of LTHR: the top of the app's low band, under the research's VT1 estimate of about 89 %. */
export const HR_CEILING_SHARE = 0.85;

export const DEFAULT_TRANSITIONS: Record<PlanDistance, { t1: number; t2: number }> = { full: { t1: 8, t2: 5 }, half: { t1: 5, t2: 3 } };
/** Assumed speeds when there is neither an override nor a threshold (inference). m/s. */
export const ASSUMED_SPEED = { swim: 100 / 130, bike: 28 / 3.6, run: 1000 / 390 };
export const DEFAULT_SWIM_OFFSET_S = 5;

export type RacePlanInputs = {
  startTime?: string | null;
  swimMinutes?: number | null;
  bikeMinutes?: number | null;
  runMinutes?: number | null;
  t1Minutes?: number | null;
  t2Minutes?: number | null;
  swimOffsetSecondsPer100m?: number | null;
  fuelIntervalMinutes?: 15 | 20 | null;
  caffeine?: boolean | null;
  raceTemperatureC?: number | null;
  notes?: string | null;
};

export type Anchors = { ftp: number | null; lthrRun: number | null; lthrBike: number | null; runSpeed: number | null; swimCss: number | null };

export type LegTime = { minutes: number; source: "yours" | "from your thresholds" | "assumed" };

/** Clock time "HH:MM" plus minutes, wrapping past midnight. */
export function addClock(start: string, minutes: number): string {
  const [h, m] = start.split(":").map(Number);
  const total = (((h * 60 + m + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "h:mm" for a duration in minutes. */
export function hoursMinutes(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export type BikeGuide = { ifRange: [number, number]; watts: [number, number] | null; hrCeiling: number | null; text: string; evidence: Evidence };

/** Bike IF from the TSS cap and the bike time, kept inside the distance's band. */
export function bikeGuide(distance: PlanDistance, bikeHours: number, ftp: number | null, lthrBike: number | null, firstTimer: boolean): BikeGuide {
  const band = firstTimer ? BIKE_IF[distance].firstTimer : BIKE_IF[distance].general;
  const [capLo, capHi] = BIKE_TSS_CAP[distance];
  const clamp = (x: number) => Math.min(band[1], Math.max(band[0], x));
  const lo = clamp(Math.sqrt(capLo / (100 * bikeHours)));
  const hi = clamp(Math.sqrt(capHi / (100 * bikeHours)));
  const ifRange: [number, number] = [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
  const watts: [number, number] | null = ftp ? [Math.round(ftp * ifRange[0]), Math.round(ftp * ifRange[1])] : null;
  return {
    ifRange,
    watts,
    hrCeiling: lthrBike ? Math.round(lthrBike * HR_CEILING_SHARE) : null,
    text: ftp
      ? `IF ${ifRange[0].toFixed(2)}-${ifRange[1].toFixed(2)}: ${watts![0]}-${watts![1]} W for about ${hoursMinutes(bikeHours * 60)} on the bike.`
      : `IF ${ifRange[0].toFixed(2)}-${ifRange[1].toFixed(2)}. Add your FTP for watts.`,
    evidence: "Coach convention; the formula rearrangement is inference",
  };
}

export type RunGuide = { speed: [number, number] | null; hrCeiling: number | null; text: string; evidence: Evidence };

export function runGuide(distance: PlanDistance, runSpeed: number | null, lthrRun: number | null): RunGuide {
  const share = RUN_SPEED_SHARE[distance];
  const hrCeiling = lthrRun ? Math.round(lthrRun * HR_CEILING_SHARE) : null;
  const speed: [number, number] | null = runSpeed ? [runSpeed * share[0], runSpeed * share[1]] : null;
  const parts = [hrCeiling ? `Keep heart rate under ${hrCeiling} bpm.` : "Add your run threshold heart rate for a ceiling."];
  if (!runSpeed) parts.push("Add your run threshold pace for a guide pace.");
  return { speed, hrCeiling, text: parts.join(" "), evidence: "Inference; not in the research reference" };
}

export type SwimGuide = { speed: number | null; text: string; evidence: Evidence };

export function swimGuide(css: number | null, offsetSecondsPer100m: number): SwimGuide {
  if (!css) return { speed: null, text: "Add your swim CSS for a guide pace.", evidence: "Inference" };
  const sec = 100 / css + offsetSecondsPer100m;
  return { speed: 100 / sec, text: `CSS pace plus ${offsetSecondsPer100m} s per 100 m.`, evidence: "Inference" };
}

export type TimelineRow = { leg: "swim" | "t1" | "bike" | "t2" | "run" | "finish"; start: string; minutes: number; source?: LegTime["source"] };

export type FuelRow = { clock: string; leg: "bike" | "run"; carbsG: number; fluidMl: number; sodiumMg: number };

export type RatePlan = { carbs: { bike: number; run: number }; fluid: [number, number]; sodium: [number, number] };

/** Bike rate from the race target (60-80 g/h untrained, up to the proved ceiling); run 10 g/h lower, at least 50. */
export function fuelRates(raceTarget: number | null, proved: number | null): { bike: number; run: number } {
  const ceiling = proved != null && proved > CARB_CEILING_G_H ? proved : CARB_CEILING_G_H;
  const bike = raceTarget == null ? 60 : Math.min(ceiling, Math.max(60, raceTarget));
  const run = Math.min(70, Math.max(50, bike - 10));
  return { bike, run };
}

/** One row per interval on the bike and the run (none in the swim), at the middle of the fluid and sodium bands. */
export function fuelSchedule(timeline: TimelineRow[], intervalMinutes: number, rates: RatePlan): FuelRow[] {
  const rows: FuelRow[] = [];
  const fluidMid = (rates.fluid[0] + rates.fluid[1]) / 2;
  const sodiumMid = (rates.sodium[0] + rates.sodium[1]) / 2;
  for (const leg of timeline) {
    if (leg.leg !== "bike" && leg.leg !== "run") continue;
    const perHour = rates.carbs[leg.leg];
    for (let t = intervalMinutes; t <= leg.minutes; t += intervalMinutes) {
      rows.push({
        clock: addClock(leg.start, t),
        leg: leg.leg,
        carbsG: Math.round((perHour * intervalMinutes) / 60),
        fluidMl: Math.round((fluidMid * intervalMinutes) / 60 / 10) * 10,
        sodiumMg: Math.round((sodiumMid * intervalMinutes) / 60 / 10) * 10,
      });
    }
  }
  return rows;
}

export type RacePlanOut = {
  distance: PlanDistance;
  timeline: TimelineRow[];
  totalMinutes: number;
  swim: SwimGuide & { leg: LegTime };
  bike: BikeGuide & { leg: LegTime };
  run: RunGuide & { leg: LegTime };
  transitions: { t1: number; t2: number; evidence: Evidence };
};

function legTime(override: number | null | undefined, meters: number, speed: number | null, assumed: number): LegTime {
  if (override != null && override > 0) return { minutes: override, source: "yours" };
  if (speed) return { minutes: Math.round(meters / speed / 60), source: "from your thresholds" };
  return { minutes: Math.round(meters / assumed / 60), source: "assumed" };
}

/** Timeline and per-leg pacing for a half or full (2.5, 2.6). */
export function racePlan(distance: PlanDistance, inputs: RacePlanInputs, anchors: Anchors, firstTimer: boolean): RacePlanOut {
  const m = LEG_METERS[distance];
  const offset = inputs.swimOffsetSecondsPer100m ?? DEFAULT_SWIM_OFFSET_S;
  const swim = swimGuide(anchors.swimCss, offset);
  const run = runGuide(distance, anchors.runSpeed, anchors.lthrRun);
  const runMid = run.speed ? (run.speed[0] + run.speed[1]) / 2 : null;
  const swimLeg = legTime(inputs.swimMinutes, m.swim, swim.speed, ASSUMED_SPEED.swim);
  const bikeLeg = legTime(inputs.bikeMinutes, m.bike, null, ASSUMED_SPEED.bike);
  const runLeg = legTime(inputs.runMinutes, m.run, runMid, ASSUMED_SPEED.run);
  const bike = bikeGuide(distance, bikeLeg.minutes / 60, anchors.ftp, anchors.lthrBike, firstTimer);
  const t1 = inputs.t1Minutes ?? DEFAULT_TRANSITIONS[distance].t1;
  const t2 = inputs.t2Minutes ?? DEFAULT_TRANSITIONS[distance].t2;
  const start = inputs.startTime ?? "07:00";
  const legs: [TimelineRow["leg"], number, LegTime["source"] | undefined][] = [
    ["swim", swimLeg.minutes, swimLeg.source],
    ["t1", t1, undefined],
    ["bike", bikeLeg.minutes, bikeLeg.source],
    ["t2", t2, undefined],
    ["run", runLeg.minutes, runLeg.source],
  ];
  const timeline: TimelineRow[] = [];
  let at = 0;
  for (const [leg, minutes, source] of legs) {
    timeline.push({ leg, start: addClock(start, at), minutes, ...(source ? { source } : {}) });
    at += minutes;
  }
  timeline.push({ leg: "finish", start: addClock(start, at), minutes: 0 });
  return {
    distance,
    timeline,
    totalMinutes: at,
    swim: { ...swim, leg: swimLeg },
    bike: { ...bike, leg: bikeLeg },
    run: { ...run, leg: runLeg },
    transitions: { t1, t2, evidence: "Inference" },
  };
}
