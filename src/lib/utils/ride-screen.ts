/**
 * What ride mode shows (docs/plans/bike-ride-logger.md, section 5 "Ride
 * mode"), from the frozen plan and the timeline at this moment. Also the
 * payload each step saves with when it ends (4.5).
 *
 * Pure: the screen only draws what this returns.
 */

import type { RideEventKind, RideMode } from "@/db/schema/rides";
import type { RideView } from "@/lib/actions/rides";
import { bikeStepRows, rideChart, wattsText } from "@/lib/utils/bike-ride-view";
import { isRampTestStep } from "@/lib/utils/ftp-tests";
import { NUDGE_CAP_W, eventTime, type RideEventInput, type RidePlan, type RidePlanStep, type RideStepResult, type RideTimeline } from "@/lib/utils/ride-timeline";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import type { ResolvedTarget } from "@/lib/utils/workout-steps";

/** "11:42", "0:48", "65:00": minutes and seconds, as the mockup's clocks. */
export function rideClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A step's watts moved by the rider's offset. */
export function shiftedPower(s: Pick<RidePlanStep, "power">, offsetW: number): RidePlanStep["power"] {
  if (!s.power) return null;
  const move = (n: number | null) => (n === null ? null : n + offsetW);
  return { from: move(s.power.from), to: move(s.power.to) };
}

/** "135-145 W" of a step with the offset; null on a step without watts. */
export function shiftedWattsText(s: RidePlanStep, offsetW: number): string | null {
  return wattsText({ step: s.step, power: shiftedPower(s, offsetW) });
}

/** "142-152", "under 139", "150 or more" of a heart rate target. */
function bpmText(t: ResolvedTarget): string {
  const r = (n: number) => Math.round(n);
  if (t.low !== null && t.high !== null) return r(t.low) === r(t.high) ? `${r(t.low)}` : `${r(t.low)}-${r(t.high)}`;
  if (t.high !== null) return `under ${r(t.high)}`;
  if (t.low !== null) return `${r(t.low)} or more`;
  return t.text;
}

/** The big target: the number and its unit apart, so the unit can be small. */
function bigTarget(text: string | null, outdoor: ResolvedTarget | null): { value: string; unit: string | null } | null {
  if (outdoor?.unit === "bpm") return { value: bpmText(outdoor), unit: "bpm" };
  if (outdoor) return { value: outdoor.text, unit: null };
  if (!text) return null;
  return text.endsWith(" W") ? { value: text.slice(0, -2), unit: "W" } : { value: text, unit: null };
}

export type RideScreen = {
  /** "Indoor · step 2 of 5". */
  header: string;
  /** "24:18 of 65:00", "+ open" when a step has no end time. */
  total: string;
  stepNumber: number;
  title: string;
  /** Time left in the step, or the time ridden on a lap step. */
  clock: string;
  /** Seconds left; null on a lap step. */
  remaining: number | null;
  target: { value: string; unit: string | null } | null;
  /** The second line: cadence and heart rate indoors, the power meter outdoors. */
  second: { label: string; value: string }[];
  next: { title: string; target: string | null };
  /** The last minute of a step: the Next card turns accent. */
  lastMinute: boolean;
  /** ±5 W shows on a step with watts; each end stops at ±50 W. */
  power: boolean;
  canLower: boolean;
  canRaise: boolean;
  /** +1 min on a step that ends on time. */
  canExtend: boolean;
  /** Lap outdoors, and indoors on a step that ends on the lap button or a ramp test step (4.9). */
  lap: boolean;
  /** The line under the clock on a lap step or a ramp test step; null on others. */
  lapHint: string | null;
  /** The mini profile: bars in the chart's units and the marker's x. */
  profile: { bars: { key: string; x: number; w: number; h: number; current: boolean }[]; markerX: number | null };
};

const MODE_WORD: Record<RideMode, string> = { indoor: "Indoor", outdoor: "Outdoor" };

/** The screen for the step that runs now; null before the start and after the end. */
export function rideScreen(plan: RidePlan, t: RideTimeline, units: Units = DEFAULT_UNITS): RideScreen | null {
  const cur = t.current;
  if (!cur) return null;
  const s = plan.steps[cur.index];
  const outdoor = plan.mode === "outdoor";
  // The current step with its offset, through the same rows the bike screen shows.
  const shifted: RidePlan = { ...plan, steps: plan.steps.map((p, i) => (i === cur.index ? { ...p, power: shiftedPower(p, cur.offsetW) } : p)) };
  const rows = bikeStepRows(shifted, units);
  const row = rows[cur.index];

  const second: RideScreen["second"] = [];
  const watts = shiftedWattsText(s, cur.offsetW);
  if (outdoor) {
    if (watts) second.push({ label: "Power meter", value: watts });
    if (s.outdoor2?.unit === "RPE" && s.outdoor2.low !== null) second.push({ label: "Effort", value: `${s.outdoor2.low}` });
  } else {
    if (s.step.cadence) second.push({ label: "Cadence", value: `${s.step.cadence.low}-${s.step.cadence.high}` });
    const hr = s.target2?.unit === "bpm" && !s.target2.missing ? s.target2 : s.outdoor?.unit === "bpm" ? s.outdoor : null;
    if (hr) second.push({ label: "HR", value: bpmText(hr) });
  }

  const after = rows[cur.index + 1];
  const next = after ? { title: `${after.title} · ${after.time}`, target: after.target } : { title: "Finish", target: null };

  // The chart gives each step its width; the bars here are its height in a small strip.
  const chart = rideChart(plan);
  const bars = chart.bars.map((b, i) => ({ key: b.key, x: b.x, w: b.w, h: Math.max(4, 100 - Math.min(b.y, b.y2)), current: i === cur.index }));
  const b = chart.bars[cur.index];
  const length = s.seconds !== null ? s.seconds + cur.extendedSeconds : s.estSeconds;
  const markerX = b ? +(b.x + b.w * Math.min(1, cur.activeSeconds / Math.max(1, length))).toFixed(1) : null;

  const remaining = cur.remainingSeconds;
  return {
    header: `${MODE_WORD[plan.mode]} · step ${cur.index + 1} of ${plan.steps.length}`,
    total: `${rideClock(t.activeSeconds)} of ${rideClock(t.plannedSeconds)}${t.openSteps ? " + open" : ""}`,
    stepNumber: cur.index + 1,
    title: row.title,
    clock: rideClock(remaining ?? cur.activeSeconds),
    remaining,
    target: bigTarget(outdoor ? null : row.target, outdoor ? s.outdoor : null) ?? bigTarget(row.target, null),
    second,
    next,
    lastMinute: remaining !== null && remaining <= 60,
    power: s.power !== null,
    canLower: s.power !== null && cur.offsetW > -NUDGE_CAP_W,
    canRaise: s.power !== null && cur.offsetW < NUDGE_CAP_W,
    canExtend: s.seconds !== null,
    lap: outdoor || s.seconds === null || isRampTestStep(plan.test, s),
    lapHint: isRampTestStep(plan.test, s) ? "Tap Lap when you cannot hold the watts" : remaining === null ? "Tap Lap when done" : null,
    profile: { bars, markerX },
  };
}

/** "Steps 1 and 2", "Step 3", "Steps 1, 2 and 4", "Steps 1 to 5". */
function stepList(numbers: number[]): string {
  if (numbers.length === 1) return `Step ${numbers[0]}`;
  const run = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  if (run && numbers.length > 3) return `Steps ${numbers[0]} to ${numbers[numbers.length - 1]}`;
  return `Steps ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * The line under End ride while paused: the steps that ending now keeps. The
 * step that runs counts once a second of it is ridden, as End ride saves it
 * as partial (rideTimeline).
 */
export function keptStepsText(t: RideTimeline): string {
  const numbers = t.steps.filter((r) => r.status !== "skipped").map((r) => r.index + 1);
  if (t.current && t.current.activeSeconds >= 1) numbers.push(t.current.index + 1);
  if (!numbers.length) return "No step is ridden yet. Ending now saves nothing.";
  return numbers.length === 1 ? `${stepList(numbers)} is saved. Ending now keeps it.` : `${stepList(numbers)} are saved. Ending now keeps them.`;
}

/** Since when the ride is paused: the last pause that is in effect. */
export function pausedSince(events: Pick<RideEventInput, "kind" | "at">[]): number | null {
  let at: number | null = null;
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.kind === "pause") at = e.at;
    else if (e.kind === "resume") at = null;
  }
  return at;
}

/** "Paused 2 min", "Paused under 1 min". */
export function pausedText(since: number | null, now: number): string {
  if (since === null) return "Paused";
  const m = Math.floor((now - since) / 60_000);
  return m < 1 ? "Paused under 1 min" : `Paused ${m} min`;
}

/** What a step that ended saves through `logWorkoutSet` (4.5). */
export function stepLogPayload(r: RideStepResult, ctx: { sessionId: number; exerciseId: number; setNumber: number }) {
  return {
    sessionId: ctx.sessionId,
    exerciseId: ctx.exerciseId,
    setNumber: ctx.setNumber,
    programSetId: r.programSetId,
    actualReps: 0,
    weightKg: 0,
    durationSeconds: r.activeSeconds,
    restTimeSeconds: 0,
    isCompleted: r.status !== "skipped",
    stepStatus: r.status,
    targetOffsetW: r.offsetW,
    extendedSeconds: r.extendedSeconds,
    sources: { durationSeconds: "clock" as const },
  };
}

/** A saved step's values in one string: the step saves again only when they change. */
export function stepSignature(r: RideStepResult): string {
  return `${r.status}:${r.activeSeconds}:${r.offsetW}:${r.extendedSeconds}`;
}

/** The ended steps whose values differ from what this phone last saved for them. */
export function stepsToSave(steps: RideStepResult[], saved: Record<string, string>): RideStepResult[] {
  return steps.filter((r) => saved[String(r.programSetId)] !== stepSignature(r));
}

// ── Taps waiting on this phone ───────────────────────────────────────────────

export type RideTap = Exclude<RideEventKind, "start" | "heartbeat">;
/** A tap not yet stored by the server: its client id (for replays) and when it happened, in server time. */
export type QueuedRideEvent = { clientId: string; kind: RideTap; value?: number; clientAt: number };

/** The server's events and the queued ones after them, timed the way the server will time them. */
export function withQueued(view: RideView, queued: QueuedRideEvent[], serverNow: number): RideEventInput[] {
  const stored = new Set(view.events.map((e) => e.clientId));
  const startedAt = view.ride.startedAt;
  let knownUntil = Math.max(startedAt, view.ride.heartbeatAt ?? 0, ...view.events.map((e) => e.at));
  let seq = view.ride.seq;
  const out: RideEventInput[] = [...view.events];
  for (const q of queued) {
    if (stored.has(q.clientId)) continue;
    const at = eventTime(q.clientAt, startedAt, serverNow, knownUntil);
    knownUntil = Math.max(knownUntil, at);
    out.push({ seq: ++seq, kind: q.kind, value: q.value ?? null, at });
  }
  return out;
}
