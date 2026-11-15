/**
 * Stored pairs of planned sessions and Garmin activities (docs/plans/bike-sessions.md, 5.5, D4).
 *
 * A pair is one `workout_sessions` row with source "garmin", linked to the
 * planned session and the activity, plus its step results when the session
 * has a structured workout and the FIT file is parsed. The worker computes
 * the pairs every tick and brings the stored rows in line; a pick or unpick
 * replaces the row at once.
 */

import { db } from "@/db";
import { garminActivities, garminActivityStreams, plannedSessions, workoutSessions, workoutStepResults } from "@/db/schema";
import { getBikeNumbers } from "@/lib/bike-numbers";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import { livePlannedSessions } from "@/lib/plan-live";
import type { Tx } from "@/lib/plan-revisions";
import { garminPairsToStore, storedWorkout, thresholdValues } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/planned-sessions";
import { matchSteps, type FitLap, type RideStream } from "@/lib/utils/step-match";
import { matchStepsOf, plannedRows, resultsFromMatch } from "@/lib/utils/step-results";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

type Executor = typeof db | Tx;

/** Days back the worker checks each tick. The first run checks the whole history. */
export const PAIRING_DAYS = 90;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

type Activity = { id: number; garminActivityId: number; startTimeLocal: Date; data: unknown };

/** The activity's start as a real instant (Garmin's GMT start when it has one), its end and its local day. */
function activityTimes(a: Activity): { start: Date; end: Date; date: string } {
  const d = (a.data ?? {}) as Record<string, unknown>;
  const gmt = typeof d.startTimeGMT === "string" ? Date.parse(`${d.startTimeGMT.replace(" ", "T")}Z`) : NaN;
  const start = Number.isFinite(gmt) ? new Date(gmt) : a.startTimeLocal;
  const seconds = num(d.duration) ?? 0;
  return { start, end: new Date(start.getTime() + Math.round(seconds) * 1000), date: a.startTimeLocal.toISOString().slice(0, 10) };
}

const activitySelect = { id: garminActivities.id, garminActivityId: garminActivities.garminActivityId, startTimeLocal: garminActivities.startTimeLocal, data: garminActivities.data };

/** Step results of a planned workout against the activity's FIT laps and streams. Nothing when the file is not parsed yet. */
async function insertResults(ex: Executor, userId: string, sessionId: number, planned: { id: number; workout: unknown }, act: Activity): Promise<void> {
  const workout = storedWorkout(planned.workout, planned.id);
  if (!workout) return;
  const [fit] = await ex
    .select({ laps: garminActivityStreams.laps, streams: garminActivityStreams.streams })
    .from(garminActivityStreams)
    .where(and(eq(garminActivityStreams.userId, userId), eq(garminActivityStreams.garminActivityId, act.garminActivityId)));
  if (!fit) return;
  const anchors = await thresholdValues(userId);
  const zones = workout.sport === "bike" ? (await getBikeNumbers(userId)).zones : null;
  const rows = plannedRows(workout, anchors, undefined, zones);
  const match = matchSteps(matchStepsOf(rows), (fit.laps ?? []) as FitLap[], (fit.streams ?? {}) as RideStream);
  const t = activityTimes(act);
  await ex
    .insert(workoutStepResults)
    .values({
      userId,
      workoutSessionId: sessionId,
      plannedSessionId: planned.id,
      source: "garmin",
      workout,
      anchors,
      steps: resultsFromMatch(match),
      startedAt: t.start,
      finishedAt: t.end,
      wroteSession: true,
    })
    .onConflictDoNothing();
}

/** Write the pair of one planned session; a concurrent writer that got there first wins. */
async function insertPair(ex: Executor, userId: string, plannedId: number, activityId: number): Promise<void> {
  const [planned] = await ex
    .select({ id: plannedSessions.id, programId: plannedSessions.programId, workout: plannedSessions.workout })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, plannedId), eq(plannedSessions.userId, userId), livePlannedSessions));
  const [act] = await ex.select(activitySelect).from(garminActivities).where(and(eq(garminActivities.id, activityId), eq(garminActivities.userId, userId)));
  if (!planned || !act) return;
  const t = activityTimes(act);
  const [row] = await ex
    .insert(workoutSessions)
    .values({
      userId,
      programId: planned.programId,
      date: t.date,
      startTime: t.start,
      endTime: t.end,
      isCompleted: true,
      source: "garmin",
      plannedSessionId: planned.id,
      garminActivityId: act.id,
    })
    .onConflictDoNothing()
    .returning({ id: workoutSessions.id });
  if (row) await insertResults(ex, userId, row.id, planned, act);
}

/**
 * Replace the stored pair of one planned session (a pick, or null for "None
 * of these"), inside the caller's transaction. Frees the activity from any
 * other session's pair; the worker pairs that session again.
 */
export async function replacePair(tx: Tx, userId: string, plannedId: number, activityId: number | null): Promise<void> {
  await tx
    .delete(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.source, "garmin"),
        activityId != null ? or(eq(workoutSessions.plannedSessionId, plannedId), eq(workoutSessions.garminActivityId, activityId)) : eq(workoutSessions.plannedSessionId, plannedId),
      ),
    );
  if (activityId != null) await insertPair(tx, userId, plannedId, activityId);
}

/** Bring the stored pairs in line with the computed ones. Called once per worker tick. */
export async function storePairings(userId: string, now: Date): Promise<void> {
  void now;
  if (!(await enduranceEnabledFor(userId)) || !(await garminAllowedFor(userId))) return;
  const today = toDateStr(await userToday(userId));
  const existing = await db
    .select({
      id: workoutSessions.id,
      date: workoutSessions.date,
      plannedSessionId: workoutSessions.plannedSessionId,
      garminActivityId: workoutSessions.garminActivityId,
      resultId: workoutStepResults.id,
    })
    .from(workoutSessions)
    .leftJoin(workoutStepResults, eq(workoutStepResults.workoutSessionId, workoutSessions.id))
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.source, "garmin")));
  const from = existing.length ? addDaysStr(today, -PAIRING_DAYS) : "2000-01-01";
  const { pairs, rowIds } = await garminPairsToStore(userId, from, today);

  // A pair is stale when its session lost its pair, or got another one. Older sessions are left alone.
  const stale = existing.filter((e) => {
    if (e.plannedSessionId == null) return true;
    const want = pairs.get(e.plannedSessionId);
    if (want !== undefined) return want !== e.garminActivityId;
    return rowIds.has(e.plannedSessionId) || e.date >= from;
  });
  if (stale.length) await db.delete(workoutSessions).where(inArray(workoutSessions.id, stale.map((e) => e.id)));
  const kept = new Map(existing.filter((e) => !stale.includes(e)).map((e) => [e.plannedSessionId!, e]));

  const fill: { sessionId: number; plannedId: number; activityId: number }[] = [];
  for (const [plannedId, activityId] of pairs) {
    const e = kept.get(plannedId);
    if (!e) await insertPair(db, userId, plannedId, activityId);
    else if (e.resultId == null) fill.push({ sessionId: e.id, plannedId, activityId });
  }
  if (!fill.length) return;
  // The FIT file can arrive after the pair: add the step results then.
  const planned = await db
    .select({ id: plannedSessions.id, workout: plannedSessions.workout })
    .from(plannedSessions)
    .where(and(inArray(plannedSessions.id, fill.map((f) => f.plannedId)), isNotNull(plannedSessions.workout), livePlannedSessions));
  const withWorkout = fill.filter((f) => planned.some((p) => p.id === f.plannedId));
  if (!withWorkout.length) return;
  const acts = await db.select(activitySelect).from(garminActivities).where(inArray(garminActivities.id, withWorkout.map((f) => f.activityId)));
  for (const f of withWorkout) {
    const act = acts.find((a) => a.id === f.activityId);
    if (act) await insertResults(db, userId, f.sessionId, planned.find((p) => p.id === f.plannedId)!, act);
  }
}
