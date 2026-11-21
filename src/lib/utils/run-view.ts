/**
 * What the run exercise screen shows of a run before it starts
 * (docs/plans/run-logger.md, section 5 "Run exercise, ready"): the mode it
 * opens in (R4), the planned numbers, the zone chart and one row per step,
 * with the belt on a treadmill and the outdoor target outdoors (4.2). Built
 * from the same frozen plan `startRide` makes (`buildRunPlan`), so the
 * screen shows the steps the run will run.
 *
 * Pure: the page builds it on the server and the screen only draws it.
 */

import type { RideMode, RunSurface } from "@/db/schema/rides";
import { CHART, timeTicks, type ChartBar, type RideChart } from "@/lib/utils/bike-ride-view";
import type { RidePlan, RidePlanStep } from "@/lib/utils/ride-timeline";
import { zoneWholeMinutes } from "@/lib/utils/run-numbers";
import { hrTargetZone, WALK_BELT_KMH } from "@/lib/utils/run-plan";
import { minSec } from "@/lib/utils/thresholds";
import { plannedLoad } from "@/lib/utils/training-load";
import { mainTarget, resolveTarget, runHrZoneBpm, RUN_PACE_ZONES, targetLabel, type ThresholdValues, type Workout, type WorkoutStep } from "@/lib/utils/workout-steps";

// ── Mode ─────────────────────────────────────────────────────────────────────

/** A run shows `indoor` as Treadmill (R3). */
export const RUN_MODE_NAME: Record<RideMode, string> = { indoor: "Treadmill", outdoor: "Outdoor" };

/**
 * The mode a run opens in (R4): the mode of the last run of this program
 * exercise, else the mode of most of the user's runs in the last 4 weeks,
 * else the month (November to March treadmill, April to October outdoor).
 * A tie in the 4 weeks falls to the month. `month` is 1-12 in the user's time zone.
 */
export function defaultRunMode(p: { lastMode: RideMode | null; recent: { indoor: number; outdoor: number }; month: number }): RideMode {
  if (p.lastMode) return p.lastMode;
  if (p.recent.indoor > p.recent.outdoor) return "indoor";
  if (p.recent.outdoor > p.recent.indoor) return "outdoor";
  return p.month >= 11 || p.month <= 3 ? "indoor" : "outdoor";
}

// ── Zones and target words ───────────────────────────────────────────────────

/** Effort for a heart rate zone when no run LTHR is set (4.2). */
const EFFORT_OF_ZONE = [2, 3, 5, 7, 9];

/** The pace zone (1 to 5) of a pace in % of threshold pace time (Friel, 4.2); Z5 takes its three parts. */
function paceZoneOf(pctTime: number): number {
  if (pctTime > RUN_PACE_ZONES["2"][1]) return 1;
  if (pctTime >= RUN_PACE_ZONES["2"][0]) return 2;
  if (pctTime >= RUN_PACE_ZONES["3"][0]) return 3;
  if (pctTime >= RUN_PACE_ZONES["4"][0]) return 4;
  return 5;
}

/**
 * The zone (1 to 5) a run step's main target stands for: its heart rate zone,
 * the pace zone of its pace, or the zone of its effort (effort 1 to 4 is Z1,
 * 5 to 6 Z2, 7 Z3, 8 Z4, 9 to 10 Z5, as the belt of 4.2 reads it). Null with
 * no target, or without the numbers to tell.
 */
export function runStepZone(step: Pick<WorkoutStep, "target" | "ramp">, thresholds: ThresholdValues): number | null {
  const t = mainTarget(step);
  if (!t) return null;
  const mid = t.low !== undefined && t.high !== undefined ? (t.low + t.high) / 2 : null;
  if (t.metric === "hr") return hrTargetZone(t, thresholds);
  if (t.metric === "pace" && mid) {
    if (t.anchor === "threshold_pace") return paceZoneOf(10000 / mid);
    const speed = thresholds.run_threshold_pace;
    return t.anchor === "absolute" && speed ? paceZoneOf((speed / mid) * 100) : null;
  }
  if (t.metric === "rpe" && mid) {
    const e = Math.round(mid);
    return e <= 4 ? 1 : e <= 6 ? 2 : e === 7 ? 3 : e === 8 ? 4 : 5;
  }
  return null;
}

/** A cap, not a range (R13): warm-up, cool-down, zone 1 or 2, and a step of 20 min or more at zone 3 or less. */
function isCap(step: WorkoutStep, zone: number | null, seconds: number): boolean {
  if (step.type === "warmup" || step.type === "cooldown") return true;
  if (zone === null) return false;
  return zone <= 2 || (seconds >= 1200 && zone <= 3);
}

const hrText = (low: number | null, high: number | null, cap: boolean) => {
  const r = (n: number) => Math.round(n);
  if (high === null) return low === null ? null : `HR ${r(low)} or more`;
  if (cap || low === null) return `HR under ${r(high)}`;
  return r(low) === r(high) ? `HR ${r(low)}` : `HR ${r(low)}-${r(high)}`;
};

/**
 * A heart rate zone as words: "HR under 162" for a cap, "HR 153-161" for a
 * range, an effort with no run LTHR (4.2). The numbers are the zone's edges as
 * `runHrZoneOf` counts them, so a cap's number is the first bpm of the next zone.
 */
function zoneHrText(zone: number, cap: boolean, thresholds: ThresholdValues): string {
  if (!thresholds.lthr_run) return `Effort ${EFFORT_OF_ZONE[zone - 1]}`;
  const r = runHrZoneBpm(zone, thresholds.lthr_run);
  if (r.high === null) return `HR ${r.low} or more`;
  if (cap || r.low === null) return `HR under ${r.high + 1}`;
  return `HR ${r.low}-${r.high}`;
}

/** The text of a heart rate target: by its zone when it has one, else its own bpm. */
function hrTargetText(s: RidePlanStep, zone: number | null, cap: boolean, thresholds: ThresholdValues): string {
  const t = mainTarget(s.step)!;
  if (t.anchor === "lthr" && t.zone !== undefined) return zoneHrText(t.zone, cap, thresholds);
  const r = resolveTarget(t, "run", thresholds);
  if (r.missing) return zone !== null ? `Effort ${EFFORT_OF_ZONE[zone - 1]}` : targetLabel(t, "run");
  return hrText(r.low, r.high, cap) ?? r.text;
}

/** "5:59-6:26 /km": a speed range (m/s), fast end first. */
function paceRangeText(slow: number, fast: number): string {
  const a = minSec(1000 / fast);
  const b = minSec(1000 / slow);
  return a === b ? `${a} /km` : `${a}-${b} /km`;
}

/** The Friel pace range of a zone (Z5 is 5a and 5b) at this threshold speed. */
function zonePaceText(zone: number, speed: number): string {
  const [fast, slow] = zone === 5 ? [90, 100] : RUN_PACE_ZONES[String(zone) as "1" | "2" | "3" | "4"];
  if (slow === null) return `slower than ${minSec(1000 / ((speed * 100) / fast!))} /km`;
  return paceRangeText((speed * 100) / slow, (speed * 100) / fast!);
}

const effortText = (t: { low?: number; high?: number }) => (t.low === t.high ? `Effort ${t.low}` : `Effort ${t.low}-${t.high}`);

/** A step's main target as words, in either mode: heart rate (a cap or a range), pace, or effort. */
function targetText(s: RidePlanStep, zone: number | null, thresholds: ThresholdValues): string | null {
  const t = mainTarget(s.step);
  if (!t) return null;
  const cap = isCap(s.step, zone, s.seconds ?? s.estSeconds);
  if (t.metric === "hr") return hrTargetText(s, zone, cap, thresholds);
  if (t.metric === "rpe" && t.low !== undefined) return effortText(t);
  if (t.metric === "pace") {
    const r = resolveTarget(t, "run", thresholds);
    if (r.missing) return targetLabel(t, "run");
    return r.low !== null && r.high !== null ? paceRangeText(r.low, r.high) : r.text;
  }
  return s.target?.text ?? null;
}

/**
 * The target of an outdoor step when the plan wrote none (4.2): a heart rate
 * cap for easy and long steps, a pace range with heart rate as the second
 * line for work of 3 min or more, effort for strides and short work, and
 * "Easy jog or walk" for a recovery. On Trail or snow (R14) a pace becomes
 * the heart rate of its zone, else effort.
 */
export function runOutdoorText(s: RidePlanStep, thresholds: ThresholdValues, surface: RunSurface): { main: string | null; second: string | null } {
  if (s.outdoor) return { main: s.outdoor.text, second: null };
  const step = s.step;
  if (step.type === "recovery" || step.type === "rest") return { main: "Easy jog or walk", second: null };
  const seconds = s.seconds ?? s.estSeconds;
  if (step.type === "work" && s.run?.block) return { main: "Fast and relaxed", second: null };
  if (step.type === "work" && seconds < 180) return { main: "Hard", second: null };
  const zone = runStepZone(step, thresholds);
  const t = mainTarget(step);
  // An effort is kept as written; a step with no zone has nothing to turn into.
  if (!t || zone === null || t.metric === "rpe") return { main: targetText(s, zone, thresholds), second: null };
  const lthr = !!thresholds.lthr_run;
  if (isCap(step, zone, seconds)) {
    // Easy and long steps: a heart rate cap at the top of the zone (R13), also when a pace is written.
    if (lthr || t.metric === "hr") return { main: t.metric === "hr" ? targetText(s, zone, thresholds) : zoneHrText(zone, true, thresholds), second: null };
    // No LTHR: Road keeps the pace; Trail or snow never shows one (R14).
    return { main: surface === "trail" ? `Effort ${EFFORT_OF_ZONE[zone - 1]}` : targetText(s, zone, thresholds), second: null };
  }
  // Pace, or heart rate zone 3 to 5: a pace range, heart rate as the second line.
  if (surface === "trail") return { main: lthr || t.metric === "hr" ? zoneHrText(zone, false, thresholds) : `Effort ${EFFORT_OF_ZONE[zone - 1]}`, second: null };
  const speed = thresholds.run_threshold_pace;
  const hr = lthr ? zoneHrText(zone, false, thresholds) : null;
  if (t.metric === "pace") return { main: targetText(s, zone, thresholds), second: hr };
  return speed ? { main: zonePaceText(zone, speed), second: hr } : { main: targetText(s, zone, thresholds), second: null };
}

/** A step's pace is a share of the threshold pace, so the screen needs one; a pace in m/s needs none. */
export function needsThresholdPace(w: Workout): boolean {
  const steps = w.steps.flatMap((n) => (n.type === "repeat" ? n.steps : [n]));
  return steps.some((s) => [mainTarget(s), s.target2, s.outdoor].some((t) => t?.metric === "pace" && t.anchor === "threshold_pace"));
}

// ── Planned numbers ──────────────────────────────────────────────────────────

/** Seconds a step runs, when known: its time, or a belt distance at its frozen belt. */
function knownSeconds(s: RidePlanStep): number | null {
  if (s.run?.rule === "belt_distance") return s.run.belt ? s.estSeconds : null;
  if (s.run?.rule === "lap") return null;
  return s.seconds;
}

export type RunNumbers = {
  /** Seconds of the steps with a known time. */
  seconds: number;
  /** A step ends on Lap, or on a distance with no belt: its time is not in `seconds`. */
  open: boolean;
  /** `partial`: a step's time is not known, so the load is at least this ("load at least 70"). */
  load: { load: number; partial: boolean };
  /** Planned km: from the belts on a treadmill, from distances and pace targets outdoors. Null when a step's distance is not known. */
  km: number | null;
  /** Planned minutes per zone (runStepZone), index 0 is zone 1. */
  zoneMinutes: number[];
  /** The zone with the most minutes (the higher one on a tie); null with no zone. */
  mainZone: number | null;
};

/** Planned time, load, distance and time in zones of a run, from step midpoints. */
export function plannedRunNumbers(plan: RidePlan): RunNumbers {
  const th = plan.thresholds;
  const timed = plan.steps.map((s) => ({ s, sec: knownSeconds(s) }));
  const l = plannedLoad(
    "run",
    timed.map(({ s, sec }) => ({ type: s.step.type, seconds: sec, target: mainTarget(s.step) })),
    { runThresholdSpeed: th.run_threshold_pace ?? null },
  );
  let meters: number | null = 0;
  const zoneSeconds = [0, 0, 0, 0, 0];
  // The belt of the step before, for a step that keeps it (the 20 min of a treadmill run test): the estimate counts it at that belt.
  let lastBelt: number | null = null;
  for (const { s, sec } of timed) {
    const belt = s.run?.belt ?? (s.run?.carry ? lastBelt : null);
    if (s.run?.belt != null) lastBelt = s.run.belt;
    if (s.run?.meters != null) meters = meters === null ? null : meters + s.run.meters;
    else if (sec === null) meters = null;
    else {
      const speed = plan.mode === "indoor" ? (belt ? belt / 36 : null) : speedOf(s, th);
      meters = meters === null || speed === null ? null : meters + speed * sec;
    }
    const zone = runStepZone(s.step, th);
    if (sec !== null && zone !== null && s.step.type !== "rest") zoneSeconds[zone - 1] += sec;
  }
  let mainZone: number | null = null;
  zoneSeconds.forEach((z, k) => {
    if (z > 0 && (mainZone === null || z >= zoneSeconds[mainZone - 1])) mainZone = k + 1;
  });
  return {
    seconds: timed.reduce((a, t) => a + (t.sec ?? 0), 0),
    open: timed.some((t) => t.sec === null),
    // A heart rate or effort step takes its type's IF; that is an estimate, not a gap, so the screen says "about".
    load: { load: l.load, partial: timed.some((t) => t.sec === null) },
    km: meters === null ? null : Math.round(meters / 100) / 10,
    zoneMinutes: zoneWholeMinutes(zoneSeconds),
    mainZone,
  };
}

/** The speed (m/s) of an outdoor step's pace target, at its midpoint; null for any other target. */
function speedOf(s: RidePlanStep, th: ThresholdValues): number | null {
  const t = mainTarget(s.step);
  if (t?.metric !== "pace") return null;
  const r = resolveTarget(t, "run", th);
  return r.low !== null && r.high !== null ? (r.low + r.high) / 2 : null;
}

// ── Zone chart ───────────────────────────────────────────────────────────────

/** The plot's top stands for this zone level, so a zone 5 bar has room above the Z4 band. */
const TOP_LEVEL = 5.6;

/**
 * The planned profile of a run (section 5): heart rate or pace zones as
 * bands Z1 to Z4 and one bar per step to the top of its zone. A cap (R13)
 * shows as a dashed line at the top of its zone, over a body to its middle.
 * Laid out in CHART's units, so `RideProfileChart` draws it.
 */
export function runChart(plan: RidePlan): RideChart {
  const th = plan.thresholds;
  const widths = plan.steps.map((s) => knownSeconds(s) ?? s.estSeconds);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const span = CHART.right - CHART.left;
  const y = (level: number) => +(CHART.base - (level / TOP_LEVEL) * (CHART.base - CHART.top)).toFixed(1);
  const bars: ChartBar[] = [];
  let at = 0;
  plan.steps.forEach((s, k) => {
    const x = +(CHART.left + (at / total) * span + 0.8).toFixed(1);
    const w = +Math.max(1, (widths[k] / total) * span - 1.6).toFixed(1);
    at += widths[k];
    const zone = runStepZone(s.step, th);
    if (zone === null) {
      bars.push({ key: s.key, x, w, kind: "none", y: y(1), y2: y(1), capY: null, zone: 1, label: null });
      return;
    }
    // The chart says what the list says: outdoors the outdoor target of its surface.
    const text = plan.mode === "outdoor" ? runOutdoorText(s, th, plan.surface ?? "road").main : targetText(s, zone, th);
    const label = w >= 80 ? `Z${zone}${text ? ` · ${text}` : ""}` : null;
    if (isCap(s.step, zone, s.seconds ?? s.estSeconds)) bars.push({ key: s.key, x, w, kind: "under", y: y(zone - 0.5), y2: y(zone - 0.5), capY: y(zone), zone, label });
    else bars.push({ key: s.key, x, w, kind: "range", y: y(zone - 1), y2: y(zone - 1), capY: y(zone), zone, label });
  });
  const bands = [1, 2, 3, 4].map((zone) => ({ zone, y: y(zone), h: +(y(zone - 1) - y(zone)).toFixed(1) }));
  return { bars, bands, ftpY: null, yTicks: [], xTicks: timeTicks(total) };
}

// ── Step rows ────────────────────────────────────────────────────────────────

export type RunStepRow = {
  key: string;
  n: number;
  /** "Warm-up", "Steady", "Work · 2 of 4", "Strides 6 ×". */
  title: string;
  /** "Belt 7.5 km/h · incline 1%", "HR under 162 · start 8.2 km/h"; outdoors the target. */
  detail: string | null;
  note: string | null;
  /** "10:00", "1 km", "to lap". */
  time: string;
  /** "Z2", "Fast" for a strides block. */
  chip: string | null;
  /** A warm-up, cool-down, recovery or rest, shown quieter. */
  easy: boolean;
};

const STEP_WORD: Record<WorkoutStep["type"], string> = { warmup: "Warm-up", work: "Work", recovery: "Easy", cooldown: "Cool-down", rest: "Rest" };

const kmh = (tenths: number) => (tenths / 10).toFixed(1);

/** The belt words of a step that keeps the belt the step before ended on (the 20 min of a run test, 4.10). */
export const KEEP_BELT = "Keep the belt";

/** "10:00", "1:15:00". */
function clockText(seconds: number): string {
  if (seconds < 3600) return minSec(seconds);
  const h = Math.floor(seconds / 3600);
  return `${h}:${minSec(seconds - h * 3600).padStart(5, "0")}`;
}

const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(2)} km`);

/** The treadmill words of a step (4.2): its belt and where it came from, and its own incline. */
function treadmillText(s: RidePlanStep, th: ThresholdValues, zone: number | null): string {
  const run = s.run!;
  const t = mainTarget(s.step);
  const hr = t?.metric === "hr" ? targetText(s, zone, th) : null;
  let text: string;
  if (run.carry) text = KEEP_BELT;
  else if (run.belt === null) text = hr ? `${hr} · set the belt by feel` : "Set the belt by feel";
  else if (run.beltFrom === "zone" || run.beltFrom === "history") text = `${hr} · start ${kmh(run.belt)} km/h`;
  else if (run.beltFrom === "effort" && run.belt === WALK_BELT_KMH * 10) text = `Walk ${kmh(run.belt)} km/h`;
  else text = `Belt ${kmh(run.belt)} km/h`;
  return s.step.incline !== undefined ? `${text} · incline ${s.step.incline}%` : text;
}

/** "Warm-up", "Steady" (a work step in zone 1 or 2), "Work · 2 of 4", "Easy". */
export function runStepTitle(s: RidePlanStep, th: ThresholdValues): string {
  const zone = runStepZone(s.step, th);
  const word = s.step.type === "work" && zone !== null && zone <= 2 ? "Steady" : STEP_WORD[s.step.type];
  return `${word}${s.round && s.step.type !== "recovery" && s.step.type !== "rest" ? ` · ${s.round.index} of ${s.round.of}` : ""}`;
}

/** A step's main target as words ("HR under 162", "5:35-5:59 /km", "Effort 9"), as the step list says it on a treadmill. */
export function runTargetText(s: RidePlanStep, th: ThresholdValues): string | null {
  return targetText(s, runStepZone(s.step, th), th);
}

/** The cap at the top of a heart rate zone ("HR under 162"), or its effort with no run LTHR (4.2). */
export function runZoneCapText(zone: number, th: ThresholdValues): string {
  return zoneHrText(zone, true, th);
}

/** The row (0-based) each plan step shows in: a strides block is one row (4.5). */
export function runRowOfStep(plan: Pick<RidePlan, "steps">): number[] {
  const out: number[] = [];
  let row = -1;
  plan.steps.forEach((s, i) => {
    const block = s.run?.block ?? null;
    if (!block || plan.steps[i - 1]?.run?.block !== block) row++;
    out.push(row);
  });
  return out;
}

/** One row per step the run runs; a strides block (4.5) is one row. */
export function runStepRows(plan: RidePlan, surface: RunSurface = "road"): RunStepRow[] {
  const th = plan.thresholds;
  const treadmill = plan.mode === "indoor";
  const rows: RunStepRow[] = [];
  for (let i = 0; i < plan.steps.length; ) {
    const s = plan.steps[i];
    const block = s.run?.block ?? null;
    if (block) {
      let j = i;
      while (j < plan.steps.length && plan.steps[j].run?.block === block) j++;
      const part = plan.steps.slice(i, j);
      const work = part.find((p) => p.step.type === "work") ?? s;
      const easy = part.find((p) => p.step.type !== "work");
      const workSec = work.seconds ?? work.estSeconds;
      const what = treadmill && work.run?.belt ? `${kmh(work.run.belt)} km/h` : "Fast and relaxed";
      rows.push({
        key: block,
        n: rows.length + 1,
        title: `Strides ${work.round?.of ?? part.length} ×`,
        detail: [`${workSec} s`, what, easy ? `${minSec(easy.seconds ?? easy.estSeconds)} easy between` : null].filter(Boolean).join(" · "),
        note: work.step.note ?? null,
        time: clockText(part.reduce((a, p) => a + (p.seconds ?? p.estSeconds), 0)),
        chip: "Fast",
        easy: false,
      });
      i = j;
      continue;
    }
    const zone = runStepZone(s.step, th);
    const rule = s.run?.rule ?? "time";
    let detail: string | null;
    if (treadmill) detail = treadmillText(s, th, zone);
    else {
      const o = runOutdoorText(s, th, surface);
      detail = [o.main, o.second].filter(Boolean).join(" · ") || null;
    }
    if (rule === "estimate" && s.seconds !== null) detail = [detail, `about ${minSec(s.seconds)}`].filter(Boolean).join(" · ");
    const meters = s.run?.meters ?? null;
    rows.push({
      key: s.key,
      n: rows.length + 1,
      title: runStepTitle(s, th),
      detail,
      note: s.step.note ?? null,
      time: rule === "time" && s.seconds !== null ? clockText(s.seconds) : meters !== null ? distanceText(meters) : "to lap",
      chip: zone !== null ? `Z${zone}` : null,
      easy: s.step.type !== "work",
    });
    i++;
  }
  return rows;
}

/** The number the mode's targets read first: on a treadmill "threshold 5:39 /km", else "LTHR 180"; outdoors the other way round. */
export function runAnchorText(th: ThresholdValues, mode: RideMode): string | null {
  const pace = th.run_threshold_pace ? `threshold ${minSec(1000 / th.run_threshold_pace)} /km` : null;
  const lthr = th.lthr_run ? `LTHR ${Math.round(th.lthr_run)}` : null;
  return mode === "indoor" ? (pace ?? lthr) : (lthr ?? pace);
}
