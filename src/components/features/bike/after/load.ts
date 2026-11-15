/** Reads for the after-ride view (docs/plans/bike-sessions.md, 5.5). Server only: callers resolve the user. */

import { db } from "@/db";
import { garminActivities, plannedSessions, workoutSessions } from "@/db/schema";
import { getBikeNumbers } from "@/lib/bike-numbers";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import { sportOf } from "@/lib/garmin/analytics/sport";
import { getActivityDetail } from "@/lib/garmin/queries";
import { livePlannedSessions } from "@/lib/plan-live";
import { sessionCompliance, storedWorkout, thresholdValues } from "@/lib/session-compliance";
import { getStepResults } from "@/lib/step-results";
import { addDaysStr } from "@/lib/utils/planned-sessions";
import { matchSteps, powerMark, type FitLap, type PowerMark } from "@/lib/utils/step-match";
import { matchStepsOf, plannedRows } from "@/lib/utils/step-results";
import { flattenWorkout } from "@/lib/utils/workout-player";
import type { WorkoutStep } from "@/lib/utils/workout-steps";
import { and, eq, gte, lte } from "drizzle-orm";
import { ftpFromTwenty, ftpTestStepKey, minutesOf } from "./view";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type AfterRideRow = {
  key: string;
  type: WorkoutStep["type"];
  round: { index: number; of: number } | null;
  plannedSeconds: number | null;
  powerText: string | null;
  hrText: string | null;
  avgPower: number | null;
  normalizedPower: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  seconds: number | null;
  mark: PowerMark | null;
  hrOverCap: boolean;
  hrZoneSeconds: number | null;
};

export type RideChoice = { id: number; date: string; name: string; durationS: number; paired: boolean };

export type AfterRideData = {
  plannedSessionId: number;
  band: string | null;
  minutes: string | null;
  activity: { garminId: number; name: string; durationS: number | null; distanceM: number | null; np: number | null; avgHr: number | null; cadence: number | null };
  plan: { seconds: number; low: number | null; high: number | null }[];
  power: { t: (number | null)[]; w: (number | null)[] } | null;
  rows: AfterRideRow[];
  matchNote: string | null;
  rpe: number | null;
  watchRpe: number | null;
  carbs: { seconds: number; carbsG: number | null } | null;
  ftpTest: { avgPower: number; ftp: number; date: string } | null;
  choices: RideChoice[];
};

/** The after view of one planned session paired with a Garmin activity; null for any other session. */
export async function afterRideData(userId: string, plannedSessionId: number): Promise<AfterRideData | null> {
  if (!(await enduranceEnabledFor(userId)) || !(await garminAllowedFor(userId))) return null;
  const [planned] = await db
    .select({ id: plannedSessions.id, date: plannedSessions.date, workout: plannedSessions.workout })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, plannedSessionId), eq(plannedSessions.userId, userId), livePlannedSessions));
  if (!planned?.date) return null;
  const s = (await sessionCompliance(userId, planned.date, planned.date)).find((x) => x.id === plannedSessionId);
  if (!s || s.garminActivityId == null) return null;
  const [act] = await db.select({ garminId: garminActivities.garminActivityId }).from(garminActivities).where(and(eq(garminActivities.id, s.garminActivityId), eq(garminActivities.userId, userId)));
  if (!act) return null;
  const detail = await getActivityDetail(userId, act.garminId);
  if (!detail) return null;
  const sum = detail.summary as Record<string, unknown>;

  const [ws] = await db
    .select({ id: workoutSessions.id, rpe: workoutSessions.rpe })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.plannedSessionId, plannedSessionId), eq(workoutSessions.source, "garmin")));
  const results = ws ? await getStepResults(userId, { workoutSessionId: ws.id }) : null;

  const workout = storedWorkout(planned.workout, planned.id);
  let rows: AfterRideRow[] = [];
  let matchNote: string | null = null;
  let plan: AfterRideData["plan"] = [];
  let ftpTest: AfterRideData["ftpTest"] = null;
  if (workout) {
    const zones = workout.sport === "bike" ? (await getBikeNumbers(userId)).zones : null;
    const prows = plannedRows(results?.workout ?? workout, results?.anchors ?? (await thresholdValues(userId)), undefined, zones);
    const ranges = matchStepsOf(prows);
    matchNote = matchSteps(ranges, (detail.laps ?? []) as FitLap[], null).note;
    const byKey = new Map((results?.rows ?? []).map((r) => [r.key, r.result]));
    rows = prows.map((p, i) => {
      const r = byKey.get(p.key) ?? null;
      const hr = [p.target, p.secondary].find((t) => t?.unit === "bpm") ?? null;
      const power = [p.target, p.secondary].find((t) => t?.unit === "W") ?? null;
      const cap = ranges[i].hr?.high ?? null;
      return {
        key: p.key,
        type: p.type,
        round: p.round ? { index: p.round.index, of: p.round.of } : null,
        plannedSeconds: p.plannedSeconds,
        powerText: power?.text ?? null,
        hrText: hr?.text ?? null,
        avgPower: r?.value ?? null,
        normalizedPower: r?.normalizedPower ?? null,
        avgHeartRate: r?.avgHeartRate ?? null,
        maxHeartRate: r?.maxHeartRate ?? null,
        avgCadence: r?.avgCadence ?? null,
        seconds: r?.activeSeconds ?? null,
        mark: powerMark(r?.value ?? null, ranges[i].power),
        hrOverCap: cap != null && r?.avgHeartRate != null && r.avgHeartRate > cap,
        hrZoneSeconds: r?.hrZoneSeconds ?? null,
      };
    });
    plan = prows.map((p, i) => ({ seconds: p.plannedSeconds ?? 0, low: ranges[i].power?.low ?? null, high: ranges[i].power?.high ?? null }));
    const testKey = ftpTestStepKey(workout, flattenWorkout(workout).map((f) => ({ key: f.key, step: f.step as WorkoutStep })));
    const twenty = testKey ? rows.find((r) => r.key === testKey)?.avgPower : null;
    if (twenty) ftpTest = { avgPower: twenty, ftp: ftpFromTwenty(twenty), date: planned.date };
  }

  const durationS = num(sum.duration);
  const choices = await db
    .select({ id: garminActivities.id, start: garminActivities.startTimeLocal, type: garminActivities.activityType, data: garminActivities.data })
    .from(garminActivities)
    .where(
      and(
        eq(garminActivities.userId, userId),
        gte(garminActivities.startTimeLocal, new Date(`${addDaysStr(planned.date, -1)}T00:00:00Z`)),
        lte(garminActivities.startTimeLocal, new Date(`${addDaysStr(planned.date, 1)}T23:59:59Z`)),
      ),
    );

  return {
    plannedSessionId,
    band: s.band,
    minutes: minutesOf(s.done?.durationSeconds ?? null, s.planned.durationSeconds),
    activity: { garminId: act.garminId, name: detail.name, durationS, distanceM: num(sum.distance), np: num(sum.normPower), avgHr: num(sum.averageHR), cadence: num(sum.averageBikingCadenceInRevPerMinute) },
    plan,
    power: detail.streams.t && detail.streams.power ? { t: detail.streams.t, w: detail.streams.power } : null,
    rows,
    matchNote,
    rpe: ws?.rpe ?? null,
    watchRpe: num((detail.dto as Record<string, unknown> | null)?.directWorkoutRpe),
    carbs: s.sport === "bike" && (s.planned.durationSeconds ?? 0) >= 90 * 60 ? { seconds: durationS ?? s.planned.durationSeconds!, carbsG: detail.fuel?.carbsG ?? null } : null,
    ftpTest,
    choices: choices
      .filter((c) => sportOf(c.type) === s.sport)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((c) => {
        const d = (c.data ?? {}) as Record<string, unknown>;
        return {
          id: c.id,
          date: c.start.toISOString().slice(0, 10),
          name: typeof d.activityName === "string" ? d.activityName : c.type.replaceAll("_", " "),
          durationS: num(d.duration) ?? 0,
          paired: c.id === s.garminActivityId,
        };
      }),
  };
}
