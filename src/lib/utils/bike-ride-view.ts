/**
 * What the bike exercise screen shows of a ride before it starts
 * (docs/plans/bike-ride-logger.md, section 5 "Bike exercise"): the mode it
 * opens in, the planned numbers, the power chart and one row per step. Built
 * from the same frozen plan `startRide` makes (`buildRidePlan`), so the
 * screen shows the steps the ride will run.
 *
 * Pure: the page builds it on the server and the screen only draws it.
 */

import type { RideMode } from "@/db/schema/rides";
import { powerZone } from "@/lib/utils/bike-outdoor";
import type { RidePlan, RidePlanStep } from "@/lib/utils/ride-timeline";
import { DEFAULT_IF, plannedLoad, stepIntensity } from "@/lib/utils/training-load";
import { DEFAULT_UNITS, METERS_PER_MILE, type Units } from "@/lib/utils/units";
import { mainTarget, targetLabel, type WorkoutStep } from "@/lib/utils/workout-steps";

// ── Mode ─────────────────────────────────────────────────────────────────────

/**
 * The mode a ride opens in (D6): the planned session's mode, else the last
 * ride of this program exercise, else the month (November to March indoor,
 * April to October outdoor). `month` is 1-12 in the user's time zone.
 */
export function defaultRideMode(p: { plannedMode: RideMode | null; lastMode: RideMode | null; month: number }): RideMode {
  if (p.plannedMode) return p.plannedMode;
  if (p.lastMode) return p.lastMode;
  return p.month >= 11 || p.month <= 3 ? "indoor" : "outdoor";
}

// ── Planned numbers ──────────────────────────────────────────────────────────

/** IF of a step from its power target or ramp (a ramp at its midpoint); null without one. */
function powerIntensity(s: RidePlanStep, ftp: number | null): number | null {
  const t = mainTarget(s.step);
  return t?.metric === "power" ? stepIntensity("bike", t, { ftp }) : null;
}

export type RideNumbers = {
  /** Seconds of the steps with a known time. */
  seconds: number;
  /** A step ends on the lap button or an open distance: its time is not in `seconds`. */
  open: boolean;
  load: { load: number; partial: boolean };
  /** Planned IF (planned NP over FTP); null unless every timed step has a power target. */
  intensityFactor: number | null;
  /** Planned work in kJ, rounded to 10; null without an FTP or a power target on every timed step. */
  kj: number | null;
  /** Planned minutes per power zone, index 0 is zone 1; steps with no power target are left out. */
  zoneMinutes: number[];
  /** The zone with the most minutes (the higher one on a tie); null with no power steps. */
  mainZone: number | null;
};

/** Planned time, load, IF, kJ and time in zones of a ride (4.6), from step midpoints. */
export function plannedRideNumbers(plan: RidePlan): RideNumbers {
  const ftp = plan.thresholds.ftp ?? null;
  const seconds = plan.steps.reduce((a, s) => a + (s.seconds ?? 0), 0);
  const open = plan.steps.some((s) => s.seconds === null);
  const l = plannedLoad(
    "bike",
    plan.steps.map((s) => ({ type: s.step.type, seconds: s.seconds, target: mainTarget(s.step) })),
    { ftp },
  );
  const intensityFactor = l.intensityFactor ?? null;
  const zoneSeconds = [0, 0, 0, 0, 0, 0, 0];
  let joules = 0;
  for (const s of plan.steps) {
    if (s.seconds === null) continue;
    const i = powerIntensity(s, ftp) ?? (s.step.type === "rest" ? 0 : null);
    if (i === null) continue;
    joules += ftp ? i * ftp * s.seconds : 0;
    if (s.step.type !== "rest") zoneSeconds[powerZone(i * 100) - 1] += s.seconds;
  }
  const zoneMinutes = zoneSeconds.map((z) => Math.round(z / 60));
  let mainZone: number | null = null;
  zoneSeconds.forEach((z, k) => {
    if (z > 0 && (mainZone === null || z >= zoneSeconds[mainZone - 1])) mainZone = k + 1;
  });
  return {
    seconds,
    open,
    load: { load: l.load, partial: l.partial },
    intensityFactor,
    kj: ftp && intensityFactor !== null ? Math.round(joules / 1000 / 10) * 10 : null,
    zoneMinutes,
    mainZone,
  };
}

// ── Power chart ──────────────────────────────────────────────────────────────

/** Plot from left to right; the gutter right of it holds the zone names. */
export const CHART = { width: 260, height: 118, left: 24, right: 246, top: 0, base: 100 } as const;

export type ChartBar = {
  key: string;
  x: number;
  w: number;
  /** "range": body to the low end and a cap to the high end; "under": body at the midpoint and a dashed cap; "ramp": a slope; "none": no power target. */
  kind: "range" | "under" | "ramp" | "none";
  /** Top of the body (range, under, none) or the ramp's start and end. */
  y: number;
  y2: number;
  /** Top of the cap (range) or the dashed line (under). */
  capY: number | null;
  zone: number;
  label: string | null;
};

export type RideChart = {
  bars: ChartBar[];
  bands: { zone: number; y: number; h: number }[];
  ftpY: number;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
};

const ZONE_FROM = [0, 55, 75, 90, 105];

/** % FTP bounds of a step's power target: a range, a zone, or a ramp's from and to. */
function stepPct(step: WorkoutStep, ftp: number | null): { low: number | null; high: number | null; ramp: boolean } | null {
  if (step.ramp && !step.target) {
    const pct = (v: number) => (step.ramp!.anchor === "ftp" ? v : ftp ? (v / ftp) * 100 : null);
    const from = pct(step.ramp.from);
    const to = pct(step.ramp.to);
    return from === null || to === null ? null : { low: from, high: to, ramp: true };
  }
  const t = step.target;
  if (t?.metric !== "power") return null;
  if (t.zone !== undefined) return { low: t.zone > 1 ? ZONE_FROM[t.zone - 1] : null, high: t.zone < 5 ? ZONE_FROM[t.zone] - 1 : 120, ramp: false };
  if (t.low === undefined || t.high === undefined) return null;
  if (t.anchor === "ftp") return { low: t.low, high: t.high, ramp: false };
  return ftp ? { low: (t.low / ftp) * 100, high: (t.high / ftp) * 100, ramp: false } : null;
}

/** The planned power profile: zone bands, the FTP line and one bar per step, laid out in CHART's units. */
export function rideChart(plan: RidePlan): RideChart {
  const ftp = plan.thresholds.ftp ?? null;
  const widths = plan.steps.map((s) => s.seconds ?? s.estSeconds);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const pcts = plan.steps.map((s) => stepPct(s.step, ftp));
  const top = Math.max(0, ...pcts.map((p) => Math.max(p?.low ?? 0, p?.high ?? 0)));
  const maxPct = Math.max(130, top + 15);
  const span = CHART.right - CHART.left;
  const y = (pct: number) => +(CHART.base - (pct / maxPct) * (CHART.base - CHART.top)).toFixed(1);
  const value = (pct: number) => (ftp ? `${Math.round((pct * ftp) / 100)}` : `${Math.round(pct)}%`);

  const bars: ChartBar[] = [];
  let at = 0;
  plan.steps.forEach((s, k) => {
    const x = +(CHART.left + (at / total) * span + 0.8).toFixed(1);
    const w = +Math.max(1, (widths[k] / total) * span - 1.6).toFixed(1);
    at += widths[k];
    const p = pcts[k];
    const mid = (powerIntensity(s, ftp) ?? DEFAULT_IF[s.step.type]) * 100;
    const zone = powerZone(mid);
    const room = w >= 14;
    if (!p) {
      bars.push({ key: s.key, x, w, kind: "none", y: y(mid), y2: y(mid), capY: null, zone, label: null });
    } else if (p.ramp) {
      bars.push({ key: s.key, x, w, kind: "ramp", y: y(p.low!), y2: y(p.high!), capY: null, zone, label: room ? `${value(p.low!)} to ${value(p.high!)}` : null });
    } else if (p.low === null) {
      bars.push({ key: s.key, x, w, kind: "under", y: y(mid), y2: y(mid), capY: y(p.high!), zone, label: room ? `<${value(p.high!)}` : null });
    } else {
      bars.push({ key: s.key, x, w, kind: "range", y: y(p.low), y2: y(p.low), capY: y(p.high!), zone, label: room ? (ftp ? `${value(p.low)}-${value(p.high!)}` : `${Math.round(p.low)}-${value(p.high!)}`) : null });
    }
  });

  const bands = ZONE_FROM.slice(0, 4).map((from, k) => {
    const to = Math.min(ZONE_FROM[k + 1], maxPct);
    return { zone: k + 1, y: y(to), h: +(y(from) - y(to)).toFixed(1) };
  });

  // Watt ticks every 50 W (100 W above an FTP of 300) under the FTP line; % ticks without an FTP.
  const yTicks: RideChart["yTicks"] = [];
  if (ftp) {
    const stepW = ftp > 300 ? 100 : 50;
    for (let wt = stepW; wt < ftp * 0.9; wt += stepW) yTicks.push({ y: y((wt / ftp) * 100), label: `${wt}` });
  } else {
    yTicks.push({ y: y(50), label: "50%" });
  }

  const minutes = total / 60;
  const every = minutes <= 90 ? 15 : minutes <= 180 ? 30 : 60;
  const xTicks: RideChart["xTicks"] = [];
  for (let m = 0; m <= minutes - every / 2; m += every) xTicks.push({ x: +(CHART.left + ((m * 60) / total) * span).toFixed(1), label: `${m}` });
  xTicks.push({ x: CHART.right, label: `${Math.round(minutes)} min` });

  return { bars, bands, ftpY: y(100), yTicks, xTicks };
}

// ── Step rows ────────────────────────────────────────────────────────────────

const STEP_WORD: Record<WorkoutStep["type"], string> = { warmup: "Warm-up", work: "Work", recovery: "Easy", cooldown: "Cool-down", rest: "Rest" };

export type BikeStepRow = {
  key: string;
  n: number;
  /** "Work · 1 of 2", "Easy". */
  title: string;
  /** "Z2-3 · 85-95 rpm"; outdoors "Z2-3 · 135-145 W with a power meter". */
  detail: string | null;
  note: string | null;
  /** The main target: "135-145 W" indoors, "HR 139-152" outdoors. */
  target: string | null;
  /** "15 min", "5 km", "to lap". */
  time: string;
  /** A recovery, rest or free step, shown quieter. */
  easy: boolean;
};

/** "Z3", "Z2-3", "Ramp", "Free spin": the zone of a step's power target. */
function zoneChip(step: WorkoutStep, ftp: number | null): string | null {
  if (step.free) return "Free spin";
  if (step.ramp && !step.target) return "Ramp";
  if (step.target?.metric === "power" && step.target.zone !== undefined) return `Z${step.target.zone}`;
  const p = stepPct(step, ftp);
  if (!p) return null;
  const lo = powerZone(p.low ?? 0);
  const hi = Math.max(lo, powerZone(p.high!));
  return lo === hi ? `Z${lo}` : `Z${lo}-${hi}`;
}

/** Watts of a step: "99 to 135 W", "135-145 W", "under 97 W"; null without watts. */
export function wattsText(s: Pick<RidePlanStep, "power" | "step">): string | null {
  const p = s.power;
  if (!p) return null;
  if (s.step.ramp && !s.step.target) return `${p.from} to ${p.to} W`;
  if (p.from === null && p.to !== null) return `under ${p.to} W`;
  if (p.to === null && p.from !== null) return `${p.from} W or more`;
  return p.from === p.to ? `${p.from} W` : `${p.from}-${p.to} W`;
}

/** Effort 2 outdoors, the "easy spin" of 4.2. */
export const isEasySpin = (t: { unit: string; low: number | null; high: number | null }) => t.unit === "RPE" && t.low === 2 && t.high === 2;

/** The indoor target: watts, else the target as written ("75-80% FTP" with no FTP). */
function indoorText(s: RidePlanStep): string | null {
  const w = wattsText(s);
  if (w) return w;
  const t = mainTarget(s.step);
  if (!t) return null;
  if (s.step.ramp && !s.step.target) return `${s.step.ramp.from} to ${s.step.ramp.to}${s.step.ramp.anchor === "ftp" ? "% FTP" : " W"}`;
  if (t.metric === "power" && t.zone !== undefined) {
    const p = stepPct(s.step, null)!;
    return p.low === null ? `under ${p.high! + 1}% FTP` : `${p.low}-${p.high}% FTP`;
  }
  // An effort reads as on every bike screen ("Effort 9-10"), not "RPE".
  if (t.metric === "rpe" && t.low !== undefined && t.high !== undefined) return t.low === t.high ? `Effort ${t.low}` : `Effort ${t.low}-${t.high}`;
  return s.target?.missing ? targetLabel(t, "bike") : (s.target?.text ?? null);
}

function timeText(s: RidePlanStep, units: Units): string {
  if (s.seconds !== null) {
    if (s.seconds < 60) return `${s.seconds} s`;
    if (s.seconds % 60 === 0) return `${s.seconds / 60} min`;
    return `${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, "0")}`;
  }
  if (s.step.end.type === "distance") {
    const m = s.step.end.meters;
    return units.distance === "mi" ? `${+(m / METERS_PER_MILE).toFixed(2)} mi` : m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(2)} km`;
  }
  return "to lap";
}

/** One row per step the ride runs, with the targets of the plan's mode. */
export function bikeStepRows(plan: RidePlan, units: Units = DEFAULT_UNITS): BikeStepRow[] {
  const ftp = plan.thresholds.ftp ?? null;
  const outdoor = plan.mode === "outdoor";
  return plan.steps.map((s, i) => {
    const step = s.step;
    const chip = zoneChip(step, ftp);
    const cadence = step.cadence ? `${step.cadence.low}-${step.cadence.high} rpm` : null;
    const watts = wattsText(s);
    const detail = outdoor
      ? [chip, watts && s.outdoor ? `${watts} with a power meter` : null, s.outdoor2?.text ?? null]
      : [chip, cadence];
    return {
      key: s.key,
      n: i + 1,
      // The round on the work of a repeat; its recovery reads as the easy part in between.
      title: `${STEP_WORD[step.type]}${s.round && step.type !== "recovery" && step.type !== "rest" ? ` · ${s.round.index} of ${s.round.of}` : ""}`,
      detail: detail.filter(Boolean).join(" · ") || null,
      note: step.note ?? null,
      target: outdoor ? (s.outdoor ? (isEasySpin(s.outdoor) ? `${s.outdoor.text} · easy spin` : s.outdoor.text) : indoorText(s)) : indoorText(s),
      time: timeText(s, units),
      easy: step.type === "recovery" || step.type === "rest" || !!step.free,
    };
  });
}

/** "65 min", "1 h 5 min", with "+ open" when a step has no time. */
export function rideLengthText(n: Pick<RideNumbers, "seconds" | "open">): string {
  const m = Math.round(n.seconds / 60);
  const text = m >= 90 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
  return n.seconds > 0 ? `${text}${n.open ? " + open" : ""}` : "time open";
}
