/**
 * The guided player's state machine (docs/plans/endurance-app.md, section 3).
 *
 * Pure: every event takes the state and the wall-clock time and returns a new
 * state. Time is always derived from timestamps, never counted from ticks, the
 * same pattern as the rest and exercise timers in WorkoutSetsList. So an app
 * that iOS suspended loses no time: the next `tick` closes every time step that
 * ended meanwhile, each with its exact end time.
 *
 * The input type is structural, so this module does not depend on the final
 * workout schema of package C4. A C4 workout fits it.
 */

import { z } from "zod";

// ── Input: a workout, as far as the player needs it ──────────────────────────

export type PlayStepType = "warmup" | "work" | "recovery" | "cooldown" | "rest";
export type PlayEnd = { type: "time"; seconds: number } | { type: "distance"; meters: number } | { type: "lap" };
export type PlayInputStep = { id?: string; type: PlayStepType; end: PlayEnd; sendOffSeconds?: number };
export type PlayInputRepeat = { id?: string; type: "repeat"; count: number; steps: PlayInputStep[] };
export type PlayableWorkout = { steps: (PlayInputStep | PlayInputRepeat)[] };

/** The C4 limit on steps once repeats are expanded. */
export const PLAY_STEPS_MAX = 400;

export type PlayStep<S extends PlayInputStep = PlayInputStep> = {
  /** Step id, plus "#n" for round n of a repeat: "s3#2". */
  key: string;
  /** The original step, with its target, note and swim fields. */
  step: S;
  type: PlayStepType;
  round: { index: number; of: number } | null;
  /** Planned seconds for a time step, or the send-off of a swim rep; null waits for Lap. */
  seconds: number | null;
};

/** Expand repeats into one flat list. A step without an id gets one from its place ("n3"). */
export function flattenWorkout<S extends PlayInputStep>(w: { steps: (S | (Omit<PlayInputRepeat, "steps"> & { steps: S[] }))[] }): PlayStep<S>[] {
  const out: PlayStep<S>[] = [];
  const one = (s: S, id: string, round: PlayStep["round"]): PlayStep<S> => ({
    key: round ? `${id}#${round.index}` : id,
    step: s,
    type: s.type,
    round,
    seconds: s.sendOffSeconds !== undefined ? s.sendOffSeconds : s.end.type === "time" ? s.end.seconds : null,
  });
  w.steps.forEach((n, i) => {
    if (n.type === "repeat") {
      const r = n as Omit<PlayInputRepeat, "steps"> & { steps: S[] };
      for (let k = 1; k <= r.count; k++) {
        r.steps.forEach((s, j) => out.push(one(s, s.id ?? `n${i + 1}.${j + 1}`, { index: k, of: r.count })));
      }
    } else {
      const s = n as S;
      out.push(one(s, s.id ?? `n${i + 1}`, null));
    }
  });
  if (out.length > PLAY_STEPS_MAX) throw new RangeError(`${out.length} steps; at most ${PLAY_STEPS_MAX}`);
  return out;
}

/** A short, stable hash of the workout JSON (FNV-1a), to tell a changed workout from the one a run started with. */
export function workoutHash(w: unknown): string {
  const text = JSON.stringify(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── State ────────────────────────────────────────────────────────────────────

export type RunStatus = "done" | "skipped" | "partial";
export type StepRun = { key: string; startedAt: number; endedAt: number; activeSeconds: number; status: RunStatus; extendedSeconds: number };

export type PlayerState = {
  v: 1;
  plannedSessionId: number;
  workoutHash: string;
  /** Idempotency key for the save (endurance-app.md 3.8). */
  clientKey: string;
  status: "ready" | "running" | "paused" | "finished";
  index: number;
  /** Wall-clock start of the current step. */
  stepStartedAt: number | null;
  /** Paused time inside the current step. */
  stepPausedMs: number;
  pausedAt: number | null;
  pausedTotalMs: number;
  extendSeconds: number;
  startedAt: number | null;
  finishedAt: number | null;
  runs: StepRun[];
};

export function initialState(p: { plannedSessionId: number; workoutHash: string; clientKey: string }): PlayerState {
  return {
    v: 1,
    ...p,
    status: "ready",
    index: 0,
    stepStartedAt: null,
    stepPausedMs: 0,
    pausedAt: null,
    pausedTotalMs: 0,
    extendSeconds: 0,
    startedAt: null,
    finishedAt: null,
    runs: [],
  };
}

/** Extend limits: one tap adds at most 10 min; one step at most 1 h. */
export const EXTEND_MAX_TAP = 600;
export const EXTEND_MAX_STEP = 3600;

const isLive = (s: PlayerState) => s.status === "running" || s.status === "paused";

/** Planned end of the current time step, in wall-clock ms; null when it waits for Lap. */
function stepEnd(s: PlayerState, steps: PlayStep[]): number | null {
  const step = steps[s.index];
  if (!step || step.seconds === null || s.stepStartedAt === null) return null;
  return s.stepStartedAt + s.stepPausedMs + (step.seconds + s.extendSeconds) * 1000;
}

/** Active ms of the current step at `now` (pauses left out). */
function activeMs(s: PlayerState, now: number): number {
  if (s.stepStartedAt === null) return 0;
  const until = s.pausedAt ?? now;
  return Math.max(0, until - s.stepStartedAt - s.stepPausedMs);
}

/** Close the current step and start the next at `at`. */
function closeStep(s: PlayerState, steps: PlayStep[], endedAt: number, status: RunStatus, active: number): PlayerState {
  const run: StepRun = {
    key: steps[s.index].key,
    startedAt: s.stepStartedAt ?? endedAt,
    endedAt,
    activeSeconds: Math.round(active / 1000),
    status,
    extendedSeconds: s.extendSeconds,
  };
  const index = s.index + 1;
  const done = index >= steps.length;
  return {
    ...s,
    runs: [...s.runs, run],
    index,
    stepStartedAt: done ? null : endedAt,
    stepPausedMs: 0,
    extendSeconds: 0,
    status: done ? "finished" : s.status,
    finishedAt: done ? endedAt : null,
    // A step closed while paused: the next step starts paused at the same moment.
    pausedAt: done ? null : s.pausedAt !== null ? endedAt : null,
  };
}

export function start(s: PlayerState, steps: PlayStep[], now: number): PlayerState {
  if (s.status !== "ready" || steps.length === 0) return s;
  return { ...s, status: "running", index: 0, stepStartedAt: now, startedAt: now };
}

/**
 * Close every time step that has ended by `now`, with its exact end time. Stops
 * at a step that waits for Lap, or at the end. `changed` is how many steps closed,
 * for the cue: the screen plays one cue however many passed.
 */
export function tick(s: PlayerState, steps: PlayStep[], now: number): { state: PlayerState; changed: number } {
  let state = s;
  let changed = 0;
  while (state.status === "running") {
    const end = stepEnd(state, steps);
    if (end === null || end > now) break;
    const step = steps[state.index];
    state = closeStep(state, steps, end, "done", (step.seconds! + state.extendSeconds) * 1000);
    changed++;
  }
  return { state, changed };
}

export function pause(s: PlayerState, steps: PlayStep[], now: number): PlayerState {
  const t = tick(s, steps, now).state;
  return t.status === "running" ? { ...t, status: "paused", pausedAt: now } : t;
}

export function resume(s: PlayerState, now: number): PlayerState {
  if (s.status !== "paused" || s.pausedAt === null) return s;
  const gap = Math.max(0, now - s.pausedAt);
  return { ...s, status: "running", pausedAt: null, stepPausedMs: s.stepPausedMs + gap, pausedTotalMs: s.pausedTotalMs + gap };
}

/** Close the current step as skipped, with its active time so far. */
export function skip(s: PlayerState, steps: PlayStep[], now: number): PlayerState {
  const t = tick(s, steps, now).state;
  if (!isLive(t)) return t;
  return closeStep(t, steps, t.pausedAt ?? now, "skipped", activeMs(t, now));
}

/** Close a distance or lap step as done. A time step ends by itself; use skip to end it early. */
export function lap(s: PlayerState, steps: PlayStep[], now: number): PlayerState {
  const t = tick(s, steps, now).state;
  if (!isLive(t) || steps[t.index].seconds !== null) return t;
  return closeStep(t, steps, t.pausedAt ?? now, "done", activeMs(t, now));
}

/** Add time to the current time step. */
export function extend(s: PlayerState, steps: PlayStep[], seconds: number, now: number): PlayerState {
  const t = tick(s, steps, now).state;
  if (!isLive(t) || steps[t.index].seconds === null || !(seconds > 0) || seconds > EXTEND_MAX_TAP) return t;
  return { ...t, extendSeconds: Math.min(EXTEND_MAX_STEP, t.extendSeconds + Math.round(seconds)) };
}

/** End the run now. The current step closes as partial. */
export function finish(s: PlayerState, steps: PlayStep[], now: number): PlayerState {
  if (s.status === "finished") return s;
  if (s.status === "ready") return { ...s, status: "finished", finishedAt: now };
  const t = tick(s, steps, now).state;
  if (!isLive(t)) return t;
  const at = t.pausedAt ?? now;
  const closed = closeStep(t, steps, at, "partial", activeMs(t, now));
  return { ...closed, status: "finished", finishedAt: at, stepStartedAt: null, pausedAt: null };
}

/** Whole seconds left in the current time step (frozen while paused); null on a Lap step. */
export function remainingSeconds(s: PlayerState, steps: PlayStep[], now: number): number | null {
  if (!isLive(s)) return null;
  const end = stepEnd(s, steps);
  if (end === null) return null;
  return Math.max(0, Math.ceil((end - (s.pausedAt ?? now)) / 1000));
}

/** Whole active seconds in the current step (pauses left out). */
export function elapsedSeconds(s: PlayerState, now: number): number {
  return isLive(s) ? Math.floor(activeMs(s, now) / 1000) : 0;
}

/** Active seconds of the whole run so far, pauses left out. */
export function totalActiveSeconds(s: PlayerState, now: number): number {
  const closed = s.runs.reduce((a, r) => a + r.activeSeconds, 0);
  return closed + (isLive(s) ? Math.round(activeMs(s, now) / 1000) : 0);
}

// ── Persistence (localStorage "guidedWorkout", endurance-app.md 3.8) ─────────

export const PLAYER_STORAGE_KEY = "guidedWorkout";
/** A saved run older than this is dropped. */
export const PLAYER_TTL_MS = 24 * 60 * 60 * 1000;

const ms = z.number().int().nonnegative();
const storedSchema = z.strictObject({
  v: z.literal(1),
  plannedSessionId: z.number().int().positive(),
  workoutHash: z.string().min(1).max(32),
  clientKey: z.string().min(1).max(64),
  status: z.enum(["ready", "running", "paused", "finished"]),
  index: z.number().int().min(0).max(PLAY_STEPS_MAX),
  stepStartedAt: ms.nullable(),
  stepPausedMs: ms,
  pausedAt: ms.nullable(),
  pausedTotalMs: ms,
  extendSeconds: z.number().int().min(0).max(EXTEND_MAX_STEP),
  startedAt: ms.nullable(),
  finishedAt: ms.nullable(),
  runs: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(40),
        startedAt: ms,
        endedAt: ms,
        activeSeconds: z.number().int().min(0),
        status: z.enum(["done", "skipped", "partial"]),
        extendedSeconds: z.number().int().min(0).max(EXTEND_MAX_STEP),
      }),
    )
    .max(PLAY_STEPS_MAX),
});

/** What goes into localStorage: ids, timestamps and step statuses, no names or notes. */
export function serializePlayerState(s: PlayerState): string {
  return JSON.stringify(s);
}

export type RestoreResult =
  | { state: PlayerState }
  | { state: null; reason: "none" | "corrupt" | "expired" | "other_session" | "workout_changed"; stored?: PlayerState };

/**
 * Read a saved run back. Only a run for this planned session and this workout
 * resumes. A changed workout returns the stored run, so the screen can offer
 * "Finish with what was recorded".
 */
export function restorePlayerState(raw: string | null, expect: { plannedSessionId: number; workoutHash: string; now: number }): RestoreResult {
  if (!raw) return { state: null, reason: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: null, reason: "corrupt" };
  }
  const r = storedSchema.safeParse(parsed);
  if (!r.success) return { state: null, reason: "corrupt" };
  const s = r.data as PlayerState;
  if (s.plannedSessionId !== expect.plannedSessionId) return { state: null, reason: "other_session", stored: s };
  const since = s.startedAt ?? s.finishedAt;
  if (since !== null && expect.now - since > PLAYER_TTL_MS) return { state: null, reason: "expired" };
  if (s.workoutHash !== expect.workoutHash) return { state: null, reason: "workout_changed", stored: s };
  return { state: s };
}
