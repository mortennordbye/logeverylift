/**
 * The step page of a done bike or run session (docs/plans/session-check.md,
 * decisions 7 and 8): every step of every ride or run of a logged workout,
 * judged by the session check's rule, and for a session done on the watch
 * alone the Garmin activity split into the planned steps.
 *
 * App rides read the same parts as `rideReport` and `runReport`: the frozen
 * plan, the logged steps by `rideStepLogs`, and the Garmin fill by
 * `rideGarminView` / `runGarminView`.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { garminActivities, programs, rideEvents, rides, workoutSessions } from "@/db/schema";
import { rideStepLogs } from "@/lib/bike-exercise-view";
import { garminAllowedFor } from "@/lib/garmin/access";
import { sportOf } from "@/lib/garmin/analytics/sport";
import { sampleDurations } from "@/lib/garmin/analytics/load";
import { loadActivity, modeOfActivity, rideGarminView } from "@/lib/ride-garmin";
import { runGarminView } from "@/lib/run-garmin";
import { oneSession } from "@/lib/session-answers";
import { thresholdValues, type SessionCompliance } from "@/lib/session-compliance";
import type { StepLog } from "@/lib/utils/ride-results";
import { sampleIndices, windowValues } from "@/lib/utils/ride-stream";
import { buildRidePlan, type RidePlan } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { runWindowValues } from "@/lib/utils/run-stream";
import { shortDay } from "@/lib/utils/seasons";
import { checkSteps, splitWatchOnly, type StepCheck } from "@/lib/utils/session-check";
import { flattenWorkout } from "@/lib/utils/workout-player";
import type { Workout } from "@/lib/utils/workout-steps";
import { and, asc, desc, eq } from "drizzle-orm";

/** Where the step numbers come from: a Garmin activity (with how it was split into the steps), or the app alone. */
export type CheckMatch =
  | { kind: "garmin"; name: string; split: "laps" | "time" | null; watchOnly: boolean }
  | { kind: "app" }
  /** Done on the watch, read without Garmin access: no name, no numbers. */
  | { kind: "watch" };

export type CheckPart = { key: string; sport: "bike" | "run"; name: string; match: CheckMatch; steps: StepCheck[] };

export type SessionCheckView = {
  /** "Bike tempo · Tue 24 Nov". */
  title: string;
  parts: CheckPart[];
};

const ENDED = new Set(["finished", "ended_early"]);

/** The name Garmin gave an activity ("Indoor Cycling"), else its type. */
async function activityName(userId: string, by: { garminActivityId: number }): Promise<string | null> {
  const [row] = await db
    .select({ name: garminActivities.data, type: garminActivities.activityType })
    .from(garminActivities)
    .where(and(eq(garminActivities.userId, userId), eq(garminActivities.garminActivityId, by.garminActivityId)));
  if (!row) return null;
  const name = (row.name as Record<string, unknown> | null)?.activityName;
  return typeof name === "string" && name.trim() ? name.trim() : row.type;
}

/** One ended ride or run of the app with its steps judged and its Garmin fill. */
async function ridePart(userId: string, ride: typeof rides.$inferSelect): Promise<CheckPart | null> {
  const plan = ride.plan as RidePlan;
  const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  const { logs, timeline } = await rideStepLogs(userId, {
    plan,
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime(), stepKey: e.stepKey })),
    serverNow: Date.now(),
    ride: { sessionId: ride.sessionId, heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  });
  if (!ENDED.has(timeline.status)) return null;
  const garmin = ride.sport === "run" ? await runGarminView(userId, ride.id) : await rideGarminView(userId, ride.id);
  const name = garmin.state === "filled" && garmin.garminActivityId !== null ? await activityName(userId, { garminActivityId: garmin.garminActivityId }) : null;
  return {
    key: `ride-${ride.id}`,
    sport: ride.sport,
    name: plan.name,
    match: name !== null ? { kind: "garmin", name, split: garmin.stream?.split ?? null, watchOnly: false } : { kind: "app" },
    steps: checkSteps(plan, logs),
  };
}

/**
 * The step page of a logged workout: each ride or run in it (the last one of
 * each exercise, as `rideOrRunReport` reads it), in the order they started.
 * Null when the workout is not the user's.
 */
export async function workoutSessionCheck(userId: string, workoutSessionId: number, name?: string | null): Promise<SessionCheckView | null> {
  const [session] = await db
    .select({ date: workoutSessions.date, programName: programs.name })
    .from(workoutSessions)
    // plan-read: includes deleted (history keeps the name of a deleted program)
    .leftJoin(programs, eq(programs.id, workoutSessions.programId))
    .where(and(eq(workoutSessions.id, workoutSessionId), eq(workoutSessions.userId, userId)));
  if (!session) return null;
  const all = await db
    .select()
    .from(rides)
    .where(and(eq(rides.userId, userId), eq(rides.sessionId, workoutSessionId)))
    .orderBy(desc(rides.startedAt), desc(rides.id));
  const seen = new Set<number>();
  // A ride of no exercise (one whose exercise is gone) stands alone.
  const latest = all.filter((r) => { const k = r.programExerciseId ?? -r.id; return seen.has(k) ? false : (seen.add(k), true); }).reverse();
  const parts = (await Promise.all(latest.map((r) => ridePart(userId, r)))).filter((p): p is CheckPart => p !== null);
  const title = name ?? session.programName ?? parts[0]?.name ?? "Session";
  return { title: `${title} · ${shortDay(session.date)}`, parts };
}

/** True when the workout holds a ride or run of the user, so History links its step page. */
export async function hasSessionCheck(userId: string, workoutSessionId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: rides.id })
    .from(rides)
    .where(and(eq(rides.userId, userId), eq(rides.sessionId, workoutSessionId)))
    .limit(1);
  return !!row;
}

const gmt = (v: unknown) => (typeof v === "string" ? Date.parse(`${v.replace(" ", "T")}Z`) : NaN);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A session done on the watch alone (decision 8): the program's steps of the
 * session's sport, planned with today's thresholds, and the matched Garmin
 * activity split into them by laps when there is one lap per step, else by
 * the planned step times. Each step's numbers come from its part of the
 * activity, as a Garmin fill reads them.
 */
async function watchOnlyPart(userId: string, garminRowId: number, workout: Workout): Promise<CheckPart | null> {
  // Garmin parts only with Garmin access (decision 5): a pick stays done after access is gone, so show its plan alone.
  if (!(await garminAllowedFor(userId))) {
    const ids = flattenWorkout(workout).map((_, i) => i + 1);
    const thresholds = await thresholdValues(userId);
    const plan = workout.sport === "run" ? buildRunPlan(workout, ids, thresholds, "outdoor", { surface: "road" }) : buildRidePlan(workout, ids, thresholds, "outdoor");
    return { key: `watch-${garminRowId}`, sport: workout.sport === "run" ? "run" : "bike", name: plan.name, match: { kind: "watch" }, steps: checkSteps(plan, {}) };
  }
  const [row] = await db
    .select({ garminActivityId: garminActivities.garminActivityId, typeKey: garminActivities.activityType, data: garminActivities.data })
    .from(garminActivities)
    .where(and(eq(garminActivities.id, garminRowId), eq(garminActivities.userId, userId)));
  if (!row) return null;
  const sport = workout.sport === "run" ? "run" : "bike";
  if (sportOf(row.typeKey) !== sport) return null;
  const data = (row.data ?? {}) as Record<string, unknown>;
  const startMs = gmt(data.startTimeGMT);
  const seconds = num(data.elapsedDuration) ?? num(data.duration) ?? 0;
  const mode = modeOfActivity(row.typeKey);
  const ids = flattenWorkout(workout).map((_, i) => i + 1);
  const thresholds = await thresholdValues(userId);
  const plan = sport === "run" ? buildRunPlan(workout, ids, thresholds, mode, { surface: "road" }) : buildRidePlan(workout, ids, thresholds, mode);
  const name = typeof data.activityName === "string" && data.activityName.trim() ? data.activityName.trim() : row.typeKey;
  const activity = Number.isFinite(startMs)
    ? await loadActivity(userId, { garminActivityId: row.garminActivityId, segment: 0, typeKey: row.typeKey, startMs, endMs: startMs + seconds * 1000, meters: num(data.distance) })
    : null;
  if (!activity) return { key: `garmin-${garminRowId}`, sport, name: plan.name, match: { kind: "garmin", name, split: null, watchOnly: true }, steps: checkSteps(plan, {}) };

  const split = splitWatchOnly(plan.steps.map((s) => ({ programSetId: s.programSetId, seconds: s.seconds ?? s.estSeconds })), activity.laps, activity.events, activity.t0Ms);
  const d = sampleDurations(activity.streams.t);
  const logs: Record<number, StepLog> = {};
  for (const w of split.windows) {
    const moving = Math.round(sampleIndices(activity.streams.t, w).reduce((a, i) => a + d[i], 0));
    if (moving <= 0) continue;
    const v = sport === "run" ? runWindowValues(activity.streams, w, mode, d) : windowValues(activity.streams, w, mode, d);
    logs[w.programSetId] = {
      status: "done",
      durationSeconds: moving,
      targetOffsetW: null,
      extendedSeconds: null,
      ...v,
      rpe: null,
      sources: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k]) => [k, "garmin" as const])),
    };
  }
  return { key: `garmin-${garminRowId}`, sport, name: plan.name, match: { kind: "garmin", name, split: split.method, watchOnly: true }, steps: checkSteps(plan, logs) };
}

/**
 * The step page of a planned session: its logged workout's rides and runs,
 * else the Garmin activity it was matched to (a pick, a Garmin match, or the
 * activity a workout with no ride took), split as on the watch alone.
 * Null when the session is not the user's; no parts when it is not done or
 * has nothing to show. `known` is the session as the caller already read it
 * for this user.
 */
export async function plannedSessionCheck(userId: string, plannedSessionId: number, known?: SessionCompliance): Promise<SessionCheckView | null> {
  const s = known?.id === plannedSessionId ? known : await oneSession(userId, plannedSessionId);
  if (!s) return null;
  const name = s.label ?? s.programName;
  const empty = { title: `${name ?? "Session"} · ${shortDay(s.date)}`, parts: [] };
  if (s.state !== "done") return empty;
  if (s.loggedSessionId !== null) {
    const logged = await workoutSessionCheck(userId, s.loggedSessionId, name);
    if (logged?.parts.length) return logged;
    // A workout with no ride ("Yes", MCP log_session, an app match): the Garmin activity of its day it took, split as on the watch.
  }
  // watchOnlyPart holds the Garmin gate: without access it shows the plan with no Garmin numbers.
  if (s.garminActivityId === null || (s.sport !== "bike" && s.sport !== "run")) return empty;
  const pw = s.programWorkouts.find((p) => p.sport === s.sport);
  if (!pw) return empty;
  const part = await watchOnlyPart(userId, s.garminActivityId, pw.workout);
  return { ...empty, parts: part ? [part] : [] };
}
