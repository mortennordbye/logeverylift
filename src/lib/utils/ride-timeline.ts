/**
 * Ride mode's plan and clock (docs/plans/bike-ride-logger.md, 4.3 and 4.4).
 *
 * A ride freezes its plan at start (`buildRidePlan`): the steps in the order
 * they are ridden, with watts from the FTP of that moment. Everything after
 * that, the clock, which step runs, when each step ended and how, is worked
 * out by `rideTimeline` from the plan and the ride's events alone. The server,
 * each device and the tests all call the same function, so they agree.
 *
 * Pure: no database, no clock. Times are epoch milliseconds.
 */

import type { RideEventKind, RideMode, RideStatus } from "@/db/schema/rides";
import { flattenWorkout } from "@/lib/utils/workout-player";
import {
  estimateWorkout,
  mainTarget,
  resolveStepTarget,
  resolveTarget,
  type ResolvedTarget,
  type ThresholdValues,
  type Workout,
  type WorkoutStep,
} from "@/lib/utils/workout-steps";

/** ±5 W per tap, at most ±50 W from the plan (4.4). */
export const NUDGE_STEP_W = 5;
export const NUDGE_CAP_W = 50;
/** +1 min per tap; a step takes at most one extra hour. */
export const EXTEND_STEP_S = 60;
export const EXTEND_MAX_S = 3600;
/** A ride still running this long after its planned end ends on its own (4.3). */
export const AUTO_END_AFTER_MS = 2 * 60 * 60 * 1000;
/** sendRideEvent's answer when another device sent an event first: refetch the ride and send again. */
export const RIDE_CONFLICT = "The ride changed on another device";

// ── The frozen plan ──────────────────────────────────────────────────────────

export type RidePlanStep = {
  /** Step id, plus "#n" for round n of a repeat, as the guided player keys it. */
  key: string;
  /** The program set the step logs to. */
  programSetId: number;
  step: WorkoutStep;
  round: { index: number; of: number } | null;
  /** Seconds the step runs; null when it ends on the lap button. */
  seconds: number | null;
  /** The main target in the user's numbers, and its cap. */
  target: ResolvedTarget | null;
  target2: ResolvedTarget | null;
  /** The target for an outdoor ride, when one is written. */
  outdoor: ResolvedTarget | null;
  /** Watts of a power target or a ramp, from the FTP at start; null without one. */
  power: { from: number | null; to: number | null } | null;
};

export type RidePlan = {
  v: 1;
  mode: RideMode;
  name: string;
  thresholds: ThresholdValues;
  steps: RidePlanStep[];
};

/** Watts of a step's power target or ramp: a range low to high, a ramp from to to. */
function stepWatts(s: WorkoutStep, thresholds: ThresholdValues): RidePlanStep["power"] {
  const main = mainTarget(s);
  if (main?.metric !== "power") return null;
  if (s.ramp && !s.target) {
    const ftp = thresholds.ftp;
    if (s.ramp.anchor === "ftp" && ftp === undefined) return null;
    const w = (p: number) => Math.round(s.ramp!.anchor === "ftp" ? (ftp! * p) / 100 : p);
    return { from: w(s.ramp.from), to: w(s.ramp.to) };
  }
  const r = resolveTarget(main, "bike", thresholds);
  if (r.missing) return null;
  const w = (n: number | null) => (n === null ? null : Math.round(n));
  return { from: w(r.low), to: w(r.high) };
}

/**
 * The steps of a bike workout as one ride, each with the program set it logs
 * to (`setIds`, one per step once repeats are expanded, in the same order as
 * the program's rows). In a repeat, the recovery after the last round is
 * dropped (4.4). Indoors a distance step runs for the plan's estimated time;
 * with no estimate, and outdoors, it ends on the lap button.
 */
export function buildRidePlan(workout: Workout, setIds: number[], thresholds: ThresholdValues, mode: RideMode): RidePlan {
  const play = flattenWorkout(workout);
  if (play.length !== setIds.length) throw new RangeError(`${play.length} steps but ${setIds.length} sets`);
  const lastRecovery = new Set<number>();
  let i = 0;
  for (const n of workout.steps) {
    if (n.type !== "repeat") {
      i++;
      continue;
    }
    for (let round = 1; round <= n.count; round++) {
      n.steps.forEach((s, j) => {
        const last = round === n.count && j === n.steps.length - 1 && n.steps.length > 1;
        if (last && (s.type === "recovery" || s.type === "rest")) lastRecovery.add(i);
        i++;
      });
    }
  }

  const steps: RidePlanStep[] = [];
  play.forEach((p, k) => {
    if (lastRecovery.has(k)) return;
    const s = p.step as WorkoutStep;
    let seconds: number | null = null;
    if (s.end.type === "time") seconds = s.end.seconds;
    else if (s.end.type === "distance" && mode === "indoor") {
      const est = estimateWorkout({ ...workout, steps: [s] }, thresholds);
      seconds = est.durationComplete && est.durationSeconds > 0 ? est.durationSeconds : null;
    }
    steps.push({
      key: p.key,
      programSetId: setIds[k],
      step: s,
      round: p.round,
      seconds,
      target: resolveStepTarget(s, "bike", thresholds),
      target2: s.target2 ? resolveTarget(s.target2, "bike", thresholds) : null,
      outdoor: s.outdoor ? resolveTarget(s.outdoor, "bike", thresholds) : null,
      power: stepWatts(s, thresholds),
    });
  });
  return { v: 1, mode, name: workout.name, thresholds, steps };
}

// ── The clock ────────────────────────────────────────────────────────────────

/** What the timeline needs of a plan step. */
export type TimelineStep = Pick<RidePlanStep, "key" | "programSetId" | "seconds" | "power">;

export type RideEventInput = {
  seq: number;
  kind: RideEventKind;
  /** Watts for a nudge (±5), seconds for an extend (±60). */
  value?: number | null;
  /** When it happened (see `eventTime`). */
  at: number;
};

export type RideStepResult = {
  index: number;
  key: string;
  programSetId: number;
  status: "done" | "skipped" | "partial";
  startedAt: number;
  endedAt: number;
  /** Seconds ridden, pauses left out. */
  activeSeconds: number;
  extendedSeconds: number;
  offsetW: number;
};

export type RideTimeline = {
  status: RideStatus;
  startedAt: number | null;
  endedAt: number | null;
  /** Ended on its own, 2 hours after its planned end. */
  autoEnded: boolean;
  /** The steps that have ended, in order. Each is saved when it appears here. */
  steps: RideStepResult[];
  /** The step that runs now; null before the start and after the end. */
  current: {
    index: number;
    startedAt: number;
    activeSeconds: number;
    /** Seconds left; null on a lap step. */
    remainingSeconds: number | null;
    /** When it ends if nothing changes; null on a lap step or while paused. */
    endsAt: number | null;
    extendedSeconds: number;
    offsetW: number;
  } | null;
  /** Seconds ridden in the whole ride, pauses left out. */
  activeSeconds: number;
  /** Planned seconds of the steps with an end time, extensions included. */
  plannedSeconds: number;
  /** Steps with no end time (lap), shown as "65 min + open". */
  openSteps: number;
};

/**
 * The time an event counts at. An offline event replays with its client time
 * when that falls inside the ride (after its start, not in the future), else
 * at the server's time (4.3).
 */
export function eventTime(clientAt: number | null | undefined, rideStartedAt: number, serverNow: number): number {
  if (clientAt == null || clientAt < rideStartedAt || clientAt > serverNow) return serverNow;
  return clientAt;
}

type Live = { index: number; startAt: number; pausedMs: number; pausedAt: number | null; extendS: number; offsetW: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * The ride at `now`, from its plan and events. Events apply in time order
 * (then by sequence). An event that does not fit the state (a pause while
 * paused, anything before the start or after the end) changes nothing.
 *
 * - A time step ends by itself when its time (plus extensions, pauses left
 *   out) is up: done. A lap step waits for `lap`.
 * - `skip` ends the step as skipped; `unskip` cancels the latest skip, and the
 *   step goes on as if it had not been skipped.
 * - `lap` ends the step: done on a lap step, partial on a time step.
 * - `end` on the last step finishes the ride; before it, the ride ends early.
 *   The step it ends is partial (left out with no time ridden).
 * - The ride ends on its own 2 hours after its planned end (start, plus the
 *   planned time and extensions, plus the pauses already over), at its last
 *   ended step. The step that ran is left out.
 */
export function rideTimeline(plan: { steps: TimelineStep[] }, events: RideEventInput[], now: number): RideTimeline {
  const steps = plan.steps;
  const sorted = [...events].sort((a, b) => a.at - b.at || a.seq - b.seq);

  // An unskip cancels the latest skip before it that is not cancelled yet.
  const cancelled = new Set<RideEventInput>();
  const skips: RideEventInput[] = [];
  for (const e of sorted) {
    if (e.kind === "skip") skips.push(e);
    else if (e.kind === "unskip") {
      const s = skips.pop();
      if (s) cancelled.add(s);
      cancelled.add(e);
    }
  }

  let status: RideStatus = "ready";
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let autoEnded = false;
  const done: RideStepResult[] = [];
  let live: Live | null = null;
  let pauseAt: number | null = null;
  let pausedOverMs = 0;
  let extendedOver = 0;

  const activeMs = (l: Live, t: number) => Math.max(0, (l.pausedAt ?? t) - l.startAt - l.pausedMs);
  const endOf = (l: Live) => {
    const s = steps[l.index].seconds;
    return s === null ? null : l.startAt + l.pausedMs + (s + l.extendS) * 1000;
  };
  const plannedEnd = () =>
    startedAt! + (steps.reduce((a, s) => a + (s.seconds ?? 0), 0) + extendedOver + (live?.extendS ?? 0)) * 1000 + pausedOverMs;

  /** Close the current step at `t`; with a status, it is saved. */
  const close = (t: number, st: RideStepResult["status"] | null) => {
    const l = live!;
    const step = steps[l.index];
    if (st) {
      done.push({
        index: l.index,
        key: step.key,
        programSetId: step.programSetId,
        status: st,
        startedAt: l.startAt,
        endedAt: t,
        activeSeconds: Math.round(activeMs(l, t) / 1000),
        extendedSeconds: l.extendS,
        offsetW: l.offsetW,
      });
    }
    extendedOver += l.extendS;
    live = null;
    return l;
  };
  /** Close the current step and start the next at `t`, or finish after the last. */
  const next = (t: number, st: RideStepResult["status"]) => {
    const l = close(t, st);
    if (l.index + 1 >= steps.length) {
      status = "finished";
      endedAt = t;
      return;
    }
    live = { index: l.index + 1, startAt: t, pausedMs: 0, pausedAt: status === "paused" ? t : null, extendS: 0, offsetW: 0 };
  };
  const isLive = () => status === "running" || status === "paused";
  /** Let time run to `t`: close the time steps that ended, then the auto end. */
  const advance = (t: number) => {
    while (live && status === "running") {
      const end = endOf(live);
      if (end === null || end > t) break;
      next(end, "done");
    }
    if (live && isLive() && t >= plannedEnd() + AUTO_END_AFTER_MS) {
      close(t, null);
      status = "ended_early";
      endedAt = done.length ? done[done.length - 1].endedAt : startedAt;
      autoEnded = true;
    }
  };

  for (const e of sorted) {
    if (cancelled.has(e)) continue;
    const t = e.at;
    if (e.kind === "start") {
      if (status !== "ready" || steps.length === 0) continue;
      status = "running";
      startedAt = t;
      live = { index: 0, startAt: t, pausedMs: 0, pausedAt: null, extendS: 0, offsetW: 0 };
      continue;
    }
    if (!isLive()) continue;
    advance(t);
    if (!live) continue;
    const l: Live = live;
    const step = steps[l.index];
    switch (e.kind) {
      case "pause":
        if (status !== "running") break;
        status = "paused";
        l.pausedAt = t;
        pauseAt = t;
        break;
      case "resume":
        if (status !== "paused") break;
        l.pausedMs += t - l.pausedAt!;
        l.pausedAt = null;
        pausedOverMs += t - pauseAt!;
        pauseAt = null;
        status = "running";
        break;
      case "skip":
        next(t, "skipped");
        break;
      case "lap":
        next(t, step.seconds === null ? "done" : "partial");
        break;
      case "extend":
        if (step.seconds !== null) l.extendS = clamp(l.extendS + (e.value ?? EXTEND_STEP_S), 0, EXTEND_MAX_S);
        break;
      case "nudge":
        if (step.power) l.offsetW = clamp(l.offsetW + (e.value ?? 0), -NUDGE_CAP_W, NUDGE_CAP_W);
        break;
      case "end": {
        const last = l.index === steps.length - 1;
        close(t, activeMs(l, t) >= 1000 ? "partial" : null);
        status = last ? "finished" : "ended_early";
        endedAt = t;
        break;
      }
    }
  }
  if (isLive()) advance(now);

  const cur = live as Live | null;
  let current: RideTimeline["current"] = null;
  if (cur) {
    const end = endOf(cur);
    current = {
      index: cur.index,
      startedAt: cur.startAt,
      activeSeconds: Math.floor(activeMs(cur, now) / 1000),
      remainingSeconds: end === null ? null : Math.max(0, Math.ceil((end - (cur.pausedAt ?? now)) / 1000)),
      endsAt: end !== null && status === "running" ? end : null,
      extendedSeconds: cur.extendS,
      offsetW: cur.offsetW,
    };
  }
  return {
    status,
    startedAt,
    endedAt,
    autoEnded,
    steps: done,
    current,
    activeSeconds: done.reduce((a, r) => a + r.activeSeconds, 0) + (current?.activeSeconds ?? 0),
    plannedSeconds: steps.reduce((a, s) => a + (s.seconds ?? 0), 0) + extendedOver + (cur?.extendS ?? 0),
    openSteps: steps.filter((s) => s.seconds === null).length,
  };
}
