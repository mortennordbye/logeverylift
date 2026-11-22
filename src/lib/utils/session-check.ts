/**
 * The session check (docs/plans/session-check.md, decisions 1, 2, 7 and 8):
 * one rule that judges each target of each step of a bike or run session
 * against what was done, the step page's cards, the verdict of a whole
 * session over its work steps, and the split of a watch-only activity into
 * the planned steps.
 *
 * Pure: the step page, the ride and run summaries and the widget call it.
 */

import { bpmText, indoorHr, outdoorMain, wattsText } from "@/lib/utils/bike-ride-view";
import type { StepLog } from "@/lib/utils/ride-results";
import { splitRide, timerPauses, type FitEvent, type FitLap, type RideSplit } from "@/lib/utils/ride-stream";
import { rideClock } from "@/lib/utils/ride-screen";
import { planSport, type RidePlan, type RidePlanStep } from "@/lib/utils/ride-timeline";
import { runOutdoorText, runStepTitle, runTargetText } from "@/lib/utils/run-view";
import { minSec } from "@/lib/utils/thresholds";
import { mainTarget, type ResolvedTarget, type WorkoutStep } from "@/lib/utils/workout-steps";

// ── The rule ────────────────────────────────────────────────────────────────

/** in: inside the range; over or under: past the margin; none: no target, no number, or not judged. */
export type Mark = "in" | "over" | "under" | "none";
export type CheckMetric = "power" | "hr" | "cadence" | "pace" | "time";
/** A range; a cap has only a high end ("HR under 162"), a floor only a low end. */
export type Band = { low: number | null; high: number | null };

/** Over or under only past these: W, bpm, rpm or spm, seconds per km. */
export const MARGIN = { power: 3, hr: 2, cadence: 2, pace: 5 } as const;
/** Heart rate rises too slowly to judge a step shorter than this. */
export const HR_JUDGED_FROM_S = 180;
/** A step's time is in within this share of its planned time, as the Plan colours read a session. */
export const TIME_SHARE = 0.1;

/**
 * Judge one average against its target. Pace is in seconds per km (a lower
 * number is faster), so over is faster than the range. Time takes the
 * planned seconds as its band. `seconds` is the step's length (heart rate is
 * not judged under 3 min, nor with no length); `outdoor` leaves pace unjudged.
 */
export function judge(metric: CheckMetric, actual: number | null, target: Band | null, opts: { seconds?: number | null; outdoor?: boolean } = {}): Mark {
  if (actual === null || !target || (target.low === null && target.high === null)) return "none";
  if (metric === "time") {
    const planned = target.high ?? target.low!;
    if (planned <= 0) return "none";
    const off = actual - planned;
    return Math.abs(off) <= TIME_SHARE * planned ? "in" : off > 0 ? "over" : "under";
  }
  if (metric === "hr" && (opts.seconds == null || opts.seconds < HR_JUDGED_FROM_S)) return "none";
  if (metric === "pace" && opts.outdoor) return "none";
  const m = MARGIN[metric];
  const lo = target.low !== null && target.high !== null ? Math.min(target.low, target.high) : target.low;
  const hi = target.low !== null && target.high !== null ? Math.max(target.low, target.high) : target.high;
  if (metric === "pace") {
    if (lo !== null && actual < lo - m) return "over";
    if (hi !== null && actual > hi + m) return "under";
    return "in";
  }
  if (hi !== null && actual > hi + m) return "over";
  if (lo !== null && actual < lo - m) return "under";
  return "in";
}

/** The mark as the screens show it (decision 2): words and arrows. */
export const MARK_TEXT: Record<Mark, string> = { in: "✓ in", over: "↑ over", under: "↓ under", none: "·" };
/** The arrow of a mark that is out; null when it is in or not judged. */
export const arrowOf = (m: Mark): "↑" | "↓" | null => (m === "over" ? "↑" : m === "under" ? "↓" : null);

// ── Heart rate words of a run step ──────────────────────────────────────────

/** "HR under 162" → a cap, 161 the highest that passes; "HR 153-161" → a range. Read from the words the run screens show, so the mark judges what the runner saw. */
export function hrBand(text: string | null): { low: number | null; high: number | null; cap: boolean } | null {
  if (!text) return null;
  let m = /^HR under (\d+)$/.exec(text);
  if (m) return { low: null, high: Number(m[1]) - 1, cap: true };
  m = /^HR (\d+)-(\d+)$/.exec(text);
  if (m) return { low: Number(m[1]), high: Number(m[2]), cap: false };
  m = /^HR (\d+) or more$/.exec(text);
  if (m) return { low: Number(m[1]), high: null, cap: false };
  m = /^HR (\d+)$/.exec(text);
  return m ? { low: Number(m[1]), high: Number(m[1]), cap: false } : null;
}

/** The heart rate words of a run step as its mode shows them: the written target on a treadmill, the target of the outdoor screens outdoors. */
export function runHrText(s: RidePlanStep, plan: RidePlan): string | null {
  const th = plan.thresholds;
  if (plan.mode === "indoor") return mainTarget(s.step)?.metric === "hr" ? runTargetText(s, th) : null;
  const o = runOutdoorText(s, th, plan.surface ?? "road");
  return [o.main, o.second].find((t) => t?.startsWith("HR ")) ?? null;
}

// ── One step ────────────────────────────────────────────────────────────────

export type CheckRow = {
  metric: Exclude<CheckMetric, "time">;
  /** "Power", "Heart rate", "Cadence", "Pace". */
  label: string;
  /** "146 W", "141", "83 rpm", "5:59 /km"; "–" with no number. */
  value: string;
  /** The plan's target: "140-149", "under 162", "85-95". */
  plan: string;
  mark: Mark;
  /** The average judged, in the metric's unit (pace in s/km); null with none. */
  actual: number | null;
};

export type StepCheck = {
  key: string;
  n: number;
  /** "Work · 1 of 3", "Warm-up". */
  title: string;
  type: WorkoutStep["type"];
  /** A work step: the session's verdict reads only these. */
  work: boolean;
  /** done, partial or skipped as logged; null when the step was not done. */
  status: StepLog["status"] | null;
  seconds: number | null;
  plannedSeconds: number | null;
  /** "15:00", "–"; plan "15:00" or "to lap". */
  time: { value: string; plan: string; mark: Mark };
  /** Each target the step has, in the order Power, Heart rate, Cadence, Pace; none on a warm-up, recovery, rest or cool-down. */
  rows: CheckRow[];
  /** The step's averages, target or not (pace in s/km), for the widget's "no target" rows; null when not done. */
  measured: Record<CheckRow["metric"], number | null>;
};

const STEP_WORD: Record<WorkoutStep["type"], string> = { warmup: "Warm-up", work: "Work", recovery: "Easy", cooldown: "Cool-down", rest: "Rest" };
const LABEL = { power: "Power", hr: "Heart rate", cadence: "Cadence", pace: "Pace" } as const;

const bandOf = (t: Pick<ResolvedTarget, "low" | "high"> | null): Band | null => (t && (t.low !== null || t.high !== null) ? { low: t.low, high: t.high } : null);
const stripHr = (t: string) => t.replace(/^HR /, "");

/** The pace range of a speed target (m/s) in s/km: low is the fast end. */
function paceBand(t: ResolvedTarget | null): Band | null {
  if (!t || t.unit !== "m/s" || t.missing || (t.low === null && t.high === null)) return null;
  const sec = (v: number | null) => (v && v > 0 ? 1000 / v : null);
  const [a, b] = [sec(t.low), sec(t.high)];
  return { low: a !== null && b !== null ? Math.min(a, b) : b, high: a !== null && b !== null ? Math.max(a, b) : a };
}

export function paceBandText(b: Band): string {
  const t = (s: number) => minSec(Math.round(s));
  if (b.low !== null && b.high !== null) return t(b.low) === t(b.high) ? t(b.low) : `${t(b.low)}-${t(b.high)}`;
  // low is the fast end: faster than it is over, so the band runs from it to slower.
  return b.low !== null ? `${t(b.low)} or slower` : `${t(b.high!)} or faster`;
}

/** A belt the app sets from a pace rounds to 0.5 km/h (resolveBelt), so it can sit this far outside the pace range. */
export const BELT_ROUNDING_KMH = 0.25;

/**
 * A treadmill step's band for judging: the pace range widened by the belt's
 * rounding and to the belt the app froze, so the runner who ran the app's own
 * belt is never marked out. The plan text keeps the written range.
 */
function treadmillBand(b: Band, frozenBeltTenths: number | null | undefined): Band {
  const pace = (kmh: number) => 3600 / kmh;
  const kmhOf = (s: number) => 3600 / s;
  let low = b.low !== null ? pace(kmhOf(b.low) + BELT_ROUNDING_KMH) : null;
  let high = b.high !== null && kmhOf(b.high) > BELT_ROUNDING_KMH ? pace(kmhOf(b.high) - BELT_ROUNDING_KMH) : b.high;
  if (frozenBeltTenths) {
    const f = pace(frozenBeltTenths / 10);
    if (low !== null) low = Math.min(low, f);
    if (high !== null) high = Math.max(high, f);
  }
  return { low, high };
}

/** A run step's pace in s/km: the belt on a treadmill, its distance over its time outdoors, else its speed. */
function paceOf(log: StepLog, treadmill: boolean): number | null {
  if (!treadmill && log.distanceMeters && log.durationSeconds) return log.durationSeconds / (log.distanceMeters / 1000);
  if (log.avgSpeed && log.avgSpeed > 0) return 1000 / (treadmill ? Math.round(log.avgSpeed * 36) / 36 : log.avgSpeed);
  return null;
}

/** The cadence a step targets: its own range, else a cadence target. */
function cadenceBand(s: RidePlanStep): Band | null {
  if (s.step.cadence) return { low: s.step.cadence.low, high: s.step.cadence.high };
  return bandOf([s.target, s.target2].find((t) => t?.unit === "rpm" && !t.missing) ?? null);
}

const done = (log: StepLog | null): log is StepLog => !!log && log.status !== "skipped" && (log.durationSeconds ?? 0) > 0;

/**
 * Every target of one step against its log (decision 1): power (bike), heart
 * rate (the main target, the second target, or the heart rate the outdoor
 * screens show), cadence, pace (run) and time. A warm-up, recovery, rest or
 * cool-down shows its time only. A step not done is judged on nothing.
 */
export function checkStep(plan: RidePlan, i: number, log: StepLog | null): StepCheck {
  const s = plan.steps[i];
  const run = planSport(plan) === "run";
  const outdoor = plan.mode === "outdoor";
  const work = s.step.type === "work";
  const ok = done(log);
  const seconds = ok ? log.durationSeconds : null;
  const length = s.seconds ?? seconds;
  const rows: CheckRow[] = [];
  const add = (metric: CheckRow["metric"], band: Band | null, actual: number | null, value: string, plan: string, opts: { outdoor?: boolean } = {}) => {
    rows.push({ metric, label: LABEL[metric], value: actual === null ? "–" : value, plan, mark: ok ? judge(metric, actual, band, { seconds: length, ...opts }) : "none", actual });
  };
  const n = (v: number | null | undefined) => (ok && v != null ? v : null);

  if (work && !s.step.free) {
    if (!run) {
      const w = wattsText(s);
      if (s.power && w) {
        const p = s.power;
        add("power", { low: p.from !== null && p.to !== null ? Math.min(p.from, p.to) : p.from, high: p.from !== null && p.to !== null ? Math.max(p.from, p.to) : p.to }, n(log?.avgPower), `${log?.avgPower} W`, w.replace(/ W$/, ""));
      }
      const main = mainTarget(s.step)?.metric === "hr" ? s.target : outdoor ? outdoorMain(s, plan) : null;
      const hr = (main?.unit === "bpm" && !main.missing ? main : null) ?? indoorHr(s);
      if (hr && !hr.missing && bandOf(hr)) add("hr", bandOf(hr), n(log?.avgHr), `${log?.avgHr}`, bpmText(hr));
    } else {
      const words = hrBand(runHrText(s, plan));
      const second = s.target2?.unit === "bpm" && !s.target2.missing ? s.target2 : null;
      if (words) add("hr", { low: words.low, high: words.high }, n(log?.avgHr), `${log?.avgHr}`, stripHr(runHrText(s, plan)!));
      else if (second && bandOf(second)) add("hr", bandOf(second), n(log?.avgHr), `${log?.avgHr}`, bpmText(second));
    }
    const cad = cadenceBand(s);
    if (cad) {
      const unit = run ? "spm" : "rpm";
      add("cadence", cad, n(log?.avgCadence), `${log?.avgCadence} ${unit}`, cad.low === cad.high ? `${cad.low}` : `${cad.low ?? ""}-${cad.high ?? ""}`);
    }
    if (run) {
      const t = [s.target, s.target2, outdoor ? s.outdoor : null].find((x) => x?.unit === "m/s" && !x.missing) ?? null;
      const band = paceBand(t);
      const pace = ok ? paceOf(log, !outdoor) : null;
      if (band) add("pace", outdoor ? band : treadmillBand(band, s.run?.belt), pace, pace === null ? "–" : `${minSec(Math.round(pace))} /km`, paceBandText(band), { outdoor });
    }
  }

  return {
    key: s.key,
    n: i + 1,
    title: run ? runStepTitle(s, plan.thresholds) : `${STEP_WORD[s.step.type]}${s.round && s.step.type !== "recovery" && s.step.type !== "rest" ? ` · ${s.round.index} of ${s.round.of}` : ""}`,
    type: s.step.type,
    work,
    status: log && (log.durationSeconds ?? 0) > 0 ? log.status : null,
    seconds,
    plannedSeconds: s.seconds,
    time: {
      value: seconds !== null ? rideClock(seconds) : log?.status === "skipped" ? "Skipped" : "–",
      plan: s.seconds !== null ? rideClock(s.seconds) : "to lap",
      mark: s.seconds !== null && seconds !== null ? judge("time", seconds, { low: s.seconds, high: s.seconds }) : "none",
    },
    rows,
    measured: { power: n(log?.avgPower), hr: n(log?.avgHr), cadence: n(log?.avgCadence), pace: run && ok ? paceOf(log, !outdoor) : null },
  };
}

/**
 * A step's marks by metric for get_ride: power (bike) or pace (run), heart
 * rate, cadence and time; null where the step has no such target or it was
 * not judged.
 */
export function stepMarks(c: StepCheck, sport: "bike" | "run") {
  const of = (m: CheckRow["metric"]) => {
    const mark = c.rows.find((r) => r.metric === m)?.mark ?? "none";
    return mark === "none" ? null : mark;
  };
  const time = c.time.mark === "none" ? null : c.time.mark;
  return sport === "run" ? { pace: of("pace"), hr: of("hr"), cadence: of("cadence"), time } : { power: of("power"), hr: of("hr"), cadence: of("cadence"), time };
}

/** Every step of a plan, judged. */
export function checkSteps(plan: RidePlan, logs: Record<number, StepLog>): StepCheck[] {
  return plan.steps.map((s, i) => checkStep(plan, i, logs[s.programSetId] ?? null));
}

// ── The whole session ───────────────────────────────────────────────────────

export type MetricVerdict = {
  metric: CheckMetric;
  /** All judged work steps in: in; else the more common of over and under (over on a tie); none when nothing was judged. */
  mark: Mark;
  counts: { in: number; over: number; under: number };
  /** The time-weighted average over the judged work steps (time: their total seconds); null with none. */
  actual: number | null;
  /** Time only: the planned seconds of those steps. */
  planned: number | null;
};

/**
 * The verdict of a session (decision 1): each metric over its work steps only,
 * since a warm-up and a cool-down would hide what matters. Time judges the
 * work steps' total against their planned total.
 */
export function sessionVerdict(steps: StepCheck[]): MetricVerdict[] {
  const work = steps.filter((s) => s.work && s.seconds !== null);
  const out: MetricVerdict[] = [];
  for (const metric of ["power", "hr", "cadence", "pace"] as const) {
    const judged = work.flatMap((s) => s.rows.filter((r) => r.metric === metric && r.mark !== "none").map((r) => ({ r, w: s.seconds! })));
    if (!work.some((s) => s.rows.some((r) => r.metric === metric))) continue;
    const counts = { in: 0, over: 0, under: 0 };
    for (const { r } of judged) counts[r.mark as "in" | "over" | "under"] += 1;
    const weighted = work.flatMap((s) => s.rows.filter((r) => r.metric === metric && r.actual !== null).map((r) => ({ v: r.actual!, w: s.seconds! })));
    const total = weighted.reduce((a, x) => a + x.w, 0);
    out.push({
      metric,
      mark: !judged.length ? "none" : counts.over + counts.under === 0 ? "in" : counts.over >= counts.under ? "over" : "under",
      counts,
      actual: total > 0 ? weighted.reduce((a, x) => a + x.v * x.w, 0) / total : null,
      planned: null,
    });
  }
  const timed = work.filter((s) => s.plannedSeconds !== null);
  const actual = timed.reduce((a, s) => a + s.seconds!, 0);
  const planned = timed.reduce((a, s) => a + s.plannedSeconds!, 0);
  const mark = timed.length ? judge("time", actual, { low: planned, high: planned }) : "none";
  out.push({ metric: "time", mark, counts: { in: mark === "in" ? 1 : 0, over: mark === "over" ? 1 : 0, under: mark === "under" ? 1 : 0 }, actual: timed.length ? actual : null, planned: timed.length ? planned : null });
  return out;
}

// ── A watch-only session ────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Stream seconds of an active second (pauses in order): each timer pause before it pushes it on, and one that starts on it too for a step's start. */
function activeToStream(a: number, pauses: [number, number][], startOf: boolean): number {
  let t = a;
  for (const [s, e] of pauses) if (s < t || (startOf && s === t)) t += e - s;
  return t;
}

/**
 * Split a Garmin activity done on the watch alone into the planned steps
 * (decision 8): by its laps when there is one lap per step, else by the
 * planned step times from the activity's start, on active time (Garmin's
 * timer pauses push each step on). `steps` are the plan's steps with their
 * planned (or estimated) seconds. Reuses `splitRide` for both.
 */
export function splitWatchOnly(steps: { programSetId: number; seconds: number }[], laps: FitLap[], events: FitEvent[], t0Ms: number): RideSplit {
  const timers = laps.map((l) => num(l.totalTimerTime) ?? num(l.totalElapsedTime));
  if (steps.length > 0 && laps.length === steps.length && timers.every((t) => t !== null && t > 0)) {
    // Each step's ridden time is its own lap's, so the split's 10 % check passes on the laps.
    const split = splitRide(steps.map((s, i) => ({ programSetId: s.programSetId, activeSeconds: timers[i]!, startedAt: 0, endedAt: 0 })), laps, events, t0Ms);
    if (split.method === "laps") return split;
  }
  const pauses = timerPauses(events, t0Ms).sort((x, y) => x[0] - y[0]);
  const ms = (sec: number) => t0Ms + sec * 1000;
  let at = 0;
  const timed = steps.map((s) => {
    const from = activeToStream(at, pauses, true);
    at += s.seconds;
    return { programSetId: s.programSetId, activeSeconds: s.seconds, startedAt: ms(from), endedAt: ms(activeToStream(at, pauses, false)) };
  });
  return splitRide(timed, [], events, t0Ms, pauses.map(([a, b]) => [ms(a), ms(b)] as [number, number]));
}
