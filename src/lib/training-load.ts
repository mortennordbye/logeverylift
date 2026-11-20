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
import { exercises, garminDailyMetrics, rides, workoutSessions, workoutSets } from "@/db/schema";
import { garminAllowedFor } from "@/lib/garmin/access";
import { strengthLoad } from "@/lib/garmin/analytics/load";
import { rampBand, type PmcPoint, type RampBand, type Track } from "@/lib/garmin/analytics/pmc";
import type { Sport } from "@/lib/garmin/analytics/sport";
import { thresholdValues } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { doneRideNumbers } from "@/lib/utils/ride-numbers";
import { doneRunNumbers } from "@/lib/utils/run-numbers";
import { loadAnchors } from "@/lib/utils/step-results";
import { appPmc, loadSource, sessionLoad, weightedRpe, type AppSessionLoad, type EnduranceSport, type LoadMethod } from "@/lib/utils/training-load";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

/** As the Garmin worker: a strength session counts at most this long. */
const MAX_STRENGTH_MINUTES = 180;

export type SessionLoadRow = AppSessionLoad & { reason?: "needs_rpe" | "no_time"; durationS: number };

const ENDURANCE: readonly string[] = ["swim", "bike", "run"];

/**
 * Load of each completed app or assistant session in [from, to], one row per
 * sport in the session (a session with a run and strength sets gives two).
 * Auto rows have no numbers and are left out.
 */
export async function appSessionLoads(userId: string, from: string | null, to: string | null, opts: { sessionIds?: number[] } = {}): Promise<SessionLoadRow[]> {
  if (opts.sessionIds && opts.sessionIds.length === 0) return [];
  const where = and(
    eq(workoutSessions.userId, userId),
    eq(workoutSessions.isCompleted, true),
    inArray(workoutSessions.source, ["app", "assistant"]),
    to ? lte(workoutSessions.date, to) : undefined,
    from ? gte(workoutSessions.date, from) : undefined,
    opts.sessionIds ? inArray(workoutSessions.id, opts.sessionIds) : undefined,
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
      plannedStep: workoutSets.plannedStep,
      stepStatus: workoutSets.stepStatus,
      avgPower: workoutSets.avgPower,
    })
    .from(workoutSessions)
    .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(where)
    .orderBy(asc(workoutSessions.date), asc(workoutSessions.id));
  if (!rows.length) return [];

  const moving = new Map<number, number>();
  // Swim moving time (docs/plans/one-program-model.md, 2): the logged steps that
  // are not rest steps, when every step that was swum has its time; otherwise the
  // logged time counts (review fix 3).
  const byStepSession = new Map<number, typeof rows>();
  for (const r of rows) if (r.plannedStep != null && r.discipline === "swim") byStepSession.set(r.id, [...(byStepSession.get(r.id) ?? []), r]);
  for (const [sessionId, list] of byStepSession) {
    const swum = list.filter((r) => (r.plannedStep as { step?: { type?: string } }).step?.type !== "rest");
    const complete = swum.every((r) => r.stepStatus === "skipped" || r.stepStatus === "not_done" || r.durationSeconds != null);
    if (complete) moving.set(sessionId, swum.reduce((a, r) => a + (r.durationSeconds ?? 0), 0));
  }
  const anchors = loadAnchors(await thresholdValues(userId));
  // The mode and surface of each session's run (docs/plans/run-logger.md, 4.9): the latest run of the session.
  const runIds = [...new Set(rows.filter((r) => r.discipline === "run" && r.plannedStep != null).map((r) => r.id))];
  const runOf = new Map<number, { mode: string; surface: string | null }>();
  if (runIds.length) {
    const list = await db
      .select({ sessionId: rides.sessionId, mode: rides.mode, surface: rides.surface })
      .from(rides)
      .where(and(eq(rides.userId, userId), eq(rides.sport, "run"), inArray(rides.sessionId, runIds)))
      .orderBy(desc(rides.startedAt));
    for (const r of list) if (!runOf.has(r.sessionId)) runOf.set(r.sessionId, r);
  }

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
      // Distance only from sets with a time, so a set with no time cannot raise the pace (review fix 2).
      const meters = g.reduce((a, s) => a + (s.durationSeconds && s.durationSeconds > 0 ? (s.distanceMeters ?? 0) : 0), 0);
      enduranceSeconds += seconds;
      // Time-weighted, so one short steep set does not grade-adjust the whole run (docs/plans/run-logger.md, 4.9).
      const inclineSeconds = g.reduce((a, s) => a + (s.durationSeconds ?? 0) * (s.inclinePercent ?? 0), 0);
      const incline = seconds > 0 ? Math.max(0, inclineSeconds / seconds) : 0;
      const rpe = weightedRpe(g);
      // A ride's steps with power on 90% of the time and an FTP: the estimated
      // power load (docs/plans/bike-ride-logger.md, 4.6). The FTP is the one
      // the steps were planned with.
      const power = sport === "bike" ? ridePowerLoad(g, anchors.ftp ?? null) : null;
      if (power !== null) {
        out.push({ id, date: first.date, sport: "bike", load: power, method: "bike_power", durationS: seconds });
        continue;
      }
      // A run's steps with distance on 90% of the time and a threshold pace: the
      // pace load per step from GAP (docs/plans/run-logger.md, 4.9).
      const runMode = sport === "run" ? (runOf.get(id) ?? null) : null;
      const pace = runMode ? runStepLoad(g, runMode, anchors.runThresholdSpeed ?? null) : null;
      if (pace !== null) {
        out.push({ id, date: first.date, sport: "run", load: pace, method: "run_gap", durationS: seconds });
        continue;
      }
      // "other" (cardio with no discipline) can only use session RPE.
      const l = sessionLoad(
        { sport: (ENDURANCE.includes(sport) ? sport : "bike") as EnduranceSport, seconds, meters, inclinePercent: incline, rpe, movingSeconds: sport === "swim" ? (moving.get(id) ?? null) : null },
        // A run from run mode with no pace load (Trail or snow, too little distance) takes the effort load, not the plain pace.
        sport === "other" ? {} : runMode ? { ...anchors, runThresholdSpeed: null } : anchors,
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

/** The estimated power load of a ride's logged steps, or null when the 4.6 power rule does not apply. */
function ridePowerLoad(
  sets: { plannedStep: unknown; stepStatus: string | null; durationSeconds: number | null; avgPower: number | null }[],
  currentFtp: number | null,
): number | null {
  const steps = sets.filter((s) => s.plannedStep != null && s.stepStatus !== "skipped" && s.stepStatus !== "not_done");
  if (!steps.length || !steps.some((s) => s.avgPower !== null)) return null;
  const planned = (steps[0].plannedStep as { thresholds?: { ftp?: number } }).thresholds?.ftp;
  const n = doneRideNumbers(
    steps.map((s) => ({ seconds: s.durationSeconds ?? 0, avgPower: s.avgPower })),
    { ftp: planned ?? currentFtp, rpe: null },
  );
  return n.load?.method === "power" ? n.load.value : null;
}

/**
 * The pace load of a run's logged steps (4.9), or null when it does not apply:
 * no run of the session, Trail or snow, distance on under 90% of the time, or
 * no threshold pace. Skipped steps count with their run time (4.7). The
 * threshold is the one the run was planned with.
 */
function runStepLoad(
  sets: { plannedStep: unknown; stepStatus: string | null; durationSeconds: number | null; distanceMeters: number | null; inclinePercent: number | null }[],
  run: { mode: string; surface: string | null } | null,
  currentThreshold: number | null,
): number | null {
  const steps = sets.filter((s) => s.plannedStep != null && s.stepStatus !== "not_done");
  if (!run || !steps.length) return null;
  const planned = (steps[0].plannedStep as { thresholds?: { run_threshold_pace?: number } }).thresholds?.run_threshold_pace;
  const treadmill = run.mode === "indoor";
  const n = doneRunNumbers(
    steps.map((s) => ({ seconds: s.durationSeconds ?? 0, meters: s.distanceMeters, inclinePct: treadmill ? s.inclinePercent : null, avgHr: null })),
    { thresholdSpeed: planned ?? currentThreshold, lthr: null, rpe: null, treadmill, surface: run.surface === "trail" ? "trail" : null },
  );
  return n.load?.method === "pace" ? n.load.value : null;
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
    return withRamp("garmin", all, from, [], {}, all[0]?.date ?? null);
  }

  const sessions = await appSessionLoads(userId, null, today);
  const methods: TrainingLoad["methods"] = {};
  for (const s of sessions) methods[s.method] = (methods[s.method] ?? 0) + 1;
  const start = sessions.length ? (sessions[0].date < from ? sessions[0].date : from) : from;
  const { days: pmc } = appPmc(sessions, start, today);
  const noLoad = sessions.filter((s) => s.load === null && s.date >= from).map((s) => ({ id: s.id, date: s.date, sport: s.sport, reason: s.reason ?? null }));
  return withRamp("app", pmc.map((d) => ({ date: d.date, calibrating: d.calibrating, tracks: d.tracks })), from, noLoad, methods, sessions[0]?.date ?? null);
}

/** The ramp needs a week of data since the first day with any: null before that (review fix 4). */
function withRamp(source: TrainingLoad["source"], all: LoadDayView[], from: string, noLoad: TrainingLoad["noLoad"], methods: TrainingLoad["methods"], firstDay: string | null): TrainingLoad {
  const last = all.at(-1);
  const weekAgo = all.length >= 8 ? all[all.length - 8] : null;
  const enough = firstDay !== null && weekAgo !== null && weekAgo.date >= firstDay;
  if (!enough) return { source, days: all.filter((d) => d.date >= from), ramp: null, rampBand: null, noLoad, methods };
  const ramp = last && weekAgo ? last.tracks.total.ctl - weekAgo.tracks.total.ctl : null;
  return { source, days: all.filter((d) => d.date >= from), ramp, rampBand: ramp === null ? null : rampBand(ramp), noLoad, methods };
}
