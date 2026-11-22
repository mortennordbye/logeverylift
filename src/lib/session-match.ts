/**
 * The match of one planned session (docs/plans/session-check.md, decisions 4
 * to 6): the program, how it was logged, the Garmin activity it is matched to
 * and how that filled the steps, or that day's activities to pick from.
 *
 * - A ride or run the app logged and Garmin filled: the activity of the
 *   ride's standing fill (`ride_garmin_fills`), with its split.
 * - Else a workout the app logged (link or app): the activity of that sport
 *   and day it took in `sessionCompliance`.
 * - A pick or a Garmin pair: that activity, as `sessionCompliance` gives it.
 *
 * Garmin parts only where `garminAllowedFor` is true. Every read filters by
 * the user. Plain server code: callers resolve the user.
 */

import { db } from "@/db";
import { garminActivities, plannedSessions, rideGarminFills, rides, trainingCycles, workoutSessions } from "@/db/schema";
import { garminAllowedFor } from "@/lib/garmin/access";
import { sportOf } from "@/lib/garmin/analytics/sport";
import { liveCycles, livePlannedSessions } from "@/lib/plan-live";
import type { RideFillPrevious } from "@/lib/ride-garmin";
import { oneSession } from "@/lib/session-answers";
import { sessionCompliance, type SessionCompliance } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { loggedOf, type MatchActivity, type SessionMatch } from "@/lib/utils/session-match";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";

type ActivityRow = { id: number; activityId: number; start: Date; type: string; data: unknown };

const activityCols = {
  id: garminActivities.id,
  activityId: garminActivities.garminActivityId,
  start: garminActivities.startTimeLocal,
  type: garminActivities.activityType,
  data: garminActivities.data,
};

function toActivity(r: ActivityRow): MatchActivity {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return {
    id: r.id,
    activityId: r.activityId,
    name: typeof d.activityName === "string" ? d.activityName : r.type.replaceAll("_", " "),
    startTime: r.start.toISOString(),
    durationSeconds: num(d.duration),
    distanceMeters: num(d.distance),
  };
}

/** The ride's standing Garmin fill: Garmin's activity id and the split it used. */
async function standingFill(userId: string, rideIds: number[]) {
  if (!rideIds.length) return null;
  const [f] = await db
    .select({ activityId: rideGarminFills.garminActivityId, previous: rideGarminFills.previous })
    .from(rideGarminFills)
    .where(and(eq(rideGarminFills.userId, userId), inArray(rideGarminFills.rideId, rideIds), eq(rideGarminFills.declined, false)))
    .orderBy(asc(rideGarminFills.id))
    .limit(1);
  if (!f) return null;
  const split = (f.previous as Partial<RideFillPrevious> | null)?.split;
  return { activityId: f.activityId, fill: split === "laps" || split === "time" ? split : null };
}

/**
 * The match of one of the user's planned sessions; null when it is not theirs
 * or not live. What the caller already read for this user is passed on, so it
 * is not read again: `known` (the session), `garminOn` and `today`.
 */
export async function sessionMatch(
  userId: string,
  plannedSessionId: number,
  ctx: { known?: SessionCompliance; garminOn?: boolean; today?: string } = {},
): Promise<SessionMatch | null> {
  const s = ctx.known?.id === plannedSessionId ? ctx.known : await oneSession(userId, plannedSessionId);
  if (!s) return null;
  const garminOn = ctx.garminOn ?? (await garminAllowedFor(userId));

  const [cycle] = await db
    .select({ name: trainingCycles.name })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, s.cycleId), eq(trainingCycles.userId, userId), liveCycles));
  const program = s.programId != null && s.programName ? { id: s.programId, name: s.programName, cycleName: cycle?.name ?? null } : null;

  // The rides of the logged workout, this session's sport first.
  const rideRows =
    s.loggedSessionId != null
      ? await db
          .select({ id: rides.id, sport: rides.sport, status: rides.status })
          .from(rides)
          .where(and(eq(rides.userId, userId), eq(rides.sessionId, s.loggedSessionId)))
          .orderBy(asc(rides.id))
      : [];
  const logged = loggedOf(s.matchedBy, rideRows.map((r) => r.sport), s.sport);

  let garmin: SessionMatch["garmin"] = null;
  if (garminOn) {
    const ofSport = rideRows.filter((r) => r.sport === s.sport);
    const fill = await standingFill(userId, (ofSport.length ? ofSport : rideRows).map((r) => r.id));
    if (fill) {
      const [a] = await db
        .select(activityCols)
        .from(garminActivities)
        .where(and(eq(garminActivities.userId, userId), eq(garminActivities.garminActivityId, fill.activityId)));
      if (a) garmin = { ...toActivity(a), fill: fill.fill };
    }
    // A ride or run with no standing fill names none: its own summary offers Pick or Fill from Garmin.
    if (!garmin && s.garminActivityId != null && logged !== "app_ride" && logged !== "app_run") {
      const [a] = await db
        .select(activityCols)
        .from(garminActivities)
        .where(and(eq(garminActivities.userId, userId), eq(garminActivities.id, s.garminActivityId)));
      if (a) garmin = { ...toActivity(a), fill: null };
    }
  }

  // Pick: a session of today or earlier, not skipped, not logged in the app (its ride has its own Pick);
  // with nothing matched, or a watch match to change (the pick op stores a new one either way).
  const today = ctx.today ?? toDateStr(await userToday(userId));
  const canPick = garminOn && s.sport != null && s.date <= today && s.status !== "skipped" && (logged == null || logged === "watch");
  let candidates: MatchActivity[] = [];
  if (garminOn && s.sport != null && s.date <= today && (garmin == null || canPick)) {
    const rows = await db
      .select(activityCols)
      .from(garminActivities)
      .where(
        and(
          eq(garminActivities.userId, userId),
          gte(garminActivities.startTimeLocal, new Date(`${s.date}T00:00:00Z`)),
          lte(garminActivities.startTimeLocal, new Date(`${s.date}T23:59:59Z`)),
        ),
      )
      .orderBy(asc(garminActivities.startTimeLocal), asc(garminActivities.id));
    const ofSport = rows.filter((r) => sportOf(r.type) === s.sport);
    // The pick op refuses an activity another session has picked.
    const pickedElsewhere = ofSport.length
      ? await db
          .select({ id: plannedSessions.garminActivityId })
          .from(plannedSessions)
          .where(
            and(
              eq(plannedSessions.userId, userId),
              inArray(plannedSessions.garminActivityId, ofSport.map((r) => r.id)),
              ne(plannedSessions.id, s.id),
              livePlannedSessions,
            ),
          )
      : [];
    const taken = new Set(pickedElsewhere.map((p) => p.id));
    candidates = ofSport.filter((r) => !taken.has(r.id)).map(toActivity);
  }

  // As plannedSessionCheck (src/lib/session-check.ts) reads it: an ended ride or run of the workout,
  // else (Garmin on) the matched activity of the session's sport, split into the program's steps of that sport.
  let hasSteps = false;
  if (s.state === "done" && (s.sport === "bike" || s.sport === "run")) {
    hasSteps = rideRows.some((r) => r.status === "finished" || r.status === "ended_early");
    if (!hasSteps && garminOn && s.garminActivityId != null && s.programWorkouts.some((p) => p.sport === s.sport)) {
      const [a] = await db
        .select({ type: garminActivities.activityType })
        .from(garminActivities)
        .where(and(eq(garminActivities.userId, userId), eq(garminActivities.id, s.garminActivityId)));
      hasSteps = !!a && sportOf(a.type) === s.sport;
    }
  }

  return {
    plannedSessionId: s.id,
    date: s.date,
    sport: s.sport,
    state: s.state,
    matchedBy: s.matchedBy,
    program,
    logged,
    garmin,
    candidates,
    canPick,
    hasSteps,
  };
}

/**
 * The match of the planned session a completed workout of the user counts
 * for (its link, else the session of its day the app matched it to), read
 * with one compliance read, and whether Garmin is on. Null when none or when
 * the workout is still open.
 */
export async function workoutSessionMatch(userId: string, workoutSessionId: number): Promise<{ match: SessionMatch; garminOn: boolean } | null> {
  const [w] = await db
    .select({ plannedSessionId: workoutSessions.plannedSessionId, date: workoutSessions.date, intendedDate: workoutSessions.intendedDate })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, workoutSessionId), eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true)));
  if (!w) return null;
  let s: SessionCompliance | null;
  if (w.plannedSessionId != null) s = await oneSession(userId, w.plannedSessionId);
  else {
    const day = w.intendedDate ?? w.date;
    s = (await sessionCompliance(userId, day, day)).find((x) => x.loggedSessionId === workoutSessionId) ?? null;
  }
  if (!s) return null;
  const garminOn = await garminAllowedFor(userId);
  const match = await sessionMatch(userId, s.id, { known: s, garminOn });
  return match ? { match, garminOn } : null;
}
