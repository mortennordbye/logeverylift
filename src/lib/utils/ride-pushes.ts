/**
 * The push alerts of a running ride (docs/plans/bike-ride-logger.md, D7 and
 * 4.7): one when a step starts and one a minute before a step ends, worked
 * out from the frozen plan and the timeline at this moment. The server
 * rewrites the ride's `ride_pushes` rows from this after every ride event.
 *
 * Pure: no database, no clock. Times are epoch milliseconds.
 */

import type { RidePushKind } from "@/db/schema/push";
import { bikeStepRows } from "@/lib/utils/bike-ride-view";
import type { RidePlan, RidePlanStep, RideTimeline } from "@/lib/utils/ride-timeline";
import { BRICK_EASY_S } from "@/lib/utils/run-screen";
import { KEEP_BELT, runOutdoorText, runRowOfStep, runStepTitle, runTargetText } from "@/lib/utils/run-view";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";

export type RidePushPlan = { sendAt: number; kind: RidePushKind; title: string; body: string; stepIndex: number };

/** The payload the service worker shows (public/push-sw.js). */
export type PushPayload = { title: string; body: string; tag: string; url: string };

/** "45 s", "5 min", "1 min 30 s": a time with no colon, for push text. */
function pushTime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** "Work · 1 of 2" reads "Work" after "next". */
const word = (title: string) => title.split(" · ")[0];

/**
 * The alerts still to come, in time order. None unless the ride runs: a
 * paused or ended ride has none, and a pause or the end rewrites them away.
 * The walk stops at a step with no end time (a lap step, an open distance
 * step): its start is the last alert, as nothing after it has a time. The
 * last step's end is the ride's end, and its alert says so.
 */
export function ridePushSchedule(plan: RidePlan, t: RideTimeline, now: number, units: Units = DEFAULT_UNITS): RidePushPlan[] {
  const cur = t.current;
  if (t.status !== "running" || !cur || cur.endsAt === null) return [];
  // A push title stays short: the target without the words of an easy spin (the step word says it).
  const rows = bikeStepRows(plan, units).map((r) => ({ ...r, target: r.target?.replace(/ · easy spin$/, "") ?? null }));
  const n = plan.steps.length;
  const time = (i: number) => {
    const s = plan.steps[i].seconds;
    return s !== null ? pushTime(s) : rows[i].time;
  };
  const out: RidePushPlan[] = [];

  let i = cur.index;
  let end = cur.endsAt;
  // Seconds the step runs from where the walk sees it: the rest of the current step, the whole of a later one.
  let length = cur.remainingSeconds ?? 0;
  for (;;) {
    const after = i + 1 < n ? rows[i + 1] : null;
    if (length > 60 && end - 60_000 > now) {
      out.push({
        sendAt: end - 60_000,
        kind: "minute_left",
        title: after ? `1 min left · next ${word(after.title)}${after.target ? ` ${after.target}` : ""}` : "1 min left · last step",
        body: `Step ${i + 1} of ${n} · ${rows[i].title}`,
        stepIndex: i,
      });
    }
    if (!after) {
      out.push({ sendAt: end, kind: "done", title: "Ride done", body: `Step ${n} of ${n} · ${rows[i].title} done`, stepIndex: i });
      break;
    }
    out.push({
      sendAt: end,
      kind: "step",
      title: [after.title, after.target, time(i + 1)].filter(Boolean).join(" · "),
      body: `Step ${i + 2} of ${n} · ${rows[i].title} done`,
      stepIndex: i + 1,
    });
    i++;
    const seconds = plan.steps[i].seconds;
    if (seconds === null) break;
    end += seconds * 1000;
    length = seconds;
  }
  return out;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const kmhText = (tenths: number) => `${(tenths / 10).toFixed(1)} km/h`;
const metersText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(2)} km`);

/**
 * The target a run alert names first (docs/plans/run-logger.md, step 6): on a
 * treadmill the step's frozen belt (and its own incline), else its heart rate,
 * else "Belt by feel"; outdoors the target of 4.2. A brick run's first 10 min
 * run on effort (4.2).
 */
function runPushTarget(plan: RidePlan, s: RidePlanStep, brickEasy: boolean): string | null {
  const th = plan.thresholds;
  if (plan.mode === "indoor") {
    const belt = s.run?.belt ?? null;
    const incline = s.step.incline !== undefined ? ` · incline ${s.step.incline}%` : "";
    if (belt !== null) return `${kmhText(belt)}${incline}`;
    if (s.run?.carry) return `${KEEP_BELT}${incline}`;
    return `${(s.step.target?.metric === "hr" && runTargetText(s, th)) || "Belt by feel"}${incline}`;
  }
  if (brickEasy) return "Effort 4-5";
  return runOutdoorText(s, th, plan.surface ?? "road").main;
}

/** How long a run step runs, for its alert: its time, else its distance, else "to lap". */
function runPushLength(s: RidePlanStep): string {
  if (s.run?.rule !== "belt_distance" && s.run?.rule !== "estimate" && s.seconds !== null) return pushTime(s.seconds);
  return s.run?.meters != null ? metersText(s.run.meters) : "to lap";
}

/**
 * The seconds a later run step runs, as the walk sees it: its time, or a
 * treadmill distance at its frozen belt (a belt event rewrites the alerts).
 * Null on a lap step and on a belt distance step with no belt: nothing after
 * it has a time.
 */
function runStepSeconds(s: RidePlanStep): number | null {
  if (s.run?.rule === "belt_distance") return s.run.belt ? s.estSeconds : null;
  return s.seconds;
}

/**
 * The push alerts of a running run (docs/plans/run-logger.md, step 6), as
 * `ridePushSchedule` makes them for a ride, with the target first: a step
 * change at each step's end and "1 min left" a minute before it. A strides
 * block (4.5) gets one alert at its start, with the whole block as the title,
 * and one at the end of its last work round; no "1 min left" inside it. Steps
 * are numbered as the step list numbers them (a block is one step). A belt
 * distance step ends where the timeline puts it at this moment, so a belt
 * event moves its alerts.
 */
export function runPushSchedule(plan: RidePlan, t: RideTimeline, now: number, opts: { brick?: boolean } = {}): RidePushPlan[] {
  const cur = t.current;
  if (t.status !== "running" || !cur || cur.endsAt === null) return [];
  const th = plan.thresholds;
  const steps = plan.steps;
  const n = steps.length;
  const rows = runRowOfStep(plan);
  const rowCount = rows.length ? rows[rows.length - 1] + 1 : 0;
  const blockOf = (i: number) => steps[i]?.run?.block ?? null;
  const lastWork = (i: number) => {
    const b = blockOf(i);
    return !!b && steps[i].step.type === "work" && !steps.slice(i + 1).some((p) => p.run?.block === b && p.step.type === "work");
  };
  // The step that just ended: a stride is "Strides", as the step list names the block; the recovery after it is its own step.
  const name = (i: number) => (blockOf(i) && steps[i].step.type === "work" ? "Strides" : runStepTitle(steps[i], th));
  const stepOf = (i: number) => `Step ${rows[i] + 1} of ${rowCount}`;
  // Active seconds at an alert's time: the run has no pause until then, as a pause rewrites the alerts.
  const brickEasyAt = (at: number) => !!opts.brick && t.activeSeconds + (at - now) / 1000 < BRICK_EASY_S;
  const target = (i: number, at: number) => runPushTarget(plan, steps[i], brickEasyAt(at));

  /** The alert of a step that starts at `at`; null for a step inside a block that is not its start or the end of its work. */
  const startAlert = (i: number, at: number): Pick<RidePushPlan, "title" | "body"> | null => {
    const prev = i - 1;
    const block = blockOf(i);
    const s = steps[i];
    if (block && blockOf(prev) !== block) {
      const work = steps.find((p) => p.run?.block === block && p.step.type === "work") ?? s;
      const easy = steps.find((p) => p.run?.block === block && p.step.type !== "work");
      const reps = `Strides ${work.round?.of ?? 1} × ${pushTime(work.seconds ?? work.estSeconds)}`;
      const between = easy ? `${pushTime(easy.seconds ?? easy.estSeconds)} easy between` : null;
      const tgt = runPushTarget(plan, work, brickEasyAt(at));
      return { title: [tgt, reps, between].filter(Boolean).join(" · "), body: `${stepOf(i)} · ${name(prev)} done` };
    }
    if (block && !lastWork(prev)) return null;
    const title = [target(i, at), runStepTitle(s, th), runPushLength(s)].filter(Boolean).join(" · ");
    return { title, body: `${stepOf(i)} · ${name(prev)} done` };
  };

  const out: RidePushPlan[] = [];
  let i = cur.index;
  let end = cur.endsAt;
  let length = cur.remainingSeconds ?? 0;
  for (;;) {
    const hasNext = i + 1 < n;
    if (!blockOf(i) && length > 60 && end - 60_000 > now) {
      let next = "last step";
      if (hasNext) {
        const b = blockOf(i + 1);
        const work = b ? (steps.find((p) => p.run?.block === b && p.step.type === "work") ?? steps[i + 1]) : null;
        const what = work ? `Strides ${work.round?.of ?? 1} × ${pushTime(work.seconds ?? work.estSeconds)}` : runStepTitle(steps[i + 1], th);
        const tgt = runPushTarget(plan, work ?? steps[i + 1], brickEasyAt(end));
        next = `next ${[tgt, what].filter(Boolean).join(" · ")}`;
      }
      out.push({ sendAt: end - 60_000, kind: "minute_left", title: `1 min left · ${next}`, body: `${stepOf(i)} · ${name(i)}`, stepIndex: i });
    }
    if (!hasNext) {
      out.push({ sendAt: end, kind: "done", title: "Run done", body: `${stepOf(i)} · ${name(i)} done`, stepIndex: i });
      break;
    }
    const alert = startAlert(i + 1, end);
    if (alert) out.push({ sendAt: end, kind: "step", ...alert, stepIndex: i + 1 });
    i++;
    const seconds = runStepSeconds(steps[i]);
    if (seconds === null) break;
    end += seconds * 1000;
    length = seconds;
  }
  return out;
}

/** The notification tag of a ride: a new alert replaces the one before. */
export const ridePushTag = (rideId: number) => `ride-${rideId}`;

/** Where tapping an alert goes: the bike or run exercise in ride or run mode (both open on `?ride=1`). */
export const ridePushUrl = (programId: number, programExerciseId: number) => `/programs/${programId}/workout/exercises/${programExerciseId}?ride=1`;
