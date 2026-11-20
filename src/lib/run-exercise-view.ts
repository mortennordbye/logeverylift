/**
 * The data of the run exercise screen (docs/plans/run-logger.md, section 5
 * "Run exercise, ready", step 2): the run as `startRide` would freeze it now,
 * on a treadmill and outdoors on each surface, and the mode it opens in (R4).
 * Null when the exercise holds no steps to run, so the page keeps today's
 * set list.
 *
 * Not a Server Action: it takes a resolved userId from a Server Component.
 */

import { db } from "@/db";
import { garminActivities, rides, workoutSessions, type EndReason, type RideMode, type RideSport } from "@/db/schema";
import { getRide } from "@/lib/actions/rides";
import { recentRide } from "@/lib/bike-exercise-view";
import { getUserSettings } from "@/lib/user-settings";
import { rideTimeline } from "@/lib/utils/ride-timeline";
import { runKeptText } from "@/lib/utils/run-screen";
import { garminAllowedFor } from "@/lib/garmin/access";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { thresholdValues } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import type { RideChart } from "@/lib/utils/bike-ride-view";
import { toDateStr } from "@/lib/utils/cycle-position";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { RUN_MODE_NAME, defaultRunMode, needsThresholdPace, plannedRunNumbers, runChart, runStepRows, type RunNumbers, type RunStepRow } from "@/lib/utils/run-view";
import { parseWorkout, type WorkoutTest } from "@/lib/utils/workout-steps";
import { and, desc, eq, gt, sql } from "drizzle-orm";

export type RunModeView = { numbers: RunNumbers; chart: RideChart; rows: RunStepRow[] };

export type RunExerciseData = {
  defaultMode: RideMode;
  treadmill: RunModeView;
  /** Outdoors on each surface (R14): Trail or snow turns pace targets into heart rate. */
  road: RunModeView;
  trail: RunModeView;
  /** Threshold speed in m/s, and run LTHR. */
  thresholdPace: number | null;
  lthr: number | null;
  /** A step's pace is a share of the threshold pace: outdoors it needs one too. */
  paceSteps: boolean;
  /** The user's run of this exercise is running or paused: the screen offers Resume, not Start run. */
  liveRun: boolean;
  /** Another ride or run of the user is running (one per user, 4.3): its sport, where it opens, and its id ("End ride and start run" sends its queued taps first). */
  otherLive: { sport: RideSport; href: string; rideId: number } | null;
};

/** The mode a run's mode default looks back over (R4). */
const RECENT_DAYS = 28;

/**
 * The mode a run of this program exercise opens in (R4): its last run's
 * mode, else the mode of most of the user's runs in the last 4 weeks (the
 * app's runs, else Garmin's run activities for a user with Garmin), else the
 * month in the user's time zone.
 */
export async function defaultRunModeFor(userId: string, programExerciseId: number): Promise<RideMode> {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const [last, counts, today] = await Promise.all([
    db
      .select({ mode: rides.mode })
      .from(rides)
      .where(and(eq(rides.userId, userId), eq(rides.sport, "run"), eq(rides.programExerciseId, programExerciseId)))
      .orderBy(desc(rides.startedAt))
      .limit(1),
    db
      .select({ mode: rides.mode, n: sql<number>`count(*)::int` })
      .from(rides)
      .where(and(eq(rides.userId, userId), eq(rides.sport, "run"), gt(rides.startedAt, since)))
      .groupBy(rides.mode),
    userToday(userId),
  ]);
  const recent = { indoor: 0, outdoor: 0 };
  for (const c of counts) recent[c.mode] += c.n;
  if (!last[0] && recent.indoor + recent.outdoor === 0 && (await garminAllowedFor(userId))) {
    const types = await db
      .select({ type: garminActivities.activityType })
      .from(garminActivities)
      .where(and(eq(garminActivities.userId, userId), gt(garminActivities.startTimeLocal, since)));
    for (const { type } of types) if (sportOf(type) === "run") recent[isIndoor(type) ? "indoor" : "outdoor"]++;
  }
  return defaultRunMode({ lastMode: last[0]?.mode ?? null, recent, month: Number(toDateStr(today).slice(5, 7)) });
}

export async function runExerciseView(
  userId: string,
  programExerciseId: number,
  name: string,
  sets: (StepRow & { id: number })[],
  test: WorkoutTest | null = null,
): Promise<RunExerciseData | null> {
  // The order startRide reads the rows in, so each step keeps its program set.
  const rows = sets.filter((s) => s.stepKind != null).sort((a, b) => a.setNumber - b.setNumber || a.id - b.id);
  if (!rows.length) return null;
  const built = buildWorkout(rows, { sport: "run", name, test });
  const tree = "workout" in built ? parseWorkout(built.workout) : null;
  if (!tree?.ok) return null;

  // getRide settles the active ride first, so one whose last step ran out is not live.
  const [thresholds, defaultMode, active] = await Promise.all([thresholdValues(userId), defaultRunModeFor(userId, programExerciseId), getRide({})]);
  const ids = rows.map((r) => r.id);
  const view = (mode: RideMode, surface: "road" | "trail" = "road"): RunModeView => {
    const plan = buildRunPlan(tree.workout, ids, thresholds, mode, { surface });
    return { numbers: plannedRunNumbers(plan), chart: runChart(plan), rows: runStepRows(plan, surface) };
  };
  const live = active.success ? active.data : null;
  const liveRun = live?.ride.programExerciseId === programExerciseId;
  let otherLive: RunExerciseData["otherLive"] = null;
  if (live && !liveRun && live.ride.programExerciseId !== null) {
    const [s] = await db
      .select({ programId: workoutSessions.programId })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, live.ride.sessionId), eq(workoutSessions.userId, userId)));
    if (s?.programId != null) otherLive = { sport: live.ride.sport, href: `/programs/${s.programId}/workout/exercises/${live.ride.programExerciseId}?ride=1`, rideId: live.ride.id };
  }
  return {
    defaultMode,
    treadmill: view("indoor"),
    road: view("outdoor", "road"),
    trail: view("outdoor", "trail"),
    thresholdPace: thresholds.run_threshold_pace ?? null,
    lthr: thresholds.lthr_run ?? null,
    paceSteps: needsThresholdPace(tree.workout),
    liveRun,
    otherLive,
  };
}

// ── After the run ────────────────────────────────────────────────────────────

export type RunDoneData = {
  rideId: number;
  status: "finished" | "ended_early";
  /** "Done 17:12 · Treadmill", "Ended early 16:40 · Outdoor". */
  doneLine: string;
  /** "Steps 1 and 2 are saved". */
  kept: string;
  endReason: EndReason | null;
};

/**
 * The user's run of this program exercise that ended in the last 12 hours,
 * as its done screen shows it (section 5 "Run done / Run ended early"). The
 * exercise then shows this, not Start run, as the bike shows its summary.
 */
export async function runDoneView(userId: string, programExerciseId: number): Promise<RunDoneData | null> {
  const recent = await recentRide(userId, programExerciseId, "run");
  if (!recent || (recent.status !== "finished" && recent.status !== "ended_early")) return null;
  const [r, { timeZone }] = await Promise.all([getRide({ rideId: recent.id }), getUserSettings(userId)]);
  if (!r.success || !r.data) return null;
  const v = r.data;
  const status = v.ride.status === "ended_early" ? "ended_early" : "finished";
  const t = rideTimeline(v.plan, v.events, v.serverNow, { heartbeatAt: v.ride.heartbeatAt });
  const endedAt = v.ride.endedAt ?? t.endedAt;
  const at = endedAt
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone && { timeZone }) }).format(new Date(endedAt))
    : null;
  return {
    rideId: v.ride.id,
    status,
    doneLine: [`${status === "ended_early" ? "Ended early" : "Done"}${at ? ` ${at}` : ""}`, RUN_MODE_NAME[v.plan.mode]].join(" · "),
    kept: runKeptText(v.plan, t),
    endReason: v.ride.endReason,
  };
}
