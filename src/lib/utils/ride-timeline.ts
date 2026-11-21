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

import type { RideEventKind, RideMode, RideSport, RideStatus, RunSurface } from "@/db/schema/rides";
import { effortTarget, outdoorTarget } from "@/lib/utils/bike-outdoor";
import { rampEffort } from "@/lib/utils/ftp-tests";
import { flattenWorkout } from "@/lib/utils/workout-player";
import {
  estimateWorkout,
  mainTarget,
  resolveStepTarget,
  resolveTarget,
  rideTestOf,
  type ResolvedTarget,
  type ThresholdValues,
  type WorkoutTest,
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
/** For the auto end only: an open distance step at 25 km/h, a lap step 10 min. */
export const OPEN_STEP_SPEED_MS = 25 / 3.6;
export const LAP_STEP_EST_S = 600;
/**
 * Run speeds (docs/plans/run-logger.md, 4.3): for the auto end only, a
 * treadmill distance step with no belt and an outdoor distance step with no
 * pace count at 6 km/h.
 */
export const RUN_OPEN_STEP_SPEED_MS = 6 / 3.6;
/** Belt and incline events are absolute, in tenths (4.4): 80 is 8.0 km/h, 10 is 1.0%. */
export const BELT_RANGE = { min: 0, max: 250 } as const;
export const INCLINE_RANGE = { min: -30, max: 150 } as const;
/** A lap this soon after an outdoor distance step ended on its time moves that step's end (4.8). */
export const LATE_LAP_MS = 30_000;
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
  /** Seconds it likely runs, for the auto end only: its time, else an estimate. */
  estSeconds: number;
  /** The main target in the user's numbers, and its cap. */
  target: ResolvedTarget | null;
  target2: ResolvedTarget | null;
  /** The target for an outdoor ride: the written one, else derived from the power zone (4.2). */
  outdoor: ResolvedTarget | null;
  /** An outdoor effort shown under a heart rate target (a 3 to 5 min step); absent on a plan frozen before it existed. */
  outdoor2?: ResolvedTarget | null;
  /** Watts of a power target or a ramp, from the FTP at start; null without one. */
  power: { from: number | null; to: number | null } | null;
  /** A run step's end rule, belt and incline (docs/plans/run-logger.md, 4.3); absent on a ride. */
  run?: RunStepPlan;
};

/** Where a treadmill step's frozen belt came from (4.2), for the screen's cue. */
export type BeltSource = "step" | "pace" | "history" | "zone" | "effort";

/**
 * How a run step ends and what the belt does (4.3). `time` runs its seconds;
 * `belt_distance` (treadmill) ends when the belt has run its meters;
 * `estimate` (outdoor distance, R9) runs the seconds its pace gives, Lap ends
 * it early; `lap` waits for Lap. Belt and incline are in tenths, as the
 * events are. The belt is the step's own (it never carries over); a null
 * incline carries the one before.
 */
export type RunStepPlan = {
  rule: "time" | "belt_distance" | "estimate" | "lap";
  meters: number | null;
  belt: number | null;
  beltFrom: BeltSource | null;
  incline: number | null;
  /** The repeat id of a short-step block (a repeat whose work step is under 60 s, 4.5), else null. */
  block: string | null;
  /** The 20 min step of a treadmill run test (4.10): it starts at the belt the step before ended on, and its own belt is null. Absent elsewhere. */
  carry?: true;
};

export type RidePlan = {
  /** 1 is a ride; 2 a run, with `sport` and each step's `run` (docs/plans/run-logger.md, 4.3). */
  v: 1 | 2;
  /** Absent on a ride: a plan with no sport is a bike plan. */
  sport?: RideSport;
  mode: RideMode;
  /** An outdoor run's surface (R14). */
  surface?: RunSurface;
  name: string;
  /** An FTP test ride (4.9) or the run threshold test; absent on other rides and on a plan frozen before it existed. */
  test?: WorkoutTest;
  thresholds: ThresholdValues;
  steps: RidePlanStep[];
  /**
   * The program sets the ride never runs (the recovery after a repeat's last
   * round, 4.4), frozen as the steps are, so the end of the ride logs them as
   * planned at the start. Absent on a plan frozen before it existed.
   */
  dropped?: Pick<RidePlanStep, "key" | "programSetId" | "step" | "round">[];
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
  const dropped: NonNullable<RidePlan["dropped"]> = [];
  play.forEach((p, k) => {
    const s = p.step as WorkoutStep;
    if (lastRecovery.has(k)) {
      dropped.push({ key: p.key, programSetId: setIds[k], step: s, round: p.round });
      return;
    }
    let seconds: number | null = null;
    if (s.end.type === "time") seconds = s.end.seconds;
    else if (s.end.type === "distance" && mode === "indoor") {
      const est = estimateWorkout({ ...workout, steps: [s] }, thresholds);
      seconds = est.durationComplete && est.durationSeconds > 0 ? est.durationSeconds : null;
    }
    const estSeconds = seconds ?? (s.end.type === "distance" ? Math.round(s.end.meters / OPEN_STEP_SPEED_MS) : LAP_STEP_EST_S);
    const outdoor = outdoorTarget(s, estSeconds, thresholds, undefined, rideTestOf(workout.test));
    steps.push({
      key: p.key,
      programSetId: setIds[k],
      step: s,
      round: p.round,
      seconds,
      estSeconds,
      target: resolveStepTarget(s, "bike", thresholds),
      target2: s.target2 ? resolveTarget(s.target2, "bike", thresholds) : null,
      outdoor: outdoor?.main ?? null,
      outdoor2: outdoor?.second ?? null,
      power: stepWatts(s, thresholds),
    });
  });
  // Outdoors with no FTP the ramp's 1 min steps have no zone: they rise in effort instead (4.9).
  if (workout.test === "ramp") {
    const ramp = steps.filter((p) => p.step.type === "work");
    ramp.forEach((p, i) => {
      if (!p.outdoor) p.outdoor = effortTarget(rampEffort(i, ramp.length));
    });
  }
  return { v: 1, mode, name: workout.name, ...(workout.test && { test: workout.test }), thresholds, steps, dropped };
}

// ── The clock ────────────────────────────────────────────────────────────────

/** The sport of a frozen plan: a plan with no sport is a ride's. */
export const planSport = (plan: { sport?: RideSport }): RideSport => plan.sport ?? "bike";

/** What the timeline needs of a plan step. */
export type TimelineStep = Pick<RidePlanStep, "key" | "programSetId" | "seconds" | "power"> & { estSeconds?: number; step?: Pick<WorkoutStep, "type">; run?: RunStepPlan };

export type RideEventInput = {
  seq: number;
  kind: RideEventKind;
  /** Watts for a nudge (±5), seconds for an extend (±60), 1 for a block skip, tenths for a belt or an incline. */
  value?: number | null;
  /** When it happened (see `eventTime`). */
  at: number;
  /** The step key the client saw (run events, 4.4). */
  stepKey?: string | null;
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
  /** A run step's meters from the belt (null when the belt was never known) and its time-weighted incline in %. Absent on a ride. */
  distanceM?: number | null;
  inclinePct?: number | null;
  /** A run step's average belt speed in m/s, from the meters and time before rounding (null when the belt was never known). */
  avgSpeed?: number | null;
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
    /** A run step: the belt in km/h now (null by feel), the incline in % (null unknown), the meters from the belt, and the meters left on a belt distance step. */
    beltKmh?: number | null;
    inclinePct?: number | null;
    distanceM?: number | null;
    remainingMeters?: number | null;
  } | null;
  /** Seconds ridden in the whole ride, pauses left out. */
  activeSeconds: number;
  /** Planned seconds of the steps with an end time, extensions included. */
  plannedSeconds: number;
  /** Steps with no end time (lap), shown as "65 min + open". */
  openSteps: number;
  /** The rider's pauses as [from, to], epoch ms; a pause still open ends at the ride's end, else it is left out. */
  pauses: [number, number][];
};

/**
 * The time an event counts at. An offline event replays with its client time
 * when that falls inside the ride (after its start, not in the future), else
 * at the server's time (4.3). It never goes before `knownUntil`, the last
 * event or heartbeat the server has: a device that was online saw the ride
 * up to then, and a late replay does not rewrite that.
 */
export function eventTime(clientAt: number | null | undefined, rideStartedAt: number, serverNow: number, knownUntil = rideStartedAt): number {
  const t = clientAt == null || clientAt < rideStartedAt || clientAt > serverNow ? serverNow : clientAt;
  return Math.max(t, Math.min(knownUntil, serverNow));
}

type Live = {
  index: number;
  startAt: number;
  pausedMs: number;
  pausedAt: number | null;
  extendS: number;
  offsetW: number;
  /** Run only: the belt now (tenths, null by feel), the meters built up to `distAtMs` of active time, and whether a belt was ever known. */
  belt?: number | null;
  distM?: number;
  distAtMs?: number;
  beltSeen?: boolean;
  /** Run only: the incline now (tenths, null unknown), its sum over active ms up to `inclineAtMs`, and the ms it was known. */
  incline?: number | null;
  inclineSum?: number;
  inclineMs?: number;
  inclineAtMs?: number;
  /** Run only: the step started because an outdoor distance step ran out of its time (a late lap can move that end, 4.8). */
  afterEstimate?: boolean;
};

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
 * - In a ramp test (4.9) the rider rides the 1 min steps until they cannot
 *   hold the watts: `lap` or `end` on one of them finishes the ride, and that
 *   step is partial. Before any 1 min step is done, it ends the ride early.
 * - An extend taken back after the step's time is up ends the step then.
 * - The ride ends on its own 2 hours after the latest of its planned end
 *   (start, plus each step's time or estimate and the extensions, plus the
 *   pauses already over), its last event and its last heartbeat, at its last
 *   ended step. The step that ran is left out.
 *
 * A run plan (`sport` "run", docs/plans/run-logger.md, 4.3 to 4.5) adds:
 *
 * - Each step starts at its frozen belt; a `belt` or `incline` event sets
 *   the value from then on. Meters build from the belt over active time only,
 *   so a belt set while paused counts from the resume. A null incline on a
 *   step carries the one before.
 * - A `belt_distance` step ends when the belt has run its meters; with no
 *   belt it waits. It takes no extend.
 * - An `estimate` step ends on its estimated time; `lap` ends it early, done.
 *   A lap within 30 s after it ran out moves its end to the lap. A lap on any
 *   distance step is done; only a lap on a time step is partial.
 * - An event whose step key is another step's (an offline replay that lands
 *   later) is ignored: belt, incline, extend, skip and lap.
 * - `skip` with value 1 in a short-step block skips the rest of the block.
 * - An `end` before the start (during a treadmill's 5 s count) ends the run
 *   early with no steps.
 */
export function rideTimeline(
  plan: { steps: TimelineStep[]; test?: WorkoutTest; sport?: RideSport },
  events: RideEventInput[],
  now: number,
  opts: { heartbeatAt?: number | null } = {},
): RideTimeline {
  const steps = plan.steps;
  const run = planSport(plan) === "run";
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
  const pauses: [number, number][] = [];
  let pausedOverMs = 0;
  let extendedOver = 0;
  let lastAt = 0;
  /** Run only: the incline the next step carries when it has none of its own. */
  let carriedIncline: number | null = null;
  /** Run only: the belt the step before ended on, for a step that carries it (a run test, 4.10). */
  let carriedBelt: number | null = null;

  const activeMs = (l: Live, t: number) => Math.max(0, (l.pausedAt ?? t) - l.startAt - l.pausedMs);
  // Run only: meters per active ms of the belt now, and the meters at `t`.
  const beltPerMs = (l: Live) => (l.belt ? l.belt / 36 / 1000 : 0);
  const distAt = (l: Live, t: number) => (l.distM ?? 0) + beltPerMs(l) * (activeMs(l, t) - (l.distAtMs ?? 0));
  const inclineAvg = (l: Live, t: number) => {
    const ms = (l.inclineMs ?? 0) + (l.incline != null ? activeMs(l, t) - (l.inclineAtMs ?? 0) : 0);
    const sum = (l.inclineSum ?? 0) + (l.incline != null ? l.incline * (activeMs(l, t) - (l.inclineAtMs ?? 0)) : 0);
    return ms > 0 ? Math.round(sum / ms) / 10 : l.incline != null ? l.incline / 10 : null;
  };
  const endOf = (l: Live) => {
    const rule = steps[l.index].run?.rule;
    if (run && rule === "belt_distance") {
      const perMs = beltPerMs(l);
      if (perMs <= 0) return null;
      const meters = steps[l.index].run!.meters ?? 0;
      const needMs = (l.distAtMs ?? 0) + Math.max(0, meters - (l.distM ?? 0)) / perMs;
      return Math.round(l.startAt + l.pausedMs + needMs);
    }
    const s = steps[l.index].seconds;
    return s === null ? null : l.startAt + l.pausedMs + (s + l.extendS) * 1000;
  };
  const plannedEnd = () =>
    startedAt! + (steps.reduce((a, s) => a + (s.seconds ?? s.estSeconds ?? 0), 0) + extendedOver + (live?.extendS ?? 0)) * 1000 + pausedOverMs;
  const aliveUntil = () => Math.max(plannedEnd(), lastAt, opts.heartbeatAt ?? 0);

  /** A new live step at `t`; a run step starts at its frozen belt and its incline or the one carried. */
  const begin = (index: number, t: number, paused: boolean): Live => {
    const l: Live = { index, startAt: t, pausedMs: 0, pausedAt: paused ? t : null, extendS: 0, offsetW: 0 };
    if (!run) return l;
    const r = steps[index].run;
    const belt = r?.carry ? carriedBelt : (r?.belt ?? null);
    const incline = r?.incline ?? carriedIncline;
    return { ...l, belt, distM: 0, distAtMs: 0, beltSeen: belt !== null, incline, inclineSum: 0, inclineMs: 0, inclineAtMs: 0 };
  };
  /** The run fields of a step that ends at `t`. */
  const runResult = (l: Live, t: number) => {
    if (!run) return {};
    const ms = activeMs(l, t);
    const m = l.beltSeen ? distAt(l, t) : null;
    return { distanceM: m !== null ? Math.round(m) : null, inclinePct: inclineAvg(l, t), avgSpeed: m !== null && ms > 0 ? Math.round((m / ms) * 1e6) / 1000 : null };
  };

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
        ...runResult(l, t),
      });
    }
    if (run) {
      carriedIncline = l.incline ?? null;
      carriedBelt = l.belt ?? null;
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
    live = begin(l.index + 1, t, status === "paused");
  };
  const isLive = () => status === "running" || status === "paused";
  const rampStep = (s: TimelineStep) => plan.test === "ramp" && s.step?.type === "work";
  /** A ramp test ended before any 1 min step was done ends early (no result). */
  const rampDone = () => done.some((r) => r.status === "done" && rampStep(steps[r.index]));
  /** Let time run to `t`: close the time steps that ended, then the auto end. */
  const advance = (t: number) => {
    while (live && status === "running") {
      const end = endOf(live);
      if (end === null || end > t) break;
      const byEstimate = run && steps[live.index].run?.rule === "estimate";
      next(end, "done");
      if (byEstimate && live) (live as Live).afterEstimate = true;
    }
    if (live && isLive() && t >= aliveUntil() + AUTO_END_AFTER_MS) {
      close(t, null);
      status = "ended_early";
      endedAt = done.length ? done[done.length - 1].endedAt : startedAt;
      autoEnded = true;
    }
  };
  /** Run only: an event the client sent for another step than the one the timeline has at its time. */
  const otherStep = (e: RideEventInput, l: Live) => run && e.stepKey != null && e.stepKey !== steps[l.index].key;
  /** Run only: set the belt or incline of the live step from `t`. */
  const setBelt = (l: Live, t: number, v: number) => {
    l.distM = distAt(l, t);
    l.distAtMs = activeMs(l, t);
    l.belt = clamp(Math.round(v), BELT_RANGE.min, BELT_RANGE.max);
    l.beltSeen = true;
  };
  const setIncline = (l: Live, t: number, v: number) => {
    const ms = activeMs(l, t);
    if (l.incline != null) {
      l.inclineSum = (l.inclineSum ?? 0) + l.incline * (ms - (l.inclineAtMs ?? 0));
      l.inclineMs = (l.inclineMs ?? 0) + ms - (l.inclineAtMs ?? 0);
    }
    l.inclineAtMs = ms;
    l.incline = clamp(Math.round(v), INCLINE_RANGE.min, INCLINE_RANGE.max);
  };
  /**
   * Run only: a lap within 30 s after an outdoor distance step ran out of its
   * time ends that step at the lap instead, done, and the next step starts
   * there (4.8). Only while nothing else has happened in the new step.
   */
  const lateLap = (e: RideEventInput, l: Live, t: number) => {
    if (!run || !l.afterEstimate || l.pausedMs > 0 || l.pausedAt !== null || l.belt !== (steps[l.index].run?.belt ?? null)) return false;
    if (t - l.startAt > LATE_LAP_MS || l.index === 0) return false;
    const prev = done[done.length - 1];
    if (!prev || prev.index !== l.index - 1) return false;
    if (e.stepKey != null && e.stepKey !== prev.key && e.stepKey !== steps[l.index].key) return false;
    prev.activeSeconds = Math.round(prev.activeSeconds + (t - prev.endedAt) / 1000);
    prev.endedAt = t;
    live = begin(l.index, t, false);
    return true;
  };

  for (const e of sorted) {
    if (cancelled.has(e)) continue;
    const t = e.at;
    if (e.kind === "start") {
      if (status !== "ready" || steps.length === 0) continue;
      status = "running";
      startedAt = t;
      live = begin(0, t, false);
      continue;
    }
    // A run ended before its start (End at the last step during the 5 s count) ends early with no steps.
    if (run && e.kind === "end" && status === "ready") {
      status = "ended_early";
      endedAt = t;
      continue;
    }
    if (!isLive()) continue;
    advance(t);
    lastAt = t;
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
        pauses.push([pauseAt!, t]);
        pauseAt = null;
        status = "running";
        break;
      case "skip": {
        if (otherStep(e, l)) break;
        const block = run && e.value === 1 ? (step.run?.block ?? null) : null;
        next(t, "skipped");
        // The rest of a short-step block goes too (4.5).
        while (block && live && steps[(live as Live).index].run?.block === block) next(t, "skipped");
        break;
      }
      case "lap": {
        if (run && lateLap(e, l, t)) break;
        if (otherStep(e, l)) break;
        if (rampStep(step)) {
          close(t, activeMs(l, t) >= 1000 ? "partial" : null);
          status = rampDone() ? "finished" : "ended_early";
          endedAt = t;
          break;
        }
        const onDistance = run && (step.run?.rule === "estimate" || step.run?.rule === "belt_distance");
        next(t, step.seconds === null || onDistance ? "done" : "partial");
        break;
      }
      case "extend":
        if (step.seconds === null) break;
        if (otherStep(e, l)) break;
        l.extendS = clamp(l.extendS + (e.value ?? EXTEND_STEP_S), 0, EXTEND_MAX_S);
        if (status === "running") {
          const end = endOf(l);
          if (end !== null && end < t) next(t, "done");
        }
        break;
      case "nudge":
        if (run) break;
        if (step.power) l.offsetW = clamp(l.offsetW + (e.value ?? 0), -NUDGE_CAP_W, NUDGE_CAP_W);
        break;
      case "belt":
        if (!run || otherStep(e, l) || e.value == null) break;
        setBelt(l, t, e.value);
        // A belt that already ran the step's meters ends it now; a belt of 0 ends nothing.
        if (status === "running" && step.run?.rule === "belt_distance") {
          const end = endOf(l);
          if (end !== null && end <= t) next(t, "done");
        }
        break;
      case "incline":
        if (!run || otherStep(e, l) || e.value == null) break;
        setIncline(l, t, e.value);
        break;
      case "end": {
        const last = l.index === steps.length - 1 || (rampStep(step) && rampDone());
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
    if (run) {
      const r = steps[cur.index].run;
      const dist = distAt(cur, now);
      current = {
        ...current,
        beltKmh: cur.belt != null ? cur.belt / 10 : null,
        inclinePct: cur.incline != null ? cur.incline / 10 : null,
        distanceM: cur.beltSeen ? Math.round(dist) : null,
        remainingMeters: r?.rule === "belt_distance" ? Math.max(0, Math.round((r.meters ?? 0) - dist)) : null,
      };
    }
  }
  // A run's belt distance step with a belt has an end; with none it is open (4.3).
  const hasEnd = (s: TimelineStep) => s.seconds !== null || (run && s.run?.rule === "belt_distance" && s.run.belt !== null);
  return {
    status,
    startedAt,
    endedAt,
    autoEnded,
    steps: done,
    current,
    activeSeconds: done.reduce((a, r) => a + r.activeSeconds, 0) + (current?.activeSeconds ?? 0),
    plannedSeconds: steps.reduce((a, s) => a + (s.seconds ?? (hasEnd(s) ? (s.estSeconds ?? 0) : 0)), 0) + extendedOver + (cur?.extendS ?? 0),
    openSteps: steps.filter((s) => !hasEnd(s)).length,
    pauses: pauseAt !== null && endedAt !== null && endedAt > pauseAt ? [...pauses, [pauseAt, endedAt]] : pauses,
  };
}
