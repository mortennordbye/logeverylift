/**
 * Training limits on an assistant's plan writes (docs/plans/ai-coach.md, 2.4;
 * decisions D3, D4, T4). Server code that reads what the pure rules in
 * src/lib/utils/training-limits.ts need: the athlete's Garmin runs, and the
 * plan before and after a write. Only assistant writes reach it: a user's own
 * edit in the app is never checked (D4).
 *
 * Who is checked: users with the endurance switch on. The long-run cap also
 * needs Garmin data (admin only, for licence reasons); without it, the cap is
 * not checked and the tool result says so. Hard sessions per week run from
 * the plan alone.
 */

import { db } from "@/db";
import {
  athleteProfiles,
  exercises,
  garminActivities,
  garminDailyMetrics,
  garminActivityMetrics,
  garminConnections,
  plannedSessions,
  programExercises,
  users,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workoutSets,
  workouts,
} from "@/db/schema";
import type { StrengthGoal } from "@/db/schema/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { liveCycles, livePlannedSessions, liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import type { PlanWriteSession, Tx } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { cycleLoad, scaledDistance, scaledDuration } from "@/lib/utils/periodization";
import {
  LIMIT_RULES,
  LONG_RUN_WINDOW_DAYS,
  TEMPLATE_MONDAY,
  hardAfterLowReadiness,
  hardSessionsPerWeek,
  heavyLegConflicts,
  heavyLegsBeforeKey,
  isHeavyLegSet,
  isStrengthSet,
  readinessFlag,
  strengthPerWeek,
  type PlacedCycle,
  type PlacedGroup,
  type PlacedSession,
  type ReadinessFlag,
  type WeekShare,
  type RampStart,
  programSteps,
  weeklyLoadRamp,
  weeklyRamps,
  isHardSession,
  longRunCap,
  longestRuns,
  plannedRun,
  remainingAfterOverride,
  type BrokenLimit,
  type LimitCheck,
  type LimitNotChecked,
  type LimitRule,
  type HeavyLegsPair,
  type PastRun,
  type PlannedRun,
  type ReadinessDay,
  type RunHistory,
  type WeekSession,
} from "@/lib/utils/training-limits";
import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

type Executor = typeof db | Tx;

/**
 * A dated session runs a program or its own workout (docs/plans/workouts-and-compliance.md,
 * 4.2). A workout session is hard by isHardWorkout, as a program session is by
 * isHardSession; the user's current thresholds resolve absolute targets.
 */
async function workoutWeekSession(ex: Executor, userId: string) {
  const { athleteThresholds } = await import("@/db/schema");
  const { currentThresholds } = await import("@/lib/utils/thresholds");
  const { isHardWorkout, parseWorkout } = await import("@/lib/utils/workout-steps");
  const rows = await ex.select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, userId), isNull(athleteThresholds.deletedAt)));
  const values = Object.fromEntries(Object.entries(currentThresholds(rows)).map(([k, r]) => [k, r!.value]));
  return (json: unknown): boolean => {
    const p = parseWorkout(json);
    return p.ok ? isHardWorkout(p.workout, values) : false;
  };
}

/** What a user's limits can run on, read once per tool call. */
export type LimitContext = {
  endurance: boolean;
  /** The 30-day run history, or null with the reason it is missing. */
  runs: RunHistory | null;
  runsWhy: string | null;
  /** Today in the user's zone (YYYY-MM-DD). */
  today?: string;
  /** The low-readiness day, null when there is none, or not set with `readinessWhy`. */
  readiness?: ReadinessFlag | null;
  readinessWhy?: string | null;
  /** The athlete profile's strength goal, null when none is set. */
  strengthGoal?: StrengthGoal | null;
  /** Endurance fitness to project the weekly load ramp from, or not set with `loadWhy`. */
  load?: RampStart | null;
  /**
   * Today's planned sessions C5 reads as done (a logged workout, a Garmin
   * match or pick): read once per call, before the write's transaction, so
   * the facts never need a second connection (review item 3).
   */
  doneToday?: ReadonlySet<number>;
  loadWhy?: string | null;
};

const NO_ENDURANCE = "The endurance features are off for this account, so no training limit runs.";
const NO_GARMIN =
  "Long-run cap not checked: no Garmin data for this account. Check the change against the long-run rule in logeverylift://docs/endurance-training-reference yourself.";
const NO_READINESS = "Hard session after a low-readiness day not checked: no HRV and resting HR data (needs Garmin).";
const STALE_READINESS = "Hard session after a low-readiness day not checked: no HRV reading from Garmin today or yesterday.";
const NO_STRENGTH_GOAL = "Strength sessions per week not checked: no strength goal in the athlete profile.";
const NO_LOAD = "Weekly load ramp not checked: no endurance training load yet (no swim, bike or run in Garmin data or logged in the app).";
const CALIBRATING = (n: number) =>
  `Weekly load ramp not checked: fitness is still calibrating (${Math.min(n, 42)} of 42 days of history). Check the change against the ramp rule in logeverylift://docs/endurance-training-reference yourself.`;

/**
 * Endurance fitness (swim + bike + run CTL; hub decision 1) from D1's one
 * reader (Garmin series where the user has it, else the app series, never
 * both), for the weekly load ramp. Not checked while it calibrates (decision 3).
 */
async function rampStart(userId: string, today: string): Promise<{ load: RampStart | null; why: string | null }> {
  const { getTrainingLoad } = await import("@/lib/training-load");
  const series = await getTrainingLoad(userId, 60);
  const days = series.days.filter((d) => d.tracks?.total);
  // History starts at the source's first day with any load, however long ago
  // (review item 5): none at all is no data, and under 42 days is still
  // calibrating (a new user's fitness starts from 0, so any plan would read
  // as a steep ramp).
  const first = await firstLoadDay(userId, series.source);
  if (first == null || !days.length) return { load: null, why: NO_LOAD };
  const history = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  if (days.at(-1)!.calibrating || history < 42) return { load: null, why: CALIBRATING(history) };
  const endurance = (d: (typeof days)[number], k: "ctl" | "load") => (["swim", "bike", "run"] as const).reduce((a, sp) => a + (d.tracks[sp]?.[k] ?? 0), 0);
  const past = days.filter((d) => d.date < today);
  const pastCtl = new Map(past.map((d) => [d.date, endurance(d, "ctl")]));
  const todayRow = days.find((d) => d.date === today);
  const ctlYesterday = past.length ? endurance(past.at(-1)!, "ctl") : 0;
  return { load: { today, ctlYesterday, pastCtl, doneToday: todayRow ? endurance(todayRow, "load") : 0 }, why: null };
}

/**
 * The first day the user's fitness source has any ENDURANCE load (a Garmin
 * day with swim, bike or run load, or a logged session with an endurance set):
 * the rule reads endurance CTL, so a lifter's strength history is not
 * endurance history (review item 4).
 */
async function firstLoadDay(userId: string, source: "garmin" | "app"): Promise<string | null> {
  const { sql } = await import("drizzle-orm");
  if (source === "garmin") {
    const track = (sp: string) => sql`coalesce((${garminDailyMetrics.metrics}->'pmc'->${sp}->>'load')::float8, 0)`;
    const [r] = await db
      .select({ day: sql<string | null>`min(${garminDailyMetrics.day})::text` })
      .from(garminDailyMetrics)
      .where(and(eq(garminDailyMetrics.userId, userId), sql`${track("swim")} + ${track("bike")} + ${track("run")} > 0`));
    return r?.day ?? null;
  }
  const [r] = await db
    .select({ day: sql<string | null>`min(${workoutSessions.date})::text` })
    .from(workoutSessions)
    .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        inArray(workoutSessions.source, ["app", "assistant"]),
        isNotNull(exercises.discipline),
      ),
    );
  return r?.day ?? null;
}

const NO_PHASE = "Strength sessions per week not checked: the cycle has no phase type, so one template runs the whole block.";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Garmin runs in [from, today]. */
async function garminRuns(userId: string, from: string): Promise<PastRun[]> {
  const rows = await db
    .select({
      typeKey: garminActivities.activityType,
      start: garminActivities.startTimeLocal,
      data: garminActivities.data,
      sport: garminActivityMetrics.sport,
    })
    .from(garminActivities)
    .leftJoin(
      garminActivityMetrics,
      and(
        eq(garminActivityMetrics.userId, garminActivities.userId),
        eq(garminActivityMetrics.garminActivityId, garminActivities.garminActivityId),
      ),
    )
    .where(and(eq(garminActivities.userId, userId), gte(garminActivities.startTimeLocal, new Date(`${from}T00:00:00Z`))));
  return rows
    .filter((r) => (r.sport ?? sportOf(r.typeKey)) === "run")
    .map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return {
        day: r.start.toISOString().slice(0, 10),
        durationS: num(d.duration) ?? 0,
        distanceM: num(d.distance),
        indoor: isIndoor(r.typeKey),
      };
    });
}

/**
 * Runs logged in the app (by the user or their assistant) in [from, today]:
 * one per completed workout, its run sets summed. A set with an incline is a
 * treadmill run, which counts for time, not distance, as indoor Garmin runs
 * do (docs/plans/limits-strength-readiness.md, 3.4).
 */
async function appRuns(userId: string, from: string, today: string): Promise<PastRun[]> {
  const rows = await db
    .select({
      sessionId: workoutSessions.id,
      day: workoutSessions.date,
      durationSeconds: workoutSets.durationSeconds,
      distanceMeters: workoutSets.distanceMeters,
      inclinePercent: workoutSets.inclinePercent,
    })
    .from(workoutSessions)
    .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        inArray(workoutSessions.source, ["app", "assistant"]),
        gte(workoutSessions.date, from),
        lte(workoutSessions.date, today),
        eq(exercises.discipline, "run"),
        eq(workoutSets.isCompleted, true),
      ),
    );
  const bySession = new Map<number, PastRun>();
  for (const r of rows) {
    const run = bySession.get(r.sessionId) ?? { day: r.day, durationS: 0, distanceM: null, indoor: false };
    run.durationS += r.durationSeconds ?? 0;
    if (r.distanceMeters != null) run.distanceM = (run.distanceM ?? 0) + r.distanceMeters;
    if ((r.inclinePercent ?? 0) > 0) run.indoor = true;
    bySession.set(r.sessionId, run);
  }
  return [...bySession.values()].filter((r) => r.durationS > 0 || (r.distanceM ?? 0) > 0);
}

/** The Garmin daily rows the readiness flag reads: the day before yesterday to today. */
async function readinessDays(userId: string, today: string): Promise<ReadinessDay[]> {
  const { addDaysStr } = await import("@/lib/utils/planned-sessions");
  const rows = await db
    .select({ day: garminDailyMetrics.day, metrics: garminDailyMetrics.metrics })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, addDaysStr(today, -2)), lte(garminDailyMetrics.day, today)));
  return rows.map((r) => {
    const m = (r.metrics ?? {}) as { hrv?: Record<string, unknown>; restingHr?: Record<string, unknown> };
    return {
      date: r.day,
      hrvMs: num(m.hrv?.ms),
      hrvState: typeof m.hrv?.state === "string" ? m.hrv.state : null,
      hrvMean7: num(m.hrv?.mean7),
      bandLow: num(m.hrv?.bandLow),
      bandHigh: num(m.hrv?.bandHigh),
      rhrFlag: m.restingHr?.flag === true,
      rhrMean7: num(m.restingHr?.mean7),
      rhrBaseline: num(m.restingHr?.baseline),
    };
  });
}

export async function limitContext(userId: string): Promise<LimitContext> {
  if (!(await enduranceEnabledFor(userId))) return { endurance: false, runs: null, runsWhy: NO_ENDURANCE };
  const todayDate = await userToday(userId);
  const today = toDateStr(todayDate);
  // The 30 days up to and including today.
  const from = toDateStr(addDays(todayDate, -(LONG_RUN_WINDOW_DAYS - 1)));
  const [profile] = await db.select({ strengthGoal: athleteProfiles.strengthGoal }).from(athleteProfiles).where(and(eq(athleteProfiles.userId, userId), isNull(athleteProfiles.deletedAt)));
  const strengthGoal = profile?.strengthGoal ?? null;
  const app = await appRuns(userId, from, today);

  const garmin = await garminAllowedFor(userId);
  const [conn] = garmin
    ? await db.select({ lastSyncedAt: garminConnections.lastSyncedAt }).from(garminConnections).where(eq(garminConnections.userId, userId))
    : [];
  if (!conn?.lastSyncedAt) {
    // No Garmin: the cap runs on runs logged in the app, when there are any.
    return {
      endurance: true,
      runs: app.length ? longestRuns(app) : null,
      runsWhy: app.length ? null : NO_GARMIN,
      today,
      readinessWhy: NO_READINESS,
      strengthGoal,
      ...(await rampStart(userId, today).then((r) => ({ load: r.load, loadWhy: r.why }))),
      doneToday: await doneTodayIds(userId, today),
    };
  }
  const days = await readinessDays(userId, today);
  const { addDaysStr } = await import("@/lib/utils/planned-sessions");
  const fresh = days.some((d) => (d.date === today || d.date === addDaysStr(today, -1)) && d.hrvMs != null);
  // The longest of both sources: a run in both can only count once as the longest.
  return {
    endurance: true,
    runs: longestRuns([...(await garminRuns(userId, from)), ...app]),
    runsWhy: null,
    today,
    readiness: fresh ? readinessFlag(days, today) : undefined,
    readinessWhy: fresh ? null : STALE_READINESS,
    strengthGoal,
    ...(await rampStart(userId, today).then((r) => ({ load: r.load, loadWhy: r.why }))),
    doneToday: await doneTodayIds(userId, today),
  };
}

/** Today's planned sessions in C5's done state. */
async function doneTodayIds(userId: string, today: string): Promise<ReadonlySet<number>> {
  const { sessionCompliance } = await import("@/lib/session-compliance");
  return new Set((await sessionCompliance(userId, today, today)).filter((c) => c.state === "done").map((c) => c.id));
}

/**
 * Today's readiness flag from Garmin, for the readiness swap (D4): null for
 * a user without Garmin data, or when there is no flag. The caller checks
 * the endurance switch.
 */
export async function readinessToday(userId: string, today: string): Promise<ReadinessFlag | null> {
  if (!(await garminAllowedFor(userId))) return null;
  const [conn] = await db.select({ lastSyncedAt: garminConnections.lastSyncedAt }).from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn?.lastSyncedAt) return null;
  return readinessFlag(await readinessDays(userId, today), today);
}

// ── Plan facts ──────────────────────────────────────────────────────────────

/** The planned run of each program, by id, labelled with the program's name. */
export async function programRuns(
  ex: Executor,
  programIds: number[],
  /** The week's share of peak; sets with a peak anchor are scaled by it. Null = the stored values. */
  share: number | null = null,
): Promise<Map<number, { label: string; run: PlannedRun }>> {
  const out = new Map<number, { label: string; run: PlannedRun }>();
  if (programIds.length === 0) return out;
  const rows = await ex
    .select({
      programId: programs.id,
      name: programs.name,
      discipline: exercises.discipline,
      durationSeconds: programSets.durationSeconds,
      distanceMeters: programSets.distanceMeters,
      peakDuration: programSets.peakDurationSeconds,
      peakDistance: programSets.peakDistanceMeters,
    })
    .from(programs)
    .innerJoin(programExercises, eq(programExercises.programId, programs.id))
    .innerJoin(programSets, eq(programSets.programExerciseId, programExercises.id))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(inArray(programs.id, programIds), livePrograms, liveProgramExercises, liveProgramSets));
  for (const id of programIds) {
    const sets = rows.filter((r) => r.programId === id);
    const label = sets[0]?.name ? `"${sets[0].name}"` : `Program ${id}`;
    out.set(id, {
      label: `Run in ${label}`,
      run: plannedRun(
        sets.map((s) => ({
          discipline: s.discipline,
          durationSeconds: share != null && s.peakDuration != null ? scaledDuration(s.peakDuration, share) : s.durationSeconds,
          distanceMeters: share != null && s.peakDistance != null ? scaledDistance(s.peakDistance, share) : s.distanceMeters,
        })),
      ),
    });
  }
  return out;
}

/** The Monday of today's week in the user's zone. */
async function mondayToday(ex: Executor, userId: string): Promise<string> {
  const { mondayOf } = await import("@/lib/utils/planned-sessions");
  return mondayOf(await todayOn(ex, userId));
}

/** Today (YYYY-MM-DD) in the user's zone, read on this connection (as userToday does). */
async function todayOn(ex: Executor, userId: string): Promise<string> {
  const { localDateStr } = await import("@/lib/utils/user-date");
  const [u] = await ex.select({ timeZone: users.timeZone }).from(users).where(eq(users.id, userId));
  return localDateStr(new Date(), u?.timeZone ?? null);
}

/**
 * A cycle's dated sessions grouped by calendar week, from this week (or the
 * block's first week, if it starts later) to the block's last week. Weeks with
 * no session are there too, empty, so a write that fills one is seen.
 */
async function datedCycleWeeks(ex: Executor, cycleId: number): Promise<{ thisMonday: string; byWeek: Map<string, WeekSession[]> }> {
  const { addDaysStr, dowOf, mondayOf } = await import("@/lib/utils/planned-sessions");
  const { cycleBlock } = await import("@/lib/planned-sessions");
  const [c] = await ex.select().from(trainingCycles).where(and(eq(trainingCycles.id, cycleId), liveCycles));
  const byWeek = new Map<string, WeekSession[]>();
  const today = c ? await todayOn(ex, c.userId) : toDateStr(new Date());
  const thisMonday = mondayOf(today);
  const block = c ? cycleBlock(c) : null;
  if (!c || !block) return { thisMonday, byWeek };
  const first = mondayOf(block.start > today ? block.start : today);
  const last = addDaysStr(block.end, -1);
  for (let m = first; m <= last; m = addDaysStr(m, 7)) byWeek.set(m, []);
  const rows = await ex
    .select({ date: plannedSessions.date, programId: plannedSessions.programId, workout: plannedSessions.workout })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.cycleId, cycleId),
        livePlannedSessions,
        eq(plannedSessions.status, "planned"),
        gte(plannedSessions.date, first),
        lte(plannedSessions.date, last),
      ),
    );
  const hard = await hardPrograms(ex, rows.map((r) => r.programId).filter((id): id is number => id != null));
  const hardWorkout = rows.some((r) => r.workout != null) ? await workoutWeekSession(ex, c.userId) : null;
  for (const r of rows) {
    if (r.programId != null) byWeek.get(mondayOf(r.date!))?.push({ dayOfWeek: dowOf(r.date!), hard: hard.get(r.programId) ?? false });
    else if (r.workout != null) byWeek.get(mondayOf(r.date!))?.push({ dayOfWeek: dowOf(r.date!), hard: hardWorkout!(r.workout) });
  }
  return { thisMonday, byWeek };
}

/** The weekday cycles among these that have dated sessions. */
export async function datedCycles(ex: Executor, cycleIds: number[]): Promise<Set<number>> {
  if (cycleIds.length === 0) return new Set();
  const rows = await ex
    .select({ id: trainingCycles.id })
    .from(trainingCycles)
    .where(and(inArray(trainingCycles.id, cycleIds), liveCycles, eq(trainingCycles.scheduleType, "day_of_week"), isNotNull(trainingCycles.sessionsGeneratedAt)));
  return new Set(rows.map((r) => r.id));
}

/** A weekday cycle's week of sessions, or null for a rotation cycle (no fixed week). */
export async function cycleWeekSessions(ex: Executor, cycleId: number): Promise<WeekSession[] | null> {
  const [cycle] = await ex
    .select({ scheduleType: trainingCycles.scheduleType, userId: trainingCycles.userId })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), liveCycles));
  if (!cycle || cycle.scheduleType !== "day_of_week") return null;
  const slots = await ex
    .select({ dayOfWeek: trainingCycleSlots.dayOfWeek, programId: trainingCycleSlots.programId, workout: workouts.workout })
    .from(trainingCycleSlots)
    // plan-read: includes deleted (a deleted library workout reads as a rest day, as generation does)
    .leftJoin(workouts, and(eq(workouts.id, trainingCycleSlots.workoutId), isNull(workouts.deletedAt)))
    .where(eq(trainingCycleSlots.trainingCycleId, cycleId));
  // A slot with a library workout counts like a program slot (review 3).
  const hardWorkout = slots.some((s) => s.programId == null && s.workout != null) ? await workoutWeekSession(ex, cycle.userId) : null;
  const programIds = [...new Set(slots.map((s) => s.programId).filter((id): id is number => id != null))];
  const sets = programIds.length
    ? await ex
        .select({
          programId: programs.id,
          discipline: exercises.discipline,
          sessionRole: programSets.sessionRole,
          targetHeartRateZone: programSets.targetHeartRateZone,
        })
        .from(programs)
        .innerJoin(programExercises, eq(programExercises.programId, programs.id))
        .innerJoin(programSets, eq(programSets.programExerciseId, programExercises.id))
        .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
        .where(and(inArray(programs.id, programIds), livePrograms, liveProgramExercises, liveProgramSets))
    : [];
  return slots
    .filter((s) => s.dayOfWeek != null && (s.programId != null || s.workout != null))
    .map((s) => ({
      dayOfWeek: s.dayOfWeek!,
      // A slot on a deleted program has no live sets, so it is not hard.
      hard: s.programId == null ? hardWorkout!(s.workout) : isHardSession(
        sets
          .filter((x) => x.programId === s.programId)
          .map((x) => ({ discipline: x.discipline, sessionRole: x.sessionRole === "work" ? "work" : null, targetHeartRateZone: x.targetHeartRateZone })),
      ),
    }));
}

/** Whether each program is a hard session (an interval endurance set), by id. */
export async function hardPrograms(ex: Executor, programIds: number[]): Promise<Map<number, boolean>> {
  const ids = [...new Set(programIds)];
  const sets = ids.length
    ? await ex
        .select({
          programId: programs.id,
          discipline: exercises.discipline,
          sessionRole: programSets.sessionRole,
          targetHeartRateZone: programSets.targetHeartRateZone,
        })
        .from(programs)
        .innerJoin(programExercises, eq(programExercises.programId, programs.id))
        .innerJoin(programSets, eq(programSets.programExerciseId, programExercises.id))
        .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
        .where(and(inArray(programs.id, ids), livePrograms, liveProgramExercises, liveProgramSets))
    : [];
  return new Map(
    ids.map((id) => [
      id,
      isHardSession(
        sets
          .filter((x) => x.programId === id)
          .map((x) => ({ discipline: x.discipline, sessionRole: x.sessionRole === "work" ? "work" : null, targetHeartRateZone: x.targetHeartRateZone })),
      ),
    ]),
  );
}

/**
 * One calendar week (Monday to Sunday) of a user's dated sessions on weekday
 * cycles (docs/plans/sessions.md, 6): a moved session counts in the week it
 * lands in, a skipped one does not, and several on one day count each.
 */
export async function calendarWeekSessions(ex: Executor, userId: string, monday: string, cycleId?: number): Promise<WeekSession[]> {
  const { addDaysStr, dowOf } = await import("@/lib/utils/planned-sessions");
  const rows = await ex
    .select({ date: plannedSessions.date, programId: plannedSessions.programId, workout: plannedSessions.workout })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), isNull(trainingCycles.deletedAt)))
    .where(
      and(
        eq(plannedSessions.userId, userId),
        livePlannedSessions,
        eq(plannedSessions.status, "planned"),
        gte(plannedSessions.date, monday),
        lte(plannedSessions.date, addDaysStr(monday, 6)),
        cycleId != null ? eq(plannedSessions.cycleId, cycleId) : undefined,
      ),
    );
  const hard = await hardPrograms(ex, rows.map((r) => r.programId).filter((id): id is number => id != null));
  const hardWorkout = rows.some((r) => r.workout != null) ? await workoutWeekSession(ex, userId) : null;
  return rows
    .filter((r) => r.programId != null || r.workout != null)
    .map((r) => ({ dayOfWeek: dowOf(r.date!), hard: r.programId != null ? (hard.get(r.programId) ?? false) : hardWorkout!(r.workout) }));
}

// ── Sessions placed on days (docs/plans/limits-strength-readiness.md) ────────

type PlaceRow = {
  ref: string;
  date: string;
  position: number;
  programId: number | null;
  workout: unknown;
  priority: "key" | "support" | "optional" | null;
  label: string | null;
  cycleId: number | null;
  /** A logged workout is linked to it (its load is in the fitness series). */
  done?: boolean;
};

/** The user's current threshold values, read on this connection. */
async function thresholdsOn(ex: Executor, userId: string) {
  const { athleteThresholds } = await import("@/db/schema");
  const { currentThresholds } = await import("@/lib/utils/thresholds");
  const rows = await ex.select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, userId), isNull(athleteThresholds.deletedAt)));
  return Object.fromEntries(Object.entries(currentThresholds(rows)).map(([k, r]) => [k, r!.value]));
}

/** The total time of planned steps, or null when none has a time. */
function plannedSeconds(steps: { seconds: number | null }[]): number | null {
  const known = steps.filter((s) => s.seconds != null);
  return known.length ? Math.round(known.reduce((a, s) => a + s.seconds!, 0)) : null;
}

/** D1's planned load of a workout, or none when it cannot be estimated. */
function workoutLoad(estimate: () => { load: number; partial: boolean }): { plannedLoad: number | null; loadPartial: boolean } {
  try {
    const e = estimate();
    return { plannedLoad: e.load, loadPartial: e.partial };
  } catch {
    return { plannedLoad: null, loadPartial: true };
  }
}

/**
 * The share of peak a dated session's peak-anchored sets run at: a later week
 * of an active block than this one runs at that week's curve (100% volume);
 * this week and anything else use the stored values, which the weekly sync set.
 */
async function weekShares(ex: Executor, rows: PlaceRow[]): Promise<WeekShare> {
  const ids = [...new Set(rows.map((r) => r.cycleId).filter((id): id is number => id != null))];
  if (!ids.length || rows.every((r) => r.ref.startsWith("t:"))) return () => null;
  const { cycleWeek, parseDateStr } = await import("@/lib/utils/cycle-position");
  const cycles = await ex.select().from(trainingCycles).where(and(inArray(trainingCycles.id, ids), liveCycles));
  const byId = new Map(cycles.map((c) => [c.id, c]));
  const todays = new Map<string, string>();
  return (cycleId, date) => {
    const c = cycleId != null ? byId.get(cycleId) : undefined;
    if (!c || c.status !== "active" || !c.startDate) return null;
    const startDate = parseDateStr(c.startDate);
    const week = cycleWeek(startDate, c.durationWeeks, parseDateStr(date), c.durationDays);
    if (week.isOver) return null;
    const nowKey = String(c.id);
    if (!todays.has(nowKey)) todays.set(nowKey, String(c.lastSyncedWeek ?? 1));
    if (week.currentWeek <= Number(todays.get(nowKey))) return null;
    return cycleLoad(c, week.currentWeek, c.durationWeeks).multiplier;
  };
}

/**
 * What the placed-session rules need of each row: its sport, whether it is
 * hard, its planned time, its heavy leg sets and its strength sets, read on
 * this connection (inside the write's transaction).
 */
async function placeRows(ex: Executor, userId: string, rows: PlaceRow[], fixedShare: number | null = null): Promise<PlacedSession[]> {
  const ids = [...new Set(rows.map((r) => r.programId).filter((id): id is number => id != null))];
  const sets = ids.length
    ? await ex
        .select({
          programId: programs.id,
          name: programs.name,
          category: exercises.category,
          discipline: exercises.discipline,
          bodyArea: exercises.bodyArea,
          movementPattern: exercises.movementPattern,
          equipment: exercises.equipment,
          exerciseType: exercises.exerciseType,
          typeOverride: programExercises.exerciseType,
          setType: programSets.setType,
          targetReps: programSets.targetReps,
          repRangeMax: programSets.repRangeMax,
          sessionRole: programSets.sessionRole,
          targetHeartRateZone: programSets.targetHeartRateZone,
          durationSeconds: programSets.durationSeconds,
          distanceMeters: programSets.distanceMeters,
          peakDuration: programSets.peakDurationSeconds,
          peakDistance: programSets.peakDistanceMeters,
        })
        .from(programs)
        .innerJoin(programExercises, eq(programExercises.programId, programs.id))
        .innerJoin(programSets, eq(programSets.programExerciseId, programExercises.id))
        .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
        .where(and(inArray(programs.id, ids), livePrograms, liveProgramExercises, liveProgramSets))
    : [];
  const byProgram = new Map<number, typeof sets>();
  for (const s of sets) byProgram.set(s.programId, [...(byProgram.get(s.programId) ?? []), s]);

  const thresholds = rows.length ? await thresholdsOn(ex, userId) : {};
  const { estimateWorkout, isHardWorkout, parseWorkout } = await import("@/lib/utils/workout-steps");
  const { loadAnchors, workoutPlannedLoad } = await import("@/lib/utils/step-results");
  const { DEFAULT_IF, plannedLoad } = await import("@/lib/utils/training-load");
  const anchors = loadAnchors(thresholds);
  const share: WeekShare = fixedShare != null ? () => fixedShare : await weekShares(ex, rows);

  return rows.map((r): PlacedSession => {
    const base = { ref: r.ref, date: r.date, position: r.position, storedPriority: r.priority, cycleId: r.cycleId, done: r.done ?? false };
    if (r.programId == null) {
      const p = r.workout != null ? parseWorkout(r.workout) : null;
      if (!p?.ok) return { ...base, label: r.label ?? "Session", sport: null, hard: false, plannedDurationS: null, heavyLegSets: 0, strengthSets: 0 };
      return {
        ...base,
        label: r.label ?? p.workout.name,
        sport: p.workout.sport,
        hard: isHardWorkout(p.workout, thresholds),
        plannedDurationS: estimateWorkout(p.workout, thresholds).durationSeconds || null,
        heavyLegSets: 0,
        strengthSets: 0,
        ...workoutLoad(() => workoutPlannedLoad(p.workout, thresholds)),
      };
    }
    // A slot or session on a deleted program has no live sets: an empty session.
    const mine = byProgram.get(r.programId) ?? [];
    const disciplines = new Set(mine.map((s) => s.discipline));
    const sport = disciplines.size === 1 && !disciplines.has(null) ? [...disciplines][0] : null;
    const legSets = mine.map((s) => ({ ...s, exerciseType: s.typeOverride ?? s.exerciseType }));
    // Planned load (brief 3.1.1): each discipline's sets as steps for D1's estimate;
    // a future week of the block scales peak-anchored sets by that week's share.
    const k = share(r.cycleId, r.date);
    const loadSets = mine.map((s) => ({
      ...s,
      durationSeconds: k != null && s.peakDuration != null ? scaledDuration(s.peakDuration, k) : s.durationSeconds,
      distanceMeters: k != null && s.peakDistance != null ? scaledDistance(s.peakDistance, k) : s.distanceMeters,
    }));
    let load: number | null = null;
    let partial = false;
    for (const sport of ["swim", "bike", "run"] as const) {
      const steps = programSteps(loadSets.filter((s) => s.discipline === sport), anchors, DEFAULT_IF);
      if (!steps.length) continue;
      const est = plannedLoad(sport, steps, anchors);
      load = (load ?? 0) + est.load;
      partial ||= est.partial;
    }
    return {
      ...base,
      label: r.label ?? mine[0]?.name ?? "Session",
      sport,
      hard: isHardSession(
        mine.map((s) => ({ discipline: s.discipline, sessionRole: s.sessionRole === "work" ? "work" : null, targetHeartRateZone: s.targetHeartRateZone })),
      ),
      // A distance-only run or swim gets its time from the threshold speed (programSteps),
      // so a long run planned by distance can read as key (review nit).
      plannedDurationS: sport ? plannedSeconds(programSteps(loadSets.filter((s) => s.discipline === sport), anchors, DEFAULT_IF)) : null,
      heavyLegSets: legSets.filter(isHeavyLegSet).length,
      strengthSets: legSets.filter(isStrengthSet).length,
      plannedLoad: load,
      loadPartial: partial,
    };
  });
}

/** A weekday cycle's template week, dated from TEMPLATE_MONDAY, as a loop. Null for a rotation cycle. */
async function templateGroup(ex: Executor, cycleId: number, share: number | null = null): Promise<PlacedGroup | null> {
  const { addDaysStr } = await import("@/lib/utils/planned-sessions");
  const [c] = await ex
    .select({ userId: trainingCycles.userId, name: trainingCycles.name, phaseType: trainingCycles.phaseType, scheduleType: trainingCycles.scheduleType })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), liveCycles));
  if (!c || c.scheduleType !== "day_of_week") return null;
  const slots = await ex
    .select({
      id: trainingCycleSlots.id,
      dayOfWeek: trainingCycleSlots.dayOfWeek,
      daySlot: trainingCycleSlots.daySlot,
      programId: trainingCycleSlots.programId,
      label: trainingCycleSlots.label,
      priority: trainingCycleSlots.priority,
      workout: workouts.workout,
    })
    .from(trainingCycleSlots)
    // plan-read: includes deleted (a deleted library workout reads as a rest day, as generation does)
    .leftJoin(workouts, and(eq(workouts.id, trainingCycleSlots.workoutId), isNull(workouts.deletedAt)))
    .where(eq(trainingCycleSlots.trainingCycleId, cycleId));
  const rows = slots
    .filter((s) => s.dayOfWeek != null && (s.programId != null || s.workout != null))
    .map((s) => ({
      ref: `t:${s.id}`,
      date: addDaysStr(TEMPLATE_MONDAY, s.dayOfWeek! - 1),
      position: s.daySlot,
      programId: s.programId,
      workout: s.programId == null ? s.workout : null,
      priority: s.priority,
      label: s.label,
      cycleId,
    }));
  return {
    loop: true,
    from: TEMPLATE_MONDAY,
    to: addDaysStr(TEMPLATE_MONDAY, 6),
    // A start reads the block's first week at its share of peak (review item 1).
    sessions: await placeRows(ex, c.userId, rows, share),
    cycles: { [cycleId]: { name: c.name, phaseType: c.phaseType, blockStart: null, blockEnd: null } },
  };
}

/** The cycles' names, phase types and blocks (first and last day). */
async function placedCycles(ex: Executor, cycleIds: number[]): Promise<Record<number, PlacedCycle>> {
  if (!cycleIds.length) return {};
  const { addDaysStr } = await import("@/lib/utils/planned-sessions");
  const { cycleBlock } = await import("@/lib/planned-sessions");
  const rows = await ex.select().from(trainingCycles).where(and(inArray(trainingCycles.id, cycleIds), liveCycles));
  return Object.fromEntries(
    rows.map((c) => {
      const block = cycleBlock(c);
      return [c.id, { name: c.name, phaseType: c.phaseType, blockStart: block?.start ?? null, blockEnd: block ? addDaysStr(block.end, -1) : null }];
    }),
  );
}

/** Dated sessions (planned or done; not skipped or missed) in [from, to], of one cycle or of all the user's live cycles. */
async function datedRows(ex: Executor, userId: string, from: string, to: string, cycleId?: number, doneToday: ReadonlySet<number> = new Set()): Promise<PlaceRow[]> {
  const rows = await ex
    .select({
      id: plannedSessions.id,
      date: plannedSessions.date,
      position: plannedSessions.position,
      programId: plannedSessions.programId,
      workout: plannedSessions.workout,
      priority: plannedSessions.priority,
      label: plannedSessions.label,
      cycleId: plannedSessions.cycleId,
      garminActivityId: plannedSessions.garminActivityId,
    })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), liveCycles))
    .where(
      and(
        eq(plannedSessions.userId, userId),
        livePlannedSessions,
        eq(plannedSessions.status, "planned"),
        isNotNull(plannedSessions.date),
        gte(plannedSessions.date, from),
        lte(plannedSessions.date, to),
        cycleId != null ? eq(plannedSessions.cycleId, cycleId) : undefined,
      ),
    );
  const linked = rows.length
    ? await ex
        .selectDistinct({ id: workoutSessions.plannedSessionId })
        .from(workoutSessions)
        .where(and(inArray(workoutSessions.plannedSessionId, rows.map((r) => r.id)), eq(workoutSessions.isCompleted, true)))
    : [];
  const done = new Set(linked.map((l) => l.id));
  // Today's sessions done another way: a picked Garmin activity, or C5's match
  // to a logged workout or a Garmin activity. Their load is in the series
  // already, so the ramp must not add the plan again (review item 2).
  for (const r of rows) if (r.garminActivityId != null || doneToday.has(r.id)) done.add(r.id);
  return rows.map((r) => ({ id: r.id, position: r.position, programId: r.programId, workout: r.workout, priority: r.priority, label: r.label, cycleId: r.cycleId, ref: `p:${r.id}`, date: r.date!, done: done.has(r.id) }));
}

/** A dated cycle's sessions from this week (or its first week) to its last day, with the two days before. */
async function datedCycleGroup(ex: Executor, cycleId: number, doneToday?: ReadonlySet<number>): Promise<PlacedGroup | null> {
  const { addDaysStr, mondayOf } = await import("@/lib/utils/planned-sessions");
  const { cycleBlock } = await import("@/lib/planned-sessions");
  const [c] = await ex.select().from(trainingCycles).where(and(eq(trainingCycles.id, cycleId), liveCycles));
  const block = c ? cycleBlock(c) : null;
  if (!c || !block) return null;
  const today = await todayOn(ex, c.userId);
  const from = mondayOf(block.start > today ? block.start : today);
  const to = addDaysStr(block.end, -1);
  const rows = await datedRows(ex, c.userId, addDaysStr(from, -2), to, cycleId, doneToday);
  return {
    loop: false,
    from,
    to,
    lead: await leadSessions(ex, c.userId, today, addDaysStr(from, -3), doneToday),
    sessions: await placeRows(ex, c.userId, rows),
    cycles: { [cycleId]: { name: c.name, phaseType: c.phaseType, blockStart: block.start, blockEnd: to } },
  };
}

/** One calendar week of the user's dated sessions, with the two days before. */
async function weekGroup(ex: Executor, userId: string, monday: string, doneToday?: ReadonlySet<number>): Promise<PlacedGroup> {
  const { addDaysStr } = await import("@/lib/utils/planned-sessions");
  const to = addDaysStr(monday, 6);
  const rows = await datedRows(ex, userId, addDaysStr(monday, -2), to, undefined, doneToday);
  const cycleIds = [...new Set(rows.map((r) => r.cycleId).filter((id): id is number => id != null))];
  const today = await todayOn(ex, userId);
  return {
    loop: false,
    from: monday,
    to,
    lead: await leadSessions(ex, userId, today, addDaysStr(monday, -3), doneToday),
    sessions: await placeRows(ex, userId, rows),
    cycles: await placedCycles(ex, cycleIds),
  };
}

/**
 * The user's dated sessions from today to `to`: the weekly load ramp projects
 * fitness through them to a group's first week, instead of empty days that
 * would decay it (review item 3). None when the group starts within two days.
 */
async function leadSessions(ex: Executor, userId: string, today: string, to: string, doneToday?: ReadonlySet<number>): Promise<PlacedSession[]> {
  if (to < today) return [];
  return placeRows(ex, userId, await datedRows(ex, userId, today, to, undefined, doneToday));
}

/**
 * The training limits this week's sync (or applied Garmin suggestion) broke
 * on a cycle, from its stored revision (T4): shown on the cycle page and in
 * get_training_cycle. Empty when it broke none or has not run this week.
 */
export async function syncLimitWarnings(userId: string, cycleId: number, week: number | null): Promise<{ rule: string; message: string; evidence: string }[]> {
  if (week == null || !(await enduranceEnabledFor(userId))) return [];
  const { planRevisions } = await import("@/db/schema");
  const { desc } = await import("drizzle-orm");
  const [rev] = await db
    .select({ limitCheck: planRevisions.limitCheck })
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, userId),
        eq(planRevisions.objectType, "cycle"),
        eq(planRevisions.objectId, cycleId),
        inArray(planRevisions.changeSetId, [`sync:${cycleId}:${week}`, `apply:${cycleId}:${week}`]),
      ),
    )
    .orderBy(desc(planRevisions.id))
    .limit(1);
  const warnings = (rev?.limitCheck as Partial<LimitCheck> | null)?.warnings ?? [];
  return warnings.map((w) => ({ rule: w.rule, message: w.message, evidence: w.evidence }));
}

export type HeavyLegsNote = HeavyLegsPair;

/**
 * Heavy leg work 1-2 days before a key bike or run session, or earlier the
 * same day, among the user's dated sessions around [from, to] (D3: the
 * calendar and session detail show it with the rule the limits use; no
 * second rule). The caller checks the endurance switch.
 */
export async function heavyLegsNotes(userId: string, from: string, to: string): Promise<HeavyLegsNote[]> {
  const { addDaysStr } = await import("@/lib/utils/planned-sessions");
  const rows = await datedRows(db, userId, addDaysStr(from, -2), addDaysStr(to, 2));
  const sessions = await placeRows(db, userId, rows);
  const group: PlacedGroup = { loop: false, from: addDaysStr(from, -2), to: addDaysStr(to, 2), sessions, cycles: {} };
  const id = (ref: string) => Number(ref.slice(2));
  return heavyLegConflicts(group)
    .filter((c) => (c.lift.date >= from && c.lift.date <= to) || (c.key.date >= from && c.key.date <= to))
    .map((c) => ({
      liftId: id(c.lift.ref),
      keyId: id(c.key.ref),
      liftLabel: c.lift.label,
      keyLabel: c.key.label,
      liftDate: c.lift.date,
      keyDate: c.key.date,
      daysBefore: c.days,
    }));
}

/**
 * The cycles whose week a change to this program changes: the active cycle,
 * and a draft scheduled to start, which becomes active on its day without
 * another check (startDueScheduledCycle runs as the app).
 */
export async function limitCyclesWith(ex: Executor, userId: string, programId: number): Promise<number[]> {
  const rows = await ex
    .selectDistinct({ id: trainingCycles.id })
    .from(trainingCycles)
    .innerJoin(trainingCycleSlots, eq(trainingCycleSlots.trainingCycleId, trainingCycles.id))
    .where(
      and(
        eq(trainingCycles.userId, userId),
        or(eq(trainingCycles.status, "active"), and(eq(trainingCycles.status, "draft"), isNotNull(trainingCycles.scheduledStartDate))),
        liveCycles,
        eq(trainingCycleSlots.programId, programId),
      ),
    );
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

/**
 * What a write is about: the programs whose runs it can change, the cycles
 * whose week it can change, and, for a change to dated sessions, the calendar
 * weeks (their Mondays) it moves sessions in or out of.
 */
export type LimitScope = {
  programIds: number[];
  cycleIds: number[];
  /** `sessionIds`: dated sessions whose own workout's run the long-run cap reads (docs/plans/workouts-and-compliance.md, 8). */
  sessionWeeks?: { userId: string; mondays: string[]; sessionIds?: number[] };
};

export type PlanFacts = {
  runs: Map<number, { label: string; run: PlannedRun }>;
  /**
   * The weeks checked, by key: `c:<cycle>` for a cycle's template week (null
   * for a rotation cycle, which has no fixed week), `c:<cycle>:<monday>` for
   * each calendar week of a cycle's dated sessions, `s:<monday>` for a week a
   * session change touches.
   */
  weeks: Map<string, WeekSession[] | null>;
  /** The Monday of a key's calendar week, when it is not this week: the message names it. */
  labels?: Map<string, string>;
  /**
   * Sessions by day for the placed-session rules (heavy legs, readiness,
   * strength per week): `c:<cycle>` for a cycle (its dated range, or its
   * template week as a loop), `s:<monday>` for a week a session change
   * touches. Rotation cycles have none.
   */
  placed?: Map<string, PlacedGroup>;
};

export async function planFacts(
  ex: Executor,
  scope: LimitScope,
  share: number | null = null,
  /** Cycles checked on their dated calendar week; the rest on the template's week. */
  dated: ReadonlySet<number> = new Set(),
  /** Today's planned sessions already done (LimitContext.doneToday). */
  doneToday?: ReadonlySet<number>,
): Promise<PlanFacts> {
  const weeks = new Map<string, WeekSession[] | null>();
  const labels = new Map<string, string>();
  const placed = new Map<string, PlacedGroup>();
  for (const id of scope.cycleIds) {
    const group = dated.has(id) ? await datedCycleGroup(ex, id, doneToday) : await templateGroup(ex, id, share);
    if (group) placed.set(`c:${id}`, group);
    if (!dated.has(id)) {
      weeks.set(`c:${id}`, await cycleWeekSessions(ex, id));
      continue;
    }
    // Every calendar week from this Monday to the block's end (review, round 3):
    // a template change rewrites them all, so any of them can get worse.
    const { thisMonday, byWeek } = await datedCycleWeeks(ex, id);
    for (const [monday, week] of byWeek) {
      weeks.set(`c:${id}:${monday}`, week);
      if (monday !== thisMonday) labels.set(`c:${id}:${monday}`, monday);
    }
  }
  const sessionUser = scope.sessionWeeks?.userId;
  const thisMonday = sessionUser ? await mondayToday(ex, sessionUser) : null;
  for (const monday of scope.sessionWeeks?.mondays ?? []) {
    weeks.set(`s:${monday}`, await calendarWeekSessions(ex, sessionUser!, monday));
    placed.set(`s:${monday}`, await weekGroup(ex, sessionUser!, monday, doneToday));
    if (monday !== thisMonday) labels.set(`s:${monday}`, monday);
  }
  const runs = await programRuns(ex, scope.programIds, share);
  // The runs of the cycles' library workout slots (review 3), keyed apart from programs and sessions.
  if (scope.cycleIds.length) {
    const { estimateWorkout, parseWorkout } = await import("@/lib/utils/workout-steps");
    const slotWorkouts = await ex
      .selectDistinct({ id: workouts.id, workout: workouts.workout })
      .from(trainingCycleSlots)
      .innerJoin(workouts, and(eq(workouts.id, trainingCycleSlots.workoutId), isNull(workouts.deletedAt)))
      .where(and(inArray(trainingCycleSlots.trainingCycleId, scope.cycleIds), isNull(trainingCycleSlots.programId)));
    for (const w of slotWorkouts) {
      const p = parseWorkout(w.workout);
      if (!p.ok || p.workout.sport !== "run") continue;
      const est = estimateWorkout(p.workout);
      runs.set(-1_000_000_000 - w.id, { label: `Run "${p.workout.name}"`, run: { durationS: est.durationSeconds, distanceM: est.distanceMeters } });
    }
  }
  // A dated session's own workout run, keyed by minus its id so it never meets a program id.
  for (const id of scope.sessionWeeks?.sessionIds ?? []) {
    const [row] = await ex.select({ workout: plannedSessions.workout, label: plannedSessions.label }).from(plannedSessions).where(and(eq(plannedSessions.id, id), livePlannedSessions));
    if (row?.workout == null) continue;
    const { estimateWorkout, parseWorkout } = await import("@/lib/utils/workout-steps");
    const p = parseWorkout(row.workout);
    if (!p.ok || p.workout.sport !== "run") continue;
    const est = estimateWorkout(p.workout);
    runs.set(-id, { label: `Run "${p.workout.name}"`, run: { durationS: est.durationSeconds, distanceM: est.distanceMeters } });
  }
  return { runs, weeks, labels, placed };
}

/**
 * The weekly load ramp over the groups a write touches: each dated group's
 * calendar weeks from its first Monday, or a template week laid on this week
 * (from today) and the next. A group's sessions are projected alone, as the
 * other rules read them.
 */
function rampHit(start: RampStart, before: ReadonlyMap<string, PlacedGroup>, after: ReadonlyMap<string, PlacedGroup>): BrokenLimit | null {
  const thisMonday = mondayOfDay(start.today);
  const laid = (g: PlacedGroup): { sessions: PlacedSession[]; mondays: string[] } => {
    if (!g.loop) {
      const mondays: string[] = [];
      for (let m = mondayOfDay(g.from); m <= g.to; m = addDay(m, 7)) if (addDay(m, 6) >= start.today) mondays.push(m);
      return { sessions: [...(g.lead ?? []), ...g.sessions], mondays };
    }
    const next = addDay(thisMonday, 7);
    const sessions = [thisMonday, next].flatMap((m) =>
      g.sessions.map((s) => ({ ...s, date: addDay(m, dowOfDay(s.date) - 1) })).filter((s) => s.date >= start.today),
    );
    return { sessions, mondays: [thisMonday, next] };
  };
  const hits: BrokenLimit[] = [];
  for (const [k, g] of after) {
    const a = laid(g);
    const b = before.get(k);
    const bl = b ? laid(b) : null;
    const hit = weeklyLoadRamp(bl ? weeklyRamps(start, bl.sessions, bl.mondays) : new Map(), weeklyRamps(start, a.sessions, a.mondays), thisMonday);
    if (hit) hits.push(hit);
  }
  if (!hits.length) return null;
  return hits.length === 1 ? hits[0] : { ...hits[0], message: hits.map((h) => h.message).join(" "), numbers: { groups: hits.map((h) => h.numbers) } };
}

const addDay = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const dowOfDay = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const mondayOfDay = (d: string) => addDay(d, 1 - dowOfDay(d));

export const NO_FACTS: PlanFacts = { runs: new Map(), weeks: new Map() };

// ── Evaluating ──────────────────────────────────────────────────────────────

export type LimitOverride = { rules: LimitRule[]; reason: string | null };

/** The limits on one write: what blocks it, and what to store on its revisions. */
export function evaluateLimits(
  lc: LimitContext,
  before: PlanFacts,
  after: PlanFacts,
  override: LimitOverride,
): { blocking: BrokenLimit[]; check: LimitCheck; unusedOverrides: LimitRule[] } {
  const checked: LimitRule[] = [];
  const notChecked: LimitNotChecked[] = [];
  const broken: BrokenLimit[] = [];

  if (!lc.endurance) {
    for (const rule of LIMIT_RULES) notChecked.push({ rule, why: NO_ENDURANCE });
  } else {
    if (lc.runs) {
      checked.push("long_run_cap");
      const changes = [...after.runs].map(([id, a]) => ({
        label: a.label,
        before: before.runs.get(id)?.run ?? { durationS: 0, distanceM: 0 },
        after: a.run,
      }));
      const hit = longRunCap(changes, lc.runs);
      if (hit) broken.push(hit);
    } else {
      notChecked.push({ rule: "long_run_cap", why: lc.runsWhy ?? NO_GARMIN });
    }
    const weeks = [...after.weeks].filter((e): e is [string, WeekSession[]] => e[1] != null);
    if (weeks.length) {
      checked.push("hard_sessions_per_week");
      const hits = weeks
        .map(([key, week]) => {
          const hit = hardSessionsPerWeek(before.weeks.get(key) ?? [], week);
          const monday = after.labels?.get(key);
          return hit && monday ? { ...hit, message: hit.message.replace("This week", `The week of ${monday}`), numbers: { ...hit.numbers, week: monday } } : hit;
        })
        .filter((h): h is BrokenLimit => h != null);
      // One result per rule, so one override covers it.
      if (hits.length) {
        const shown = hits.slice(0, 3).map((h) => h.message);
        if (hits.length > 3) shown.push(`And ${hits.length - 3} more weeks.`);
        broken.push({ ...hits[0], message: shown.join(" "), numbers: hits.length > 1 ? { weeks: hits.map((h) => h.numbers) } : hits[0].numbers });
      }
    } else {
      notChecked.push({
        rule: "hard_sessions_per_week",
        why: after.weeks.size
          ? "Rotation cycles have no fixed week, so hard sessions per week are not counted."
          : "The change is not in a weekday cycle that is active, scheduled or being started.",
      });
    }
    // The placed-session rules (docs/plans/limits-strength-readiness.md, 3.2-4)
    // run when the write touches a weekday cycle's days; otherwise they have
    // nothing to look at and are not listed.
    const placedAfter = after.placed ?? new Map<string, PlacedGroup>();
    const placedBefore = before.placed ?? new Map<string, PlacedGroup>();
    if (placedAfter.size) {
      checked.push("heavy_legs_before_key");
      const legs = heavyLegsBeforeKey(placedBefore, placedAfter);
      if (legs) broken.push(legs);

      if ([...placedAfter.values()].some((g) => !g.loop)) {
        if (lc.readinessWhy || lc.readiness === undefined || !lc.today) {
          notChecked.push({ rule: "hard_after_low_readiness", why: lc.readinessWhy ?? NO_READINESS });
        } else {
          checked.push("hard_after_low_readiness");
          const hit = lc.readiness ? hardAfterLowReadiness(placedBefore, placedAfter, lc.readiness, lc.today) : null;
          if (hit) broken.push(hit);
        }
      }

      const phased = [...placedAfter.values()].some((g) => Object.values(g.cycles).some((c) => c.phaseType));
      if (!lc.strengthGoal) notChecked.push({ rule: "strength_per_week", why: NO_STRENGTH_GOAL });
      else if (!phased) notChecked.push({ rule: "strength_per_week", why: NO_PHASE });
      else {
        checked.push("strength_per_week");
        const hit = strengthPerWeek(placedBefore, placedAfter, lc.strengthGoal);
        if (hit) broken.push(hit);
      }

      if (!lc.load || !lc.today) notChecked.push({ rule: "weekly_load_ramp", why: lc.loadWhy ?? NO_LOAD });
      else {
        checked.push("weekly_load_ramp");
        const hit = rampHit(lc.load, placedBefore, placedAfter);
        if (hit) broken.push(hit);
      }
    }
  }

  const { remaining, overridden, unused } = remainingAfterOverride(broken, override.rules);
  return {
    blocking: remaining,
    unusedOverrides: unused,
    check: {
      v: 1,
      checked,
      notChecked,
      passed: checked.filter((r) => !broken.some((b) => b.rule === r)),
      overridden,
      overrideReason: overridden.length ? override.reason : null,
      warnings: [],
    },
  };
}

/**
 * The limits on a block's first week as it will run, against nothing planned
 * before: what a start is checked on (as manage_training_cycle `start`).
 */
export async function startCheck(userId: string, cycleId: number, override: LimitOverride) {
  const lc = await limitContext(userId);
  const scoped = lc.endurance ? await cycleScope(cycleId, 1) : null;
  const after = scoped ? await planFacts(db, scoped.scope, scoped.share, new Set(), lc.doneToday) : NO_FACTS;
  return { lc, ...evaluateLimits(lc, NO_FACTS, after, override) };
}

/** A start the app makes by itself (a scheduled or chained start): the limits as warnings, or null with the switch off. */
export async function limitStartWarnings(userId: string, cycleId: number): Promise<LimitCheck | null> {
  const { lc, blocking, check } = await startCheck(userId, cycleId, NO_OVERRIDE);
  return lc.endurance ? asWarnings(check, blocking) : null;
}

export type LimitMode = "check" | "warn";

/** No override: what the app's own writes and restores pass. */
export const NO_OVERRIDE: LimitOverride = { rules: [], reason: null };

/** A check whose broken limits are warnings, never blocks (T4). */
export function asWarnings(check: LimitCheck, broken: BrokenLimit[]): LimitCheck {
  return { ...check, warnings: broken, passed: check.checked.filter((r) => !broken.some((b) => b.rule === r)) };
}

/** Thrown inside a plan write so a write that breaks a limit rolls back with nothing applied. */
export class LimitRefusedError extends Error {
  constructor(readonly blocking: BrokenLimit[]) {
    super("Training limit");
  }
}

/**
 * Run a write inside a plan write with the limits around it: the plan before
 * and after, read in the same transaction. A broken limit that is not
 * overridden throws LimitRefusedError, which rolls the whole write back. The
 * check is stored on the write's revisions.
 *
 * In `warn` mode (T4: writes the app makes, such as the weekly sync) nothing
 * is refused: the broken limits are stored as warnings. With the endurance
 * switch off nothing is read and nothing is stored, so a lifter's revisions
 * do not change.
 */
export async function withLimits<T>(
  w: PlanWriteSession,
  lc: LimitContext,
  scope: LimitScope,
  override: LimitOverride,
  write: () => Promise<T>,
  mode: LimitMode = "check",
): Promise<{ result: T; check: LimitCheck; unusedOverrides: LimitRule[] }> {
  if (mode === "warn") {
    if (!lc.endurance) {
      const result = await write();
      return { result, check: evaluateLimits(lc, NO_FACTS, NO_FACTS, NO_OVERRIDE).check, unusedOverrides: [] };
    }
    const dated = await datedCycles(w.tx, scope.cycleIds);
    const before = await planFacts(w.tx, scope, null, dated, lc.doneToday);
    const result = await write();
    if (dated.size) await w.regenerateSessions();
    const after = await planFacts(w.tx, scope, null, dated, lc.doneToday);
    const { blocking, check } = evaluateLimits(lc, before, after, NO_OVERRIDE);
    const warned = asWarnings(check, blocking);
    w.ctx.limitCheck = warned;
    return { result, check: warned, unusedOverrides: [] };
  }
  // A cycle that has dated sessions is checked on them, before and after
  // (review 21); one that has none yet, on its template's week.
  const dated = lc.endurance ? await datedCycles(w.tx, scope.cycleIds) : new Set<number>();
  const before = lc.endurance ? await planFacts(w.tx, scope, null, dated, lc.doneToday) : NO_FACTS;
  const result = await write();
  // The dated sessions follow a template change before the plan is read
  // again, in the same transaction.
  if (dated.size) await w.regenerateSessions();
  const after = lc.endurance ? await planFacts(w.tx, scope, null, dated, lc.doneToday) : NO_FACTS;
  const { blocking, check, unusedOverrides } = evaluateLimits(lc, before, after, override);
  if (blocking.length) throw new LimitRefusedError(blocking);
  w.ctx.limitCheck = check;
  return { result, check, unusedOverrides };
}

/**
 * A cycle's limit scope (its live slot programs and its week) and the share
 * of peak its periodized sets run at in one week, times a volume percent.
 */
export async function cycleScope(
  cycleId: number,
  week: number,
  pct = 100,
  /** The block's settings to scale by, when a write is about to change them. */
  settings: Partial<{ durationWeeks: number; goal: "build" | "maintain"; athleteLevel: "novice" | "intermediate" | "advanced" | null }> = {},
): Promise<{ scope: LimitScope; share: number } | null> {
  const [cycle] = await db
    .select({
      durationWeeks: trainingCycles.durationWeeks,
      goal: trainingCycles.goal,
      athleteLevel: trainingCycles.athleteLevel,
      phaseType: trainingCycles.phaseType,
    })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), liveCycles));
  if (!cycle) return null;
  const slots = await db
    .select({ programId: programs.id })
    .from(trainingCycleSlots)
    .innerJoin(programs, eq(programs.id, trainingCycleSlots.programId))
    .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), livePrograms));
  const c = { ...cycle, ...settings };
  const { multiplier } = cycleLoad(c, week, c.durationWeeks);
  return {
    scope: { programIds: [...new Set(slots.map((s) => s.programId))], cycleIds: [cycleId] },
    share: multiplier * (pct / 100),
  };
}

