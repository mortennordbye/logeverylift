/**
 * Planned vs done on the server (docs/plans/workouts-and-compliance.md,
 * section 6): reads a range of dated sessions with what they plan, matches
 * them to logged workouts and (for admins) Garmin activities, and gives each
 * its state, priority and compliance. The home card, the calendar, MCP and
 * the weekly sync all read through `sessionCompliance`, so they agree.
 *
 * Plain server code: callers resolve the user first. The rules are pure, in
 * src/lib/utils/session-compliance.ts.
 */

import { db } from "@/db";
import {
  athleteThresholds,
  exercises,
  garminActivities,
  illnessPeriods,
  programExercises,
  programSets,
  programs,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import { sportOf } from "@/lib/garmin/analytics/sport";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { plannedRowsInRange, type PlannedRow } from "@/lib/planned-sessions";
import { hardPrograms } from "@/lib/training-limits";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { matchPlanned } from "@/lib/utils/planned-sessions";
import {
  complianceBand,
  complianceRatio,
  effectivePriorities,
  inIllness,
  matchEndurance,
  pairGarmin,
  sessionState,
  type ComplianceBand,
  type GarminCandidate,
  type IllnessPeriod,
  type MatchedBy,
  type SessionState,
  type Sport,
} from "@/lib/utils/session-compliance";
import { currentThresholds } from "@/lib/utils/thresholds";
import { describeWorkout, estimateWorkout, isHardWorkout, parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

export type Amount = { durationSeconds: number | null; distanceMeters: number | null };

export type SessionCompliance = {
  id: number;
  cycleId: number;
  date: string;
  position: number;
  programId: number | null;
  programName: string | null;
  label: string | null;
  sport: Sport | null;
  /** The stored priority, null = derived. */
  storedPriority: "key" | "support" | "optional" | null;
  priority: "key" | "support" | "optional";
  hard: boolean;
  workout: Workout | null;
  workoutSummary: string | null;
  brickParentId: number | null;
  planned: Amount;
  state: SessionState;
  matchedBy: MatchedBy | null;
  loggedSessionId: number | null;
  garminActivityId: number | null;
  done: Amount | null;
  ratio: number | null;
  ratioBy: "duration" | "distance" | null;
  band: ComplianceBand | null;
  missedReason: string | null;
  skipReason: string | null;
  status: PlannedRow["status"];
  statusOn: string | null;
  illnessId: number | null;
  touched: boolean;
  version: number;
};

/** The current threshold values of a user, metric, by kind. */
export async function thresholdValues(userId: string): Promise<ThresholdValues> {
  const rows = await db.select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, userId), isNull(athleteThresholds.deletedAt)));
  const cur = currentThresholds(rows);
  return Object.fromEntries(Object.entries(cur).map(([k, r]) => [k, r!.value])) as ThresholdValues;
}

/** A stored workout, parsed; null (and logged) when it does not pass the schema, which should never happen. */
export function storedWorkout(json: unknown, id: number): Workout | null {
  if (json == null) return null;
  const r = parseWorkout(json);
  if (r.ok) return r.workout;
  console.error("[workouts] invalid_stored", { id });
  return null;
}

/** Per program: its sport (one discipline for every exercise) and the planned time and distance of those sets. */
async function programFacts(programIds: number[]) {
  const out = new Map<number, { sport: Sport | null; planned: Amount }>();
  if (!programIds.length) return out;
  const rows = await db
    .select({
      programId: programExercises.programId,
      discipline: exercises.discipline,
      durationSeconds: programSets.durationSeconds,
      distanceMeters: programSets.distanceMeters,
    })
    .from(programExercises)
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .leftJoin(programSets, and(eq(programSets.programExerciseId, programExercises.id), liveProgramSets))
    .where(and(inArray(programExercises.programId, programIds), liveProgramExercises, livePrograms));
  for (const id of programIds) {
    const mine = rows.filter((r) => r.programId === id);
    const disciplines = new Set(mine.map((r) => r.discipline));
    const sport = disciplines.size === 1 && !disciplines.has(null) ? ([...disciplines][0] as Sport) : null;
    const sum = (k: "durationSeconds" | "distanceMeters") => mine.reduce((a, r) => a + (r[k] ?? 0), 0) || null;
    out.set(id, { sport, planned: sport ? { durationSeconds: sum("durationSeconds"), distanceMeters: sum("distanceMeters") } : { durationSeconds: null, distanceMeters: null } });
  }
  return out;
}

/** The sport of each program (null for strength or mixed), for the home screen's split. */
export async function programSports(programIds: number[]): Promise<Map<number, Sport | null>> {
  const facts = await programFacts([...new Set(programIds)]);
  return new Map([...facts].map(([id, f]) => [id, f.sport]));
}

/** Completed workouts in [from, to] or linked to these rows, with time and distance per discipline. */
async function completedWithDisciplines(userId: string, from: string, to: string, rowIds: number[]) {
  const sessions = await db
    .select({
      id: workoutSessions.id,
      date: workoutSessions.date,
      intendedDate: workoutSessions.intendedDate,
      programId: workoutSessions.programId,
      plannedSessionId: workoutSessions.plannedSessionId,
      readiness: workoutSessions.readiness,
      source: workoutSessions.source,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        or(
          and(gte(workoutSessions.date, from), lte(workoutSessions.date, to)),
          and(gte(workoutSessions.intendedDate, from), lte(workoutSessions.intendedDate, to)),
          rowIds.length ? inArray(workoutSessions.plannedSessionId, rowIds) : undefined,
        ),
      ),
    );
  const sets = sessions.length
    ? await db
        .select({ sessionId: workoutSets.sessionId, discipline: exercises.discipline, durationSeconds: workoutSets.durationSeconds, distanceMeters: workoutSets.distanceMeters, rpe: workoutSets.rpe })
        .from(workoutSets)
        .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
        .where(inArray(workoutSets.sessionId, sessions.map((s) => s.id)))
    : [];
  return sessions.map((s) => {
    const mine = sets.filter((x) => x.sessionId === s.id);
    const bySport = new Map<Sport, Amount>();
    for (const x of mine) {
      if (!x.discipline) continue;
      const a = bySport.get(x.discipline) ?? { durationSeconds: null, distanceMeters: null };
      if (x.durationSeconds != null) a.durationSeconds = (a.durationSeconds ?? 0) + x.durationSeconds;
      if (x.distanceMeters != null) a.distanceMeters = (a.distanceMeters ?? 0) + x.distanceMeters;
      bySport.set(x.discipline, a);
    }
    return { ...s, bySport, disciplines: new Set(bySport.keys()), rpe: mine.map((x) => x.rpe), setCount: mine.length };
  });
}

/** The user's live sick periods. */
export async function illnessOf(userId: string): Promise<IllnessPeriod[]> {
  const rows = await db
    .select({ id: illnessPeriods.id, startedOn: illnessPeriods.startedOn, endedOn: illnessPeriods.endedOn, severity: illnessPeriods.severity })
    .from(illnessPeriods)
    .where(and(eq(illnessPeriods.userId, userId), isNull(illnessPeriods.deletedAt)));
  return rows;
}

/**
 * Garmin activities of [from, to] as candidates (admins; the caller checks).
 * The day is the activity's local start date, as the Garmin pages use.
 */
export async function garminCandidates(userId: string, from: string | null, to: string | null, ids?: number[]): Promise<GarminCandidate[]> {
  const rows = await db
    .select({ id: garminActivities.id, start: garminActivities.startTimeLocal, type: garminActivities.activityType, data: garminActivities.data })
    .from(garminActivities)
    .where(
      and(
        eq(garminActivities.userId, userId),
        from != null ? gte(garminActivities.startTimeLocal, new Date(`${from}T00:00:00Z`)) : undefined,
        to != null ? lte(garminActivities.startTimeLocal, new Date(`${to}T23:59:59Z`)) : undefined,
        ids ? inArray(garminActivities.id, ids) : undefined,
      ),
    );
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { id: r.id, date: r.start.toISOString().slice(0, 10), sport: sportOf(r.type), durationS: num(d.duration) ?? 0, distanceM: num(d.distance) };
  });
}

/**
 * The dated sessions of weekday cycles in [from, to], each with its state,
 * priority and compliance. `cycleId` reads one cycle.
 */
export async function sessionCompliance(userId: string, from: string, to: string, opts: { cycleId?: number } = {}): Promise<SessionCompliance[]> {
  const today = toDateStr(await userToday(userId));
  const [endurance, settings] = await Promise.all([enduranceEnabledFor(userId), getUserSettings(userId)]);
  const garmin = endurance && (await garminAllowedFor(userId));
  const rows = await plannedRowsInRange(db, userId, from, to, opts.cycleId);
  if (!rows.length) return [];
  const thresholds = endurance ? await thresholdValues(userId) : {};

  const programIds = [...new Set(rows.map((r) => r.row.programId).filter((id): id is number => id != null))];
  const [facts, hard] = await Promise.all([programFacts(programIds), hardPrograms(db, programIds)]);

  const views = rows.map(({ row, programName, programDeletedAt }) => {
    const workout = storedWorkout(row.workout, row.id);
    const programId = programDeletedAt ? null : row.programId;
    const pf = programId != null ? facts.get(programId) : undefined;
    const sport: Sport | null = workout ? workout.sport : (pf?.sport ?? null);
    const est = workout ? estimateWorkout(workout, thresholds) : null;
    const planned: Amount = est
      ? { durationSeconds: est.durationComplete && est.durationSeconds ? est.durationSeconds : null, distanceMeters: est.distanceComplete && est.distanceMeters ? est.distanceMeters : null }
      : (pf?.planned ?? { durationSeconds: null, distanceMeters: null });
    return {
      row,
      programId,
      programName: programDeletedAt ? null : programName,
      workout,
      sport,
      planned,
      hard: workout ? isHardWorkout(workout, thresholds) : programId != null ? (hard.get(programId) ?? false) : false,
    };
  });

  const until = to < today ? to : today;
  const completed = await completedWithDisciplines(userId, from, until, rows.map((r) => r.row.id));
  const matchable = views.filter((v) => v.row.status === "planned");
  // With the switch off, C2's matcher exactly (lifters see no change).
  const match = endurance
    ? matchEndurance(
        matchable.map((v) => ({ id: v.row.id, date: v.row.date!, position: v.row.position, programId: v.programId, sport: v.sport })),
        completed,
      )
    : matchPlanned(
        matchable.map((v) => ({ id: v.row.id, date: v.row.date!, position: v.row.position, programId: v.programId })),
        completed,
      );
  // A link counts whatever the status (6.2 step 1).
  const linkedTo = new Map<number, number>();
  for (const c of completed) if (c.plannedSessionId != null) linkedTo.set(c.plannedSessionId, c.id);

  const activities = garmin ? await garminCandidates(userId, from, until) : [];
  const picks = new Set(views.map((v) => v.row.garminActivityId).filter((id): id is number => id != null));
  // A logged workout of a sport on a day stands for one Garmin activity of that sport that day.
  const takenByApp = new Set<number>();
  for (const v of views) {
    const m = match.get(v.row.id) ?? (linkedTo.has(v.row.id) ? { sessionId: linkedTo.get(v.row.id)! } : undefined);
    if (!m || !v.sport) continue;
    const a = activities.find((x) => !takenByApp.has(x.id) && !picks.has(x.id) && x.date === v.row.date && x.sport === v.sport);
    if (a) takenByApp.add(a.id);
  }
  const garminMatch = garmin
    ? pairGarmin(
        views
          .filter((v) => v.sport && v.row.status === "planned" && !match.has(v.row.id) && !linkedTo.has(v.row.id) && v.row.garminActivityId == null && v.row.date! <= today)
          .map((v) => ({ id: v.row.id, date: v.row.date!, position: v.row.position, sport: v.sport!, plannedDurationS: v.planned.durationSeconds, plannedDistanceM: v.planned.distanceMeters })),
        activities,
        new Set([...picks, ...takenByApp]),
      )
    : new Map<number, number>();
  const actById = new Map(activities.map((a) => [a.id, a]));
  const missingPicks = [...picks].filter((id) => !actById.has(id));
  if (garmin && missingPicks.length) for (const a of await garminCandidates(userId, null, null, missingPicks)) actById.set(a.id, a);

  const illness = endurance ? await illnessOf(userId) : [];
  const priorities = effectivePriorities(
    views.map((v) => ({ id: v.row.id, date: v.row.date!, sport: v.sport, hard: v.hard, plannedDurationS: v.planned.durationSeconds, stored: v.row.priority })),
  );

  return views.map((v) => {
    const r = v.row;
    const linkedId = linkedTo.get(r.id) ?? null;
    const m = match.get(r.id);
    const gId = garminMatch.get(r.id);
    const { state, matchedBy } = sessionState({
      date: r.date!,
      today,
      status: r.status,
      sport: v.sport,
      endurance,
      linked: linkedId != null,
      picked: r.garminActivityId != null,
      appMatched: m != null,
      garminMatched: gId != null,
      inIllness: inIllness(r.date!, illness),
    });
    const loggedSessionId = matchedBy === "link" ? linkedId : matchedBy === "app" ? (m?.sessionId ?? null) : null;
    const garminActivityId = matchedBy === "pick" ? r.garminActivityId : matchedBy === "garmin" ? (gId ?? null) : null;
    let done: Amount | null = null;
    if (loggedSessionId != null && v.sport) {
      done = completed.find((c) => c.id === loggedSessionId)?.bySport.get(v.sport) ?? null;
    } else if (garminActivityId != null) {
      const a = actById.get(garminActivityId);
      if (a) done = { durationSeconds: a.durationS || null, distanceMeters: a.distanceM };
    }
    const ratio = state === "done" && done ? complianceRatio(v.planned, done) : null;
    const band = complianceBand(state === "unconfirmed" ? "planned" : state === "sick" ? "planned" : state, ratio?.ratio ?? null);
    const period = illness.find((p) => r.date! >= p.startedOn && (p.endedOn == null || r.date! <= p.endedOn));
    return {
      id: r.id,
      cycleId: r.cycleId,
      date: r.date!,
      position: r.position,
      programId: v.programId,
      programName: v.programName,
      label: r.label,
      sport: v.sport,
      storedPriority: r.priority,
      priority: priorities.get(r.id)!,
      hard: v.hard,
      workout: v.workout,
      workoutSummary: v.workout ? describeWorkout(v.workout, settings.units) : null,
      brickParentId: r.brickParentId,
      planned: v.planned,
      state,
      matchedBy,
      loggedSessionId,
      garminActivityId,
      done,
      ratio: ratio?.ratio ?? null,
      ratioBy: ratio?.by ?? null,
      band,
      missedReason: r.missedReason,
      skipReason: r.skipReason,
      status: r.status,
      statusOn: r.statusOn,
      illnessId: endurance && period ? period.id : null,
      touched: r.touchedAt != null,
      version: r.version,
    };
  });
}
