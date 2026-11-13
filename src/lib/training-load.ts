/**
 * Training load from what was logged in the app, and the one reader of
 * fitness, fatigue and form (package D1, docs/plans/endurance-app.md,
 * section 6). The models are pure, in src/lib/utils/training-load.ts.
 *
 * A user with Garmin data reads the Garmin series, which also holds the app
 * endurance sessions Garmin did not record (src/lib/garmin/analytics/daily.ts).
 * A user without reads the series computed here. The two are never added.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { exercises, garminDailyMetrics, workoutSessions, workoutSets, workoutStepResults } from "@/db/schema";
import { garminAllowedFor } from "@/lib/garmin/access";
import { strengthLoad } from "@/lib/garmin/analytics/load";
import { rampBand, type PmcPoint, type RampBand, type Track } from "@/lib/garmin/analytics/pmc";
import type { Sport } from "@/lib/garmin/analytics/sport";
import { thresholdValues } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { loadAnchors } from "@/lib/utils/step-results";
import { appPmc, loadSource, sessionLoad, weightedRpe, type AppSessionLoad, type EnduranceSport, type LoadMethod } from "@/lib/utils/training-load";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

/** As the Garmin worker: a strength session counts at most this long. */
const MAX_STRENGTH_MINUTES = 180;

export type SessionLoadRow = AppSessionLoad & { reason?: "needs_rpe" | "no_time"; durationS: number };

const ENDURANCE: readonly string[] = ["swim", "bike", "run"];

/**
 * Load of each completed app or assistant session in [from, to], one row per
 * sport in the session (a session with a run and strength sets gives two).
 * Auto rows have no numbers and are left out.
 */
export async function appSessionLoads(userId: string, from: string | null, to: string): Promise<SessionLoadRow[]> {
  const where = and(
    eq(workoutSessions.userId, userId),
    eq(workoutSessions.isCompleted, true),
    inArray(workoutSessions.source, ["app", "assistant"]),
    lte(workoutSessions.date, to),
    from ? gte(workoutSessions.date, from) : undefined,
  );
  const rows = await db
    .select({
      id: workoutSessions.id,
      date: workoutSessions.date,
      start: workoutSessions.startTime,
      end: workoutSessions.endTime,
      feeling: workoutSessions.feeling,
      category: exercises.category,
      discipline: exercises.discipline,
      setType: workoutSets.setType,
      durationSeconds: workoutSets.durationSeconds,
      distanceMeters: workoutSets.distanceMeters,
      inclinePercent: workoutSets.inclinePercent,
      rpe: workoutSets.rpe,
    })
    .from(workoutSessions)
    .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(where)
    .orderBy(asc(workoutSessions.date), asc(workoutSessions.id));
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r) => r.id))];
  const moving = new Map<number, number>();
  const results = await db
    .select({ sessionId: workoutStepResults.workoutSessionId, steps: workoutStepResults.steps, workout: workoutStepResults.workout })
    .from(workoutStepResults)
    .where(and(eq(workoutStepResults.userId, userId), inArray(workoutStepResults.workoutSessionId, ids)));
  for (const r of results) {
    const restKeys = restStepKeys(r.workout);
    const steps = (r.steps as { key: string; activeSeconds?: number }[]) ?? [];
    moving.set(r.sessionId, steps.reduce((a, s) => a + (restKeys.has(s.key.split("#")[0]) ? 0 : (s.activeSeconds ?? 0)), 0));
  }
  const anchors = loadAnchors(await thresholdValues(userId));

  const bySession = new Map<number, typeof rows>();
  for (const r of rows) bySession.set(r.id, [...(bySession.get(r.id) ?? []), r]);
  const out: SessionLoadRow[] = [];
  for (const [id, sets] of bySession) {
    const first = sets[0];
    let enduranceSeconds = 0;
    const groups = new Map<string, typeof rows>();
    for (const s of sets) {
      const sport = s.discipline ?? (s.category === "cardio" ? "other" : s.category === "strength" ? "strength" : null);
      if (!sport) continue;
      groups.set(sport, [...(groups.get(sport) ?? []), s]);
    }
    for (const [sport, g] of groups) {
      if (sport === "strength") continue;
      const seconds = g.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);
      const meters = g.reduce((a, s) => a + (s.distanceMeters ?? 0), 0);
      enduranceSeconds += seconds;
      const incline = Math.max(0, ...g.map((s) => s.inclinePercent ?? 0));
      const rpe = weightedRpe(g);
      // "other" (cardio with no discipline) can only use session RPE.
      const l = sessionLoad(
        { sport: (ENDURANCE.includes(sport) ? sport : "bike") as EnduranceSport, seconds, meters, inclinePercent: incline, rpe, movingSeconds: sport === "swim" ? (moving.get(id) ?? null) : null },
        sport === "other" ? {} : anchors,
      );
      out.push({ id, date: first.date, sport: sport as Sport, load: l.load, method: l.method, ...(l.reason && { reason: l.reason }), durationS: seconds });
    }
    const strength = groups.get("strength");
    if (strength && first.end) {
      const wall = (first.end.getTime() - first.start.getTime()) / 60_000;
      const minutes = Math.min(MAX_STRENGTH_MINUTES, Math.max(0, wall - enduranceSeconds / 60));
      const l = strengthLoad(minutes, strength.filter((s) => s.setType === "working").map((s) => s.rpe), first.feeling);
      out.push({ id, date: first.date, sport: "strength", load: l?.load ?? null, method: l ? "strength_srpe" : "none", ...(!l && { reason: "no_time" as const }), durationS: Math.round(minutes * 60) });
    }
  }
  return out;
}

/** Ids of the rest steps of a stored workout (top level and inside repeats). */
function restStepKeys(workout: unknown): Set<string> {
  const keys = new Set<string>();
  const w = workout as { steps?: { id?: string; type: string; steps?: { id?: string; type: string }[] }[] } | null;
  for (const n of w?.steps ?? []) {
    if (n.type === "rest" && n.id) keys.add(n.id);
    for (const s of n.steps ?? []) if (s.type === "rest" && s.id) keys.add(s.id);
  }
  return keys;
}

export type LoadDayView = { date: string; calibrating: boolean; tracks: Record<Track, PmcPoint> };

export type TrainingLoad = {
  source: "garmin" | "app";
  days: LoadDayView[];
  /** CTL today minus CTL 7 days ago, total; null in the first week. */
  ramp: number | null;
  rampBand: RampBand | null;
  /** App source only: sessions that got no load, and why. */
  noLoad: { id: number; date: string; sport: Sport; reason: "needs_rpe" | "no_time" | null }[];
  methods: Partial<Record<LoadMethod | "strength_srpe", number>>;
};

/** Fitness, fatigue and form for the last `days` days, from one source (decision 16). */
export async function getTrainingLoad(userId: string, days = 90): Promise<TrainingLoad> {
  const today = toDateStr(await userToday(userId));
  const from = addDaysStr(today, -(days - 1));
  const garminAllowed = await garminAllowedFor(userId);
  let garminDays = 0;
  if (garminAllowed) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId));
    garminDays = c?.n ?? 0;
  }
  if (loadSource({ garminAllowed, garminDays }) === "garmin") {
    const rows = await db
      .select({
        day: garminDailyMetrics.day,
        pmc: sql<Record<Track, PmcPoint>>`${garminDailyMetrics.metrics}->'pmc'`,
        calibrating: sql<boolean>`(${garminDailyMetrics.metrics}->>'calibrating')::boolean`,
      })
      .from(garminDailyMetrics)
      .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, addDaysStr(from, -7)), lte(garminDailyMetrics.day, today)))
      .orderBy(asc(garminDailyMetrics.day));
    const all = rows.map((r) => ({ date: r.day, calibrating: Boolean(r.calibrating), tracks: r.pmc }));
    return withRamp("garmin", all, from, [], {});
  }

  const sessions = await appSessionLoads(userId, null, today);
  const methods: TrainingLoad["methods"] = {};
  for (const s of sessions) methods[s.method] = (methods[s.method] ?? 0) + 1;
  const start = sessions.length ? (sessions[0].date < from ? sessions[0].date : from) : from;
  const { days: pmc } = appPmc(sessions, start, today);
  const noLoad = sessions.filter((s) => s.load === null && s.date >= from).map((s) => ({ id: s.id, date: s.date, sport: s.sport, reason: s.reason ?? null }));
  return withRamp("app", pmc.map((d) => ({ date: d.date, calibrating: d.calibrating, tracks: d.tracks })), from, noLoad, methods);
}

function withRamp(source: TrainingLoad["source"], all: LoadDayView[], from: string, noLoad: TrainingLoad["noLoad"], methods: TrainingLoad["methods"]): TrainingLoad {
  const last = all.at(-1);
  const weekAgo = all.length >= 8 ? all[all.length - 8] : null;
  const ramp = last && weekAgo ? last.tracks.total.ctl - weekAgo.tracks.total.ctl : null;
  return { source, days: all.filter((d) => d.date >= from), ramp, rampBand: ramp === null ? null : rampBand(ramp), noLoad, methods };
}
