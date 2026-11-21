/**
 * What run mode shows (docs/plans/run-logger.md, 4.3 to 4.6 and section 5
 * "Run mode"), from the frozen run plan and the timeline at this moment: the
 * step, its clock, on a treadmill the belt and incline with the plan's belt,
 * outdoors the target of 4.2, the strides block, the Next card and its cue,
 * and the controls the step takes. Also the belt numbers a step saves (4.7).
 *
 * Pure: the screen only draws what this returns.
 */

import type { RideStepResult, RidePlan, RideTimeline } from "@/lib/utils/ride-timeline";
import { rideClock } from "@/lib/utils/ride-screen";
import { paceText } from "@/lib/utils/run-numbers";
import { hrTargetZone } from "@/lib/utils/run-plan";
import { KEEP_BELT, RUN_MODE_NAME, runOutdoorText, runRowOfStep, runStepTitle, runTargetText, runZoneCapText, runZoneRangeText } from "@/lib/utils/run-view";
import { mainTarget } from "@/lib/utils/workout-steps";
import { minSec } from "@/lib/utils/thresholds";

/** A cue shows this long before a step whose belt differs (4.4). */
export const BELT_CUE_S = 10;
/** A cue shows when the next belt differs from the belt now by this much or more, in km/h (4.4). */
export const BELT_CUE_KMH = 1;
/** A heart rate step whose belt is its zone's slow end is adjusted after this long; the cue shows until a minute after (4.2 rule 4). */
export const HR_ADJUST_AFTER_S = 360;
/** The first part of a brick run runs on effort (4.2). */
export const BRICK_EASY_S = 600;

export type RunScreen = {
  /** "Treadmill · step 2 of 4": a strides block counts as one step. */
  header: string;
  /** "24:18 of 75:00", "+ open" when a step has no end time. */
  total: string;
  /** The row the step is in (1-based), as the step list numbers it. */
  stepNumber: number;
  title: string;
  /** Time left in the step, or the time run on a lap or open step. */
  clock: string;
  remaining: number | null;
  /** A treadmill: the belt and incline now (null by feel or unknown) and the plan's, in km/h and %. */
  treadmill: { belt: number | null; planBelt: number | null; incline: number | null } | null;
  /** The big target outdoors (pace, heart rate cap or effort); null on a treadmill or with no target. */
  target: { value: string; unit: string | null } | null;
  /** The second line: heart rate and pace on a treadmill, the other target outdoors. */
  second: { label: string; value: string }[];
  /** "1 km · about 4:50" outdoors, "0.62 km left" on a treadmill distance step; null on a time step. */
  distanceLine: string | null;
  /** A strides block (4.5): the round and one dot per rep, done ones filled. */
  block: { index: number; of: number; done: number } | null;
  next: { title: string; target: string | null };
  /** "Speed up to 13.0 km/h" 10 s before a step whose belt differs by 1 km/h or more (4.4). */
  cue: string | null;
  lastMinute: boolean;
  /** +1 min on a step that ends on its time; never on a treadmill distance step (4.4). */
  canExtend: boolean;
  /** Lap outdoors; on a treadmill only on a step that ends on a lap. */
  lap: boolean;
  lapHint: string | null;
  /** Hold to skip ends the rest of the strides block (4.5). */
  inBlock: boolean;
};

const kmh = (n: number) => n.toFixed(1);

/** "7:30 /km" of a belt in km/h, cut to the whole second as the summary shows it (`paceText`). */
export function beltPace(beltKmh: number): string | null {
  return beltKmh > 0 ? paceText(3600 / beltKmh) : null;
}

/** The big target: the number and its unit apart, so the unit can be small. */
function big(text: string): { value: string; unit: string | null } {
  if (text.startsWith("HR ")) return { value: text.slice(3), unit: "bpm" };
  if (text.endsWith(" /km")) return { value: text.slice(0, -4), unit: "/km" };
  return { value: text, unit: null };
}

const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(2)} km`);

/**
 * The screen for the step that runs now; null before the start and after the
 * end. `brick`: the run follows a ride (4.2), so its first 10 min run on
 * effort 4 to 5 with short quick steps.
 */
export function runScreen(plan: RidePlan, t: RideTimeline, opts: { brick?: boolean } = {}): RunScreen | null {
  const cur = t.current;
  if (!cur) return null;
  const th = plan.thresholds;
  const s = plan.steps[cur.index];
  const run = s.run!;
  const treadmill = plan.mode === "indoor";
  const surface = plan.surface ?? "road";
  const rows = runRowOfStep(plan);
  const rowCount = rows.length ? rows[rows.length - 1] + 1 : 0;
  const remaining = cur.remainingSeconds;
  const brickEasy = !!opts.brick && t.activeSeconds < BRICK_EASY_S;

  // The strides block: its round, and how many reps of it are done.
  const inBlock = run.block !== null;
  let block: RunScreen["block"] = null;
  if (inBlock && s.round) {
    const work = plan.steps.filter((p) => p.run?.block === run.block && p.step.type === "work");
    const doneReps = t.steps.filter((r) => plan.steps[r.index].run?.block === run.block && plan.steps[r.index].step.type === "work").length;
    block = { index: s.round.index, of: work.length || s.round.of, done: doneReps };
  }
  const title = inBlock && s.step.type === "work" && s.round ? `Stride ${s.round.index} of ${s.round.of}` : runStepTitle(s, th);

  let target: RunScreen["target"] = null;
  const second: RunScreen["second"] = [];
  if (treadmill) {
    const hr = s.step.target?.metric === "hr" ? runTargetText(s, th) : null;
    if (brickEasy) second.push({ label: "Effort", value: "4-5" }, { label: "Short quick steps", value: "" });
    if (hr) second.push({ label: "HR", value: hr.replace(/^HR /, "") });
    const pace = cur.beltKmh ? beltPace(cur.beltKmh) : null;
    if (pace) second.push({ label: "Pace", value: pace });
  } else if (brickEasy) {
    target = { value: "Effort 4-5", unit: null };
    second.push({ label: "Short quick steps", value: "" });
    const cap = runZoneCapText(2, th);
    if (cap.startsWith("HR ")) second.push({ label: "HR", value: cap.slice(3) });
  } else {
    const o = runOutdoorText(s, th, surface);
    target = o.main ? big(o.main) : null;
    if (o.second) second.push(o.second.startsWith("HR ") ? { label: "HR", value: o.second.slice(3) } : { label: "", value: o.second });
  }

  let distanceLine: string | null = null;
  if (run.rule === "belt_distance" && cur.remainingMeters != null) distanceLine = `${distanceText(cur.remainingMeters)} left`;
  else if (run.rule === "estimate" && run.meters !== null && s.seconds !== null) distanceLine = `${distanceText(run.meters)} · about ${minSec(s.seconds + cur.extendedSeconds)}`;
  else if (run.rule === "lap" && run.meters !== null) distanceLine = `${distanceText(run.meters)} · tap Lap at the end`;

  // Next: the next step of a block, else the next row.
  const after = plan.steps[cur.index + 1];
  let next: RunScreen["next"] = { title: "Finish", target: null };
  if (after) {
    const afterBlock = after.run?.block ?? null;
    const sameRow = rows[cur.index + 1] === rows[cur.index];
    const len = (p: typeof after) => (p.seconds !== null ? minSec(p.seconds) : p.run?.meters != null ? distanceText(p.run.meters) : "to lap");
    let nextTitle: string;
    if (afterBlock && !sameRow) {
      const work = plan.steps.find((p) => p.run?.block === afterBlock && p.step.type === "work") ?? after;
      nextTitle = `Strides ${work.round?.of ?? 1} × ${work.seconds ?? work.estSeconds} s`;
    } else nextTitle = `${afterBlock && after.step.type === "work" && after.round ? `Stride ${after.round.index}` : runStepTitle(after, th)} · ${len(after)}`;
    const nextTarget = treadmill ? (after.run?.belt != null ? `${kmh(after.run.belt / 10)} km/h` : after.run?.carry ? KEEP_BELT : null) : runOutdoorText(after, th, surface).main;
    next = { title: nextTitle, target: nextTarget };
  }

  // The belt cue (4.4): 10 s before a step whose belt differs from the belt now by 1 km/h or more.
  let cue: string | null = null;
  if (treadmill && after?.run?.belt != null && remaining !== null && remaining <= BELT_CUE_S) {
    const to = after.run.belt / 10;
    const now = cur.beltKmh ?? null;
    if (now === null) cue = `Set belt ${kmh(to)} km/h`;
    else if (Math.abs(to - now) >= BELT_CUE_KMH - 1e-9) cue = `${to > now ? "Speed up" : "Slow down"} to ${kmh(to)} km/h`;
  }
  // A heart rate step that starts at its zone's slow end (4.2 rule 4): the runner sets the belt by heart rate after 6 min.
  const hrTarget = mainTarget(s.step);
  const zone = treadmill && run.beltFrom === "zone" && hrTarget?.metric === "hr" ? hrTargetZone(hrTarget, th) : null;
  if (!cue && zone !== null && (s.seconds ?? 0) > HR_ADJUST_AFTER_S && cur.activeSeconds < HR_ADJUST_AFTER_S + 60) {
    const range = runZoneRangeText(zone, th);
    if (range.startsWith("HR ")) cue = `Adjust after 6 min to hold ${range}`;
  }

  return {
    header: `${RUN_MODE_NAME[plan.mode]} · step ${rows[cur.index] + 1} of ${rowCount}`,
    total: `${rideClock(t.activeSeconds)} of ${rideClock(t.plannedSeconds)}${t.openSteps ? " + open" : ""}`,
    stepNumber: rows[cur.index] + 1,
    title,
    clock: rideClock(remaining ?? cur.activeSeconds),
    remaining,
    treadmill: treadmill ? { belt: cur.beltKmh ?? null, planBelt: run.belt !== null ? run.belt / 10 : null, incline: cur.inclinePct ?? null } : null,
    target,
    second,
    distanceLine,
    block,
    next,
    cue,
    lastMinute: remaining !== null && remaining <= 60,
    canExtend: s.seconds !== null && run.rule !== "belt_distance",
    lap: !treadmill || run.rule === "lap",
    lapHint: run.rule === "lap" ? "Tap Lap when done" : null,
    inBlock,
  };
}

/** "Steps 1 and 2", "Step 3", "Steps 1 to 4" of row numbers. */
function rowList(n: number[]): string {
  if (n.length === 1) return `Step ${n[0]}`;
  if (n.length > 3 && n.every((x, i) => i === 0 || x === n[i - 1] + 1)) return `Steps ${n[0]} to ${n[n.length - 1]}`;
  return `Steps ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/**
 * The steps of a run that are saved, as the step list numbers them (a
 * strides block is one step): "Steps 1 and 2 are saved". With `ending`, the
 * paused screen's line, which counts the step that runs once a second of it
 * is run, as End run saves it as partial.
 */
export function runKeptText(plan: Pick<RidePlan, "steps">, t: RideTimeline, ending = false): string {
  const rows = runRowOfStep(plan);
  const kept = new Set(t.steps.filter((r) => r.status !== "skipped").map((r) => rows[r.index] + 1));
  if (ending && t.current && t.current.activeSeconds >= 1) kept.add(rows[t.current.index] + 1);
  const n = [...kept].sort((a, b) => a - b);
  if (!n.length) return ending ? "No step is run yet. Ending now saves nothing." : "No step was run.";
  const verb = n.length === 1 ? "is" : "are";
  return ending ? `${rowList(n)} ${verb} saved. Ending now keeps ${n.length === 1 ? "it" : "them"}.` : `${rowList(n)} ${verb} saved`;
}

/** "Step on · Set belt 7.5 km/h": the 5 s count before a treadmill run's clock runs (4.3). */
export function stepOnText(plan: RidePlan): string {
  const belt = plan.steps[0]?.run?.belt;
  return belt != null ? `Step on · Set belt ${kmh(belt / 10)} km/h` : "Step on · Set the belt by feel";
}

/** The line on the paused screen of a treadmill run: the belt to set before Resume (4.4). */
export function resumeBeltText(t: RideTimeline): string | null {
  const b = t.current?.beltKmh;
  return b != null && b > 0 ? `Set belt ${kmh(b)} km/h` : null;
}

/** "Belt 9.5 km/h", "Incline 1.5%": the toast of a belt or incline burst (4.4). */
export function beltToastText(kind: "belt" | "incline", tenths: number): string {
  return kind === "belt" ? `Belt ${kmh(tenths / 10)} km/h` : `Incline ${+(tenths / 10).toFixed(1)}%`;
}

/** The belt fields a treadmill run step saves (4.7): meters, average speed in m/s and the time-weighted incline. */
export function beltResults(r: Pick<RideStepResult, "distanceM" | "inclinePct" | "activeSeconds"> & { avgSpeed?: number | null }): {
  distanceMeters?: number;
  avgSpeed?: number | null;
  inclinePercent?: number;
} {
  if (r.distanceM == null) return r.inclinePct != null ? { inclinePercent: r.inclinePct } : {};
  return {
    distanceMeters: r.distanceM,
    avgSpeed: r.avgSpeed ?? (r.activeSeconds > 0 ? Math.round((r.distanceM / r.activeSeconds) * 1000) / 1000 : null),
    ...(r.inclinePct != null && { inclinePercent: r.inclinePct }),
  };
}

/**
 * The ended steps whose belt meters or incline differ between two timelines
 * of the same run: the only rows a late belt or incline event writes again (4.7).
 */
export function beltStepsChanged(before: Pick<RideTimeline, "steps">, after: Pick<RideTimeline, "steps">): RideStepResult[] {
  const was = new Map(before.steps.map((r) => [r.programSetId, r]));
  return after.steps.filter((r) => {
    const b = was.get(r.programSetId);
    return !b || b.distanceM !== r.distanceM || b.inclinePct !== r.inclinePct || b.activeSeconds !== r.activeSeconds;
  });
}
