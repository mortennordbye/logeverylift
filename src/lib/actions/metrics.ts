"use server";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { exercisePrs, exercises, trainingCycles, workoutSessions, workoutSets } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import {
  DISCIPLINES,
  DISCIPLINE_CONFIG,
  type Discipline,
  type PaceFormatter,
} from "@/lib/utils/discipline";
import { ActionResult } from "@/types/workout";

// ── Types ──────────────────────────────────────────────────────────────────

export type WeeklyMetric = {
  weekStart: string; // ISO date string (Monday)
  volumeKg: number;
  sessionCount: number;
};

export type PersonalRecord = {
  exerciseId: number;
  exerciseName: string;
  muscleGroup: string | null;
  maxWeightKg: number;
};

/**
 * Sets logged this ISO week per muscle group, with the AI-prompt-derived
 * 10–20 working-sets-per-muscle-per-week target range. Used for the
 * "did I hit volume?" audit on the metrics page.
 *
 * Note: counts ALL completed sets (warmup + working). The AI target is on
 * working sets, so this slightly over-reports — but `setType` lives on
 * `program_sets`, not `workout_sets`, so we can't filter cleanly without a
 * schema change. See BACKLOG.
 */
export type WeeklyMuscleVolume = {
  muscleGroup: string;
  setCount: number;
  /** Recommended lower bound (10 working sets/week per muscle). */
  targetMin: number;
  /** Recommended upper bound (20 working sets/week — junk-volume territory above). */
  targetMax: number;
};

export type PrFeedEntry = {
  id: number;
  exerciseId: number;
  exerciseName: string;
  prType: "weight" | "reps_at_weight" | "estimated_1rm" | "distance" | "pace";
  value: number;
  weightKg: number | null;
  /** Endurance context: the exercise's discipline (null for strength). */
  discipline: Discipline | null;
  /** Endurance context: the effort's distance in meters (set for "pace"). */
  distanceMeters: number | null;
  /** Endurance context: distance bracket label, e.g. "5 km" (set for "pace"). */
  bracket: string | null;
  achievedAt: string; // ISO timestamp
  isCurrent: boolean; // true when supersededAt is null
};

export type MuscleBalance = {
  muscleGroup: string;
  setCount: number;
};

export type MoodDistribution = {
  feeling: "Tired" | "OK" | "Good" | "Awesome";
  count: number;
};

export type ExerciseProgress = {
  date: string;
  maxWeightKg: number;
  repsAtMaxWeight: number;
  totalVolume: number;
};

export type MetricsData = {
  weekly: WeeklyMetric[];
  personalRecords: PersonalRecord[];
  muscleBalance: MuscleBalance[];
  moodDistribution: MoodDistribution[];
};

export type SummaryStats = {
  totalSessions: number;
  currentStreakWeeks: number;
  avgSessionDurationMinutes: number;
  lifetimeVolumeKg: number;
};

export type TopProgressingExercise = {
  exerciseId: number;
  exerciseName: string;
  muscleGroup: string | null;
  gainKg: number;
  gainPct: number;
  current1RM: number;
  baseline1RM: number;
};

export type CyclePickerItem = {
  id: number;
  name: string;
  status: "draft" | "active" | "completed";
  startDate: string | null;
  endDate: string | null;
  durationWeeks: number;
  sessionCount: number;
};

export type RpeTrendPoint = {
  weekStart: string;
  weekIndex: number;
  avgRpe: number | null;
  sessionCount: number;
};

export type CycleSummaryStats = {
  sessionCount: number;
  totalVolumeKg: number;
  avgSessionDurationMinutes: number;
  sessionsPerWeek: number;
};

export type CycleMetrics = {
  summary: CycleSummaryStats;
  weekly: WeeklyMetric[];
  muscleBalance: MuscleBalance[];
  moodDistribution: MoodDistribution[];
  topGains: TopProgressingExercise[];
  rpeTrend: RpeTrendPoint[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns Monday of the week containing `from`, offset by `weeksAgo`. */
function getMondayOffset(from: Date, weeksAgo: number): string {
  const d = new Date(from);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff - weeksAgo * 7);
  return d.toISOString().split("T")[0];
}

/** Fills missing weeks with zero-value entries so the chart always shows 8 bars. */
function fillWeeklyGaps(rows: WeeklyMetric[], weeks = 8): WeeklyMetric[] {
  const today = new Date();
  const byWeek = new Map(rows.map((r) => [r.weekStart, r]));
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = getMondayOffset(today, weeks - 1 - i);
    return byWeek.get(weekStart) ?? { weekStart, volumeKg: 0, sessionCount: 0 };
  });
}

/** Counts consecutive weeks with workouts, starting from the most recent week. */
function computeStreakWeeks(weekStarts: string[]): number {
  if (weekStarts.length === 0) return 0;

  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(today);
  currentMonday.setDate(today.getDate() + diff);
  const currentMondayStr = currentMonday.toISOString().split("T")[0];

  let streak = 0;
  let expectedMonday = currentMondayStr;

  for (const weekStart of weekStarts) {
    if (weekStart === expectedMonday) {
      streak++;
      const d = new Date(expectedMonday + "T00:00:00");
      d.setDate(d.getDate() - 7);
      expectedMonday = d.toISOString().split("T")[0];
    } else if (expectedMonday === currentMondayStr) {
      // Current week not yet trained — try previous week
      const d = new Date(expectedMonday + "T00:00:00");
      d.setDate(d.getDate() - 7);
      expectedMonday = d.toISOString().split("T")[0];
      if (weekStart === expectedMonday) {
        streak++;
        const d2 = new Date(expectedMonday + "T00:00:00");
        d2.setDate(d2.getDate() - 7);
        expectedMonday = d2.toISOString().split("T")[0];
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return streak;
}

/** Returns the ISO date strings for a half-open cycle interval [start, end). */
function getCycleDateRange(
  startDate: string,
  durationWeeks: number,
): { start: string; end: string } {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + durationWeeks * 7);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

/** Snaps a date to the Monday of its ISO week. */
function snapToMonday(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon.toISOString().split("T")[0];
}

/** Fills all cycle weeks (exactly durationWeeks buckets, each snapped to Monday). */
function fillCycleWeeks(
  rows: WeeklyMetric[],
  cycleStartDate: string,
  durationWeeks: number,
): WeeklyMetric[] {
  const byWeek = new Map(rows.map((r) => [r.weekStart, r]));
  return Array.from({ length: durationWeeks }, (_, i) => {
    const d = new Date(cycleStartDate + "T00:00:00");
    d.setDate(d.getDate() + i * 7);
    const weekStart = snapToMonday(d);
    return byWeek.get(weekStart) ?? { weekStart, volumeKg: 0, sessionCount: 0 };
  });
}

type TopGainRow = {
  exerciseId: number;
  exerciseName: string;
  muscleGroup: string | null;
  sessionDate: string;
  session1RM: number;
};

/** Shared JS logic: takes per-session 1RM rows and returns top 5 gaining exercises. */
function computeTopGains(rows: TopGainRow[]): TopProgressingExercise[] {
  const byExercise = new Map<
    number,
    { exerciseName: string; muscleGroup: string | null; sessions: { date: string; est1RM: number }[] }
  >();

  for (const row of rows) {
    if (!byExercise.has(row.exerciseId)) {
      byExercise.set(row.exerciseId, {
        exerciseName: row.exerciseName,
        muscleGroup: row.muscleGroup ?? null,
        sessions: [],
      });
    }
    byExercise.get(row.exerciseId)!.sessions.push({
      date: row.sessionDate,
      est1RM: Number(row.session1RM),
    });
  }

  const results: TopProgressingExercise[] = [];
  for (const [exerciseId, info] of byExercise) {
    if (info.sessions.length < 2) continue;
    const baseline1RM = info.sessions[0].est1RM;
    const current1RM = info.sessions[info.sessions.length - 1].est1RM;
    const gainKg = current1RM - baseline1RM;
    if (gainKg <= 0) continue;
    const gainPct = (gainKg / baseline1RM) * 100;
    results.push({
      exerciseId,
      exerciseName: info.exerciseName,
      muscleGroup: info.muscleGroup,
      gainKg: Math.round(gainKg * 10) / 10,
      gainPct: Math.round(gainPct * 10) / 10,
      current1RM: Math.round(current1RM * 10) / 10,
      baseline1RM: Math.round(baseline1RM * 10) / 10,
    });
  }

  return results.sort((a, b) => b.gainPct - a.gainPct).slice(0, 5);
}

// ── All-time queries ───────────────────────────────────────────────────────

async function fetchWeeklyMetrics(userId: string): Promise<WeeklyMetric[]> {
  const rows = await db
    .select({
      weekStart: sql<string>`date_trunc('week', ${workoutSessions.startTime})::date`,
      sessionCount: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
      volumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
    })
    .from(workoutSessions)
    .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.startTime} >= NOW() - interval '8 weeks'`,
      ),
    )
    .groupBy(sql`date_trunc('week', ${workoutSessions.startTime})`)
    .orderBy(asc(sql`date_trunc('week', ${workoutSessions.startTime})`));

  const mapped = rows.map((r) => ({
    weekStart: r.weekStart,
    volumeKg: Number(r.volumeKg),
    sessionCount: Number(r.sessionCount),
  }));

  return fillWeeklyGaps(mapped);
}

async function fetchPersonalRecords(userId: string): Promise<PersonalRecord[]> {
  const rows = await db
    .select({
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      muscleGroup: exercises.muscleGroup,
      maxWeightKg: sql<number>`MAX(CAST(${workoutSets.weightKg} AS numeric))`,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`CAST(${workoutSets.weightKg} AS numeric) > 0`,
      ),
    )
    .groupBy(exercises.id, exercises.name, exercises.muscleGroup)
    .orderBy(desc(sql`MAX(CAST(${workoutSets.weightKg} AS numeric))`))
    .limit(20);

  return rows.map((r) => ({
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    muscleGroup: r.muscleGroup ?? null,
    maxWeightKg: Number(r.maxWeightKg),
  }));
}

async function fetchMuscleBalance(userId: string): Promise<MuscleBalance[]> {
  const rows = await db
    .select({
      muscleGroup: exercises.muscleGroup,
      setCount: sql<number>`COUNT(${workoutSets.id})`,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.startTime} >= NOW() - interval '28 days'`,
        isNotNull(exercises.muscleGroup),
      ),
    )
    .groupBy(exercises.muscleGroup)
    .orderBy(desc(sql`COUNT(${workoutSets.id})`));

  return rows
    .filter((r) => r.muscleGroup !== null)
    .map((r) => ({
      muscleGroup: r.muscleGroup!,
      setCount: Number(r.setCount),
    }));
}

async function fetchMoodDistribution(userId: string): Promise<MoodDistribution[]> {
  const rows = await db
    .select({
      feeling: workoutSessions.feeling,
      count: sql<number>`COUNT(*)`,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        isNotNull(workoutSessions.feeling),
        sql`${workoutSessions.startTime} >= NOW() - interval '28 days'`,
      ),
    )
    .groupBy(workoutSessions.feeling)
    .orderBy(desc(sql`COUNT(*)`));

  return rows
    .filter((r) => r.feeling !== null)
    .map((r) => ({
      feeling: r.feeling as "Tired" | "OK" | "Good" | "Awesome",
      count: Number(r.count),
    }));
}

// ── Cycle-scoped queries ───────────────────────────────────────────────────

async function fetchCycleSummary(
  userId: string,
  start: string,
  end: string,
  durationWeeks: number,
): Promise<CycleSummaryStats> {
  const [sessionRow] = await db
    .select({
      sessionCount: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
      totalVolumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
      avgDurationMinutes: sql<number>`AVG(
        EXTRACT(EPOCH FROM (${workoutSessions.endTime} - ${workoutSessions.startTime})) / 60
      )`,
    })
    .from(workoutSessions)
    .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        isNotNull(workoutSessions.endTime),
        sql`${workoutSessions.date} >= ${start}::date`,
        sql`${workoutSessions.date} < ${end}::date`,
      ),
    );

  const sessionCount = Number(sessionRow?.sessionCount ?? 0);
  return {
    sessionCount,
    totalVolumeKg: Number(sessionRow?.totalVolumeKg ?? 0),
    avgSessionDurationMinutes: Number(sessionRow?.avgDurationMinutes ?? 0),
    sessionsPerWeek: durationWeeks > 0 ? Math.round((sessionCount / durationWeeks) * 10) / 10 : 0,
  };
}

async function fetchCycleWeeklyVolume(
  userId: string,
  start: string,
  end: string,
  cycleStartDate: string,
  durationWeeks: number,
): Promise<WeeklyMetric[]> {
  const rows = await db
    .select({
      weekStart: sql<string>`date_trunc('week', ${workoutSessions.startTime})::date`,
      sessionCount: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
      volumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
    })
    .from(workoutSessions)
    .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.date} >= ${start}::date`,
        sql`${workoutSessions.date} < ${end}::date`,
      ),
    )
    .groupBy(sql`date_trunc('week', ${workoutSessions.startTime})`)
    .orderBy(asc(sql`date_trunc('week', ${workoutSessions.startTime})`));

  const mapped = rows.map((r) => ({
    weekStart: r.weekStart,
    volumeKg: Number(r.volumeKg),
    sessionCount: Number(r.sessionCount),
  }));

  return fillCycleWeeks(mapped, cycleStartDate, durationWeeks);
}

async function fetchCycleMuscleBalance(
  userId: string,
  start: string,
  end: string,
): Promise<MuscleBalance[]> {
  const rows = await db
    .select({
      muscleGroup: exercises.muscleGroup,
      setCount: sql<number>`COUNT(${workoutSets.id})`,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.date} >= ${start}::date`,
        sql`${workoutSessions.date} < ${end}::date`,
        isNotNull(exercises.muscleGroup),
      ),
    )
    .groupBy(exercises.muscleGroup)
    .orderBy(desc(sql`COUNT(${workoutSets.id})`));

  return rows
    .filter((r) => r.muscleGroup !== null)
    .map((r) => ({ muscleGroup: r.muscleGroup!, setCount: Number(r.setCount) }));
}

async function fetchCycleMoodDistribution(
  userId: string,
  start: string,
  end: string,
): Promise<MoodDistribution[]> {
  const rows = await db
    .select({
      feeling: workoutSessions.feeling,
      count: sql<number>`COUNT(*)`,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        isNotNull(workoutSessions.feeling),
        sql`${workoutSessions.date} >= ${start}::date`,
        sql`${workoutSessions.date} < ${end}::date`,
      ),
    )
    .groupBy(workoutSessions.feeling)
    .orderBy(desc(sql`COUNT(*)`));

  return rows
    .filter((r) => r.feeling !== null)
    .map((r) => ({
      feeling: r.feeling as MoodDistribution["feeling"],
      count: Number(r.count),
    }));
}

async function fetchCycleTopGains(
  userId: string,
  start: string,
  end: string,
): Promise<TopProgressingExercise[]> {
  const rows = await db
    .select({
      exerciseId: workoutSets.exerciseId,
      exerciseName: exercises.name,
      muscleGroup: exercises.muscleGroup,
      sessionDate: workoutSessions.date,
      session1RM: sql<number>`MAX(CAST(${workoutSets.weightKg} AS numeric) * (1 + ${workoutSets.actualReps} / 30.0))`,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.date} >= ${start}::date`,
        sql`${workoutSessions.date} < ${end}::date`,
        sql`CAST(${workoutSets.weightKg} AS numeric) > 0`,
        sql`${workoutSets.actualReps} BETWEEN 1 AND 12`,
      ),
    )
    .groupBy(workoutSets.exerciseId, exercises.name, exercises.muscleGroup, workoutSessions.date)
    .orderBy(workoutSets.exerciseId, asc(workoutSessions.date));

  return computeTopGains(
    rows.map((r) => ({
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      muscleGroup: r.muscleGroup ?? null,
      sessionDate: r.sessionDate,
      session1RM: Number(r.session1RM),
    })),
  );
}

async function fetchCycleRpeTrend(
  userId: string,
  start: string,
  end: string,
  cycleStartDate: string,
  durationWeeks: number,
): Promise<RpeTrendPoint[]> {
  const rows = await db
    .select({
      weekStart: sql<string>`date_trunc('week', ${workoutSessions.startTime})::date`,
      avgRpe: sql<number>`AVG(CAST(${workoutSets.rpe} AS numeric))`,
      sessionCount: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.date} >= ${start}::date`,
        sql`${workoutSessions.date} < ${end}::date`,
        sql`${workoutSets.rpe} > 0`,
      ),
    )
    .groupBy(sql`date_trunc('week', ${workoutSessions.startTime})`)
    .orderBy(asc(sql`date_trunc('week', ${workoutSessions.startTime})`));

  const byWeek = new Map(rows.map((r) => [r.weekStart, r]));

  return Array.from({ length: durationWeeks }, (_, i) => {
    const d = new Date(cycleStartDate + "T00:00:00");
    d.setDate(d.getDate() + i * 7);
    const weekStart = snapToMonday(d);
    const row = byWeek.get(weekStart);
    return {
      weekStart,
      weekIndex: i + 1,
      avgRpe: row ? Math.round(Number(row.avgRpe) * 10) / 10 : null,
      sessionCount: row ? Number(row.sessionCount) : 0,
    };
  });
}

// ── Cardio types ──────────────────────────────────────────────────────────

export type WeeklyCardioMetric = {
  weekStart: string;
  distanceM: number;
  sessionCount: number;
};

export type CardioHrZone = {
  zone: number;
  label: string;
  distanceM: number;
  setCount: number;
};

export type CardioPaceRecord = {
  label: string;
  distanceM: number;
  bestPaceSecPerKm: number;
  date: string;
  exerciseName: string;
};

export type CardioMetrics = {
  totalDistanceM: number;
  totalSessions: number;
  longestSingleRunM: number;
  bestPaceSecPerKm: number | null;
  weekly: WeeklyCardioMetric[];
  hrZones: CardioHrZone[];
  paceRecords: CardioPaceRecord[];
};

const HR_ZONE_LABELS: Record<number, string> = {
  1: "Z1 Recovery",
  2: "Z2 Aerobic",
  3: "Z3 Tempo",
  4: "Z4 Threshold",
  5: "Z5 VO₂Max",
};

// Distance brackets for pace PRs (label, min meters, max meters)
const PACE_BRACKETS = [
  { label: "1 km",    min: 800,   max: 1200,  rep: 1000  },
  { label: "3 km",    min: 2700,  max: 3300,  rep: 3000  },
  { label: "5 km",    min: 4700,  max: 5300,  rep: 5000  },
  { label: "10 km",   min: 9500,  max: 10500, rep: 10000 },
  { label: "Half",    min: 20000, max: 22000, rep: 21097 },
  { label: "Full",    min: 41000, max: 44000, rep: 42195 },
];

function fillWeeklyCardioGaps(rows: WeeklyCardioMetric[], weeks = 8): WeeklyCardioMetric[] {
  const today = new Date();
  const byWeek = new Map(rows.map((r) => [r.weekStart, r]));
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = getMondayOffset(today, weeks - 1 - i);
    return byWeek.get(weekStart) ?? { weekStart, distanceM: 0, sessionCount: 0 };
  });
}

export async function getCardioMetrics(): Promise<ActionResult<CardioMetrics>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    // All cardio sets with distance + duration for this user
    const allSets = await db
      .select({
        distanceMeters: workoutSets.distanceMeters,
        durationSeconds: workoutSets.durationSeconds,
        heartRateZone: workoutSets.heartRateZone,
        sessionDate: workoutSessions.date,
        sessionStartTime: workoutSessions.startTime,
        exerciseName: exercises.name,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.isCompleted, true),
          sql`${exercises.category} = 'cardio'`,
          sql`${workoutSets.distanceMeters} > 0`,
        ),
      )
      .orderBy(asc(workoutSessions.date));

    // Summary totals
    let totalDistanceM = 0;
    let longestSingleRunM = 0;
    let bestPaceSecPerKm: number | null = null;

    const sessionDistances = new Map<string, number>();
    const hrZoneMap = new Map<number, { distanceM: number; setCount: number }>();
    const weeklyMap = new Map<string, { distanceM: number; sessionCount: number; sessions: Set<string> }>();
    const paceMap = new Map<string, { bestPace: number; date: string; exerciseName: string; distanceM: number }>();

    for (const set of allSets) {
      const dist = Number(set.distanceMeters ?? 0);
      const dur = Number(set.durationSeconds ?? 0);
      if (dist <= 0) continue;

      totalDistanceM += dist;
      longestSingleRunM = Math.max(longestSingleRunM, dist);

      // Track total distance per session (for longest session)
      const sKey = `${set.sessionDate}`;
      sessionDistances.set(sKey, (sessionDistances.get(sKey) ?? 0) + dist);

      // HR zone
      if (set.heartRateZone != null) {
        const z = set.heartRateZone;
        const existing = hrZoneMap.get(z) ?? { distanceM: 0, setCount: 0 };
        hrZoneMap.set(z, { distanceM: existing.distanceM + dist, setCount: existing.setCount + 1 });
      }

      // Weekly distance
      const weekKey = set.sessionStartTime
        ? snapToMonday(new Date(set.sessionStartTime))
        : snapToMonday(new Date(set.sessionDate + "T00:00:00"));
      const wk = weeklyMap.get(weekKey) ?? { distanceM: 0, sessionCount: 0, sessions: new Set() };
      wk.distanceM += dist;
      wk.sessions.add(sKey);
      weeklyMap.set(weekKey, wk);

      // Pace PR per bracket
      if (dur > 0) {
        const paceSecPerKm = (dur / dist) * 1000;
        // Best overall pace (for runs >= 400m to filter out tiny intervals)
        if (dist >= 400) {
          if (bestPaceSecPerKm === null || paceSecPerKm < bestPaceSecPerKm) {
            bestPaceSecPerKm = paceSecPerKm;
          }
        }
        // Bracket PRs
        for (const bracket of PACE_BRACKETS) {
          if (dist >= bracket.min && dist <= bracket.max) {
            const existing = paceMap.get(bracket.label);
            if (!existing || paceSecPerKm < existing.bestPace) {
              paceMap.set(bracket.label, {
                bestPace: paceSecPerKm,
                date: set.sessionDate,
                exerciseName: set.exerciseName,
                distanceM: bracket.rep,
              });
            }
          }
        }
      }
    }

    // Build weekly array
    const weeklyRaw: WeeklyCardioMetric[] = Array.from(weeklyMap.entries()).map(([weekStart, v]) => ({
      weekStart,
      distanceM: v.distanceM,
      sessionCount: v.sessions.size,
    }));
    const weekly = fillWeeklyCardioGaps(weeklyRaw);

    // Count unique cardio sessions
    const totalSessions = sessionDistances.size;

    // HR zones array
    const hrZones: CardioHrZone[] = [1, 2, 3, 4, 5]
      .map((z) => ({
        zone: z,
        label: HR_ZONE_LABELS[z],
        distanceM: hrZoneMap.get(z)?.distanceM ?? 0,
        setCount: hrZoneMap.get(z)?.setCount ?? 0,
      }))
      .filter((z) => z.setCount > 0);

    // Pace records (only brackets with data, ordered by distance)
    const paceRecords: CardioPaceRecord[] = PACE_BRACKETS
      .filter((b) => paceMap.has(b.label))
      .map((b) => {
        const p = paceMap.get(b.label)!;
        return {
          label: b.label,
          distanceM: p.distanceM,
          bestPaceSecPerKm: Math.round(p.bestPace),
          date: p.date,
          exerciseName: p.exerciseName,
        };
      });

    return {
      success: true,
      data: {
        totalDistanceM,
        totalSessions,
        longestSingleRunM,
        bestPaceSecPerKm: bestPaceSecPerKm !== null ? Math.round(bestPaceSecPerKm) : null,
        weekly,
        hrZones,
        paceRecords,
      },
    };
  } catch (err) {
    console.error("[getCardioMetrics] failed", err);
    return { success: false, error: "Failed to load cardio metrics" };
  }
}

// ── Triathlon (per-discipline) metrics ──────────────────────────────────────

export type DisciplinePaceRecord = {
  label: string;
  /** Actual set values that produced the best pace/speed, for rendering. */
  bestDurationS: number;
  bestDistanceM: number;
  date: string;
};

export type DisciplineMetric = {
  discipline: Discipline;
  label: string;
  /** How the UI should render pace/speed for this discipline. */
  paceFormatter: PaceFormatter;
  /** "m" for swim, "km" otherwise — drives distance display. */
  inputUnit: "m" | "km";
  totalDistanceM: number;
  totalDurationS: number;
  totalSessions: number;
  weekly: WeeklyCardioMetric[];
  paceRecords: DisciplinePaceRecord[];
};

export type TriathlonMetrics = {
  /** Only disciplines that have logged data, in swim → bike → run order. */
  disciplines: DisciplineMetric[];
};

/**
 * Per-discipline swim/bike/run breakdown. Unlike getCardioMetrics (which lumps
 * all cardio together), this groups by exercises.discipline so a triathlete sees
 * each sport on its own terms with its own pace/speed unit and PR brackets.
 */
export async function getTriathlonMetrics(): Promise<ActionResult<TriathlonMetrics>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const rows = await db
      .select({
        discipline: exercises.discipline,
        distanceMeters: workoutSets.distanceMeters,
        durationSeconds: workoutSets.durationSeconds,
        sessionDate: workoutSessions.date,
        sessionStartTime: workoutSessions.startTime,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.isCompleted, true),
          isNotNull(exercises.discipline),
        ),
      )
      .orderBy(asc(workoutSessions.date));

    // Accumulators keyed by discipline
    const acc = new Map<
      Discipline,
      {
        totalDistanceM: number;
        totalDurationS: number;
        sessions: Set<string>;
        weekly: Map<string, { distanceM: number; sessions: Set<string> }>;
        bestByBracket: Map<string, { durationS: number; distanceM: number; date: string; pace: number }>;
      }
    >();

    for (const r of rows) {
      const d = r.discipline as Discipline | null;
      if (d == null) continue;
      const dist = Number(r.distanceMeters ?? 0);
      const dur = Number(r.durationSeconds ?? 0);

      const a =
        acc.get(d) ??
        {
          totalDistanceM: 0,
          totalDurationS: 0,
          sessions: new Set<string>(),
          weekly: new Map<string, { distanceM: number; sessions: Set<string> }>(),
          bestByBracket: new Map<string, { durationS: number; distanceM: number; date: string; pace: number }>(),
        };

      a.totalDistanceM += dist;
      a.totalDurationS += dur;
      const sKey = `${r.sessionDate}`;
      a.sessions.add(sKey);

      const weekKey = r.sessionStartTime
        ? snapToMonday(new Date(r.sessionStartTime))
        : snapToMonday(new Date(r.sessionDate + "T00:00:00"));
      const wk = a.weekly.get(weekKey) ?? { distanceM: 0, sessions: new Set<string>() };
      wk.distanceM += dist;
      wk.sessions.add(sKey);
      a.weekly.set(weekKey, wk);

      // Best pace/speed per bracket — lower seconds-per-meter is always better.
      if (dist > 0 && dur > 0) {
        const pace = dur / dist; // seconds per meter (unit-agnostic; lower is faster)
        for (const bracket of DISCIPLINE_CONFIG[d].paceBrackets) {
          if (dist >= bracket.min && dist <= bracket.max) {
            const existing = a.bestByBracket.get(bracket.label);
            if (!existing || pace < existing.pace) {
              a.bestByBracket.set(bracket.label, { durationS: dur, distanceM: dist, date: r.sessionDate, pace });
            }
          }
        }
      }

      acc.set(d, a);
    }

    const disciplines: DisciplineMetric[] = DISCIPLINES.filter((d) => acc.has(d)).map((d) => {
      const a = acc.get(d)!;
      const cfg = DISCIPLINE_CONFIG[d];
      const weeklyRaw: WeeklyCardioMetric[] = Array.from(a.weekly.entries()).map(([weekStart, v]) => ({
        weekStart,
        distanceM: v.distanceM,
        sessionCount: v.sessions.size,
      }));
      const paceRecords: DisciplinePaceRecord[] = cfg.paceBrackets
        .filter((b) => a.bestByBracket.has(b.label))
        .map((b) => {
          const best = a.bestByBracket.get(b.label)!;
          return { label: b.label, bestDurationS: best.durationS, bestDistanceM: best.distanceM, date: best.date };
        });
      return {
        discipline: d,
        label: cfg.label,
        paceFormatter: cfg.paceFormatter,
        inputUnit: cfg.inputUnit,
        totalDistanceM: a.totalDistanceM,
        totalDurationS: a.totalDurationS,
        totalSessions: a.sessions.size,
        weekly: fillWeeklyCardioGaps(weeklyRaw),
        paceRecords,
      };
    });

    return { success: true, data: { disciplines } };
  } catch (err) {
    console.error("[getTriathlonMetrics] failed", err);
    return { success: false, error: "Failed to load triathlon metrics" };
  }
}

// ── New metric types ───────────────────────────────────────────────────────

export type HeatmapDay = {
  date: string;
  volumeKg: number;
  sessionCount: number;
};

export type MovementPatternBalance = {
  pattern: string;
  setCount: number;
};

export type ReadinessPerformancePoint = {
  readiness: number;
  avgVolumeKg: number;
  sessionCount: number;
};

// ── New metric queries ─────────────────────────────────────────────────────

async function fetchHeatmapData(userId: string): Promise<HeatmapDay[]> {
  const rows = await db
    .select({
      date: workoutSessions.date,
      volumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
      sessionCount: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
    })
    .from(workoutSessions)
    .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.date} >= CURRENT_DATE - INTERVAL '365 days'`,
      ),
    )
    .groupBy(workoutSessions.date)
    .orderBy(asc(workoutSessions.date));

  return rows.map((r) => ({
    date: String(r.date),
    volumeKg: Number(r.volumeKg),
    sessionCount: Number(r.sessionCount),
  }));
}

async function fetchMovementPatternBalance(userId: string): Promise<MovementPatternBalance[]> {
  const rows = await db
    .select({
      pattern: exercises.movementPattern,
      setCount: sql<number>`COUNT(${workoutSets.id})`,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        sql`${workoutSessions.startTime} >= NOW() - INTERVAL '28 days'`,
        isNotNull(exercises.movementPattern),
      ),
    )
    .groupBy(exercises.movementPattern)
    .orderBy(desc(sql`COUNT(${workoutSets.id})`));

  return rows
    .filter((r) => r.pattern !== null)
    .map((r) => ({ pattern: r.pattern!, setCount: Number(r.setCount) }));
}

async function fetchReadinessPerformance(userId: string): Promise<ReadinessPerformancePoint[]> {
  const rows = await db
    .select({
      readiness: workoutSessions.readiness,
      sessionId: workoutSessions.id,
      volumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
    })
    .from(workoutSessions)
    .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        isNotNull(workoutSessions.readiness),
        sql`${workoutSessions.readiness} > 0`,
      ),
    )
    .groupBy(workoutSessions.id, workoutSessions.readiness);

  const grouped = new Map<number, number[]>();
  for (const row of rows) {
    const r = Number(row.readiness);
    if (!grouped.has(r)) grouped.set(r, []);
    grouped.get(r)!.push(Number(row.volumeKg));
  }

  return Array.from(grouped.entries())
    .map(([readiness, volumes]) => ({
      readiness,
      avgVolumeKg: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0,
      sessionCount: volumes.length,
    }))
    .sort((a, b) => a.readiness - b.readiness);
}

export async function getHeatmapData(): Promise<ActionResult<HeatmapDay[]>> {
  const auth = await requireSession();
  try {
    return { success: true, data: await fetchHeatmapData(auth.user.id) };
  } catch (err) {
    console.error("[getHeatmapData] failed", err);
    return { success: false, error: "Failed to load heatmap data" };
  }
}

export async function getMovementPatternBalance(): Promise<ActionResult<MovementPatternBalance[]>> {
  const auth = await requireSession();
  try {
    return { success: true, data: await fetchMovementPatternBalance(auth.user.id) };
  } catch (err) {
    console.error("[getMovementPatternBalance] failed", err);
    return { success: false, error: "Failed to load movement pattern data" };
  }
}

export async function getReadinessPerformance(): Promise<ActionResult<ReadinessPerformancePoint[]>> {
  const auth = await requireSession();
  try {
    return { success: true, data: await fetchReadinessPerformance(auth.user.id) };
  } catch (err) {
    console.error("[getReadinessPerformance] failed", err);
    return { success: false, error: "Failed to load readiness data" };
  }
}

export async function getWeeklyMuscleVolume(): Promise<ActionResult<WeeklyMuscleVolume[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select({
        muscleGroup: exercises.muscleGroup,
        setCount: sql<number>`COUNT(${workoutSets.id})`,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessions.userId, auth.user.id),
          eq(workoutSessions.isCompleted, true),
          eq(workoutSets.isCompleted, true),
          // ISO week start = Monday in PG with default LC_TIME
          sql`${workoutSessions.startTime} >= date_trunc('week', NOW())`,
          isNotNull(exercises.muscleGroup),
        ),
      )
      .groupBy(exercises.muscleGroup)
      .orderBy(desc(sql`COUNT(${workoutSets.id})`));

    return {
      success: true,
      data: rows
        .filter((r) => r.muscleGroup !== null)
        .map((r) => ({
          muscleGroup: r.muscleGroup!,
          setCount: Number(r.setCount),
          targetMin: 10,
          targetMax: 20,
        })),
    };
  } catch (err) {
    console.error("[getWeeklyMuscleVolume] failed", err);
    return { success: false, error: "Failed to load weekly volume" };
  }
}

/**
 * Returns chronological PR achievements for the authenticated user. Includes
 * superseded PRs so the feed shows the lifter's full history of breakthroughs,
 * not just the current bests. `isCurrent` flags whichever entry is the
 * still-active record per (exercise, prType).
 */
export async function getRecentPRs(
  limit = 100,
): Promise<ActionResult<PrFeedEntry[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select({
        id: exercisePrs.id,
        exerciseId: exercisePrs.exerciseId,
        exerciseName: exercises.name,
        discipline: exercises.discipline,
        prType: exercisePrs.prType,
        value: exercisePrs.value,
        weightKg: exercisePrs.weightKg,
        distanceMeters: exercisePrs.distanceMeters,
        bracket: exercisePrs.bracket,
        achievedAt: exercisePrs.achievedAt,
        supersededAt: exercisePrs.supersededAt,
      })
      .from(exercisePrs)
      .innerJoin(exercises, eq(exercisePrs.exerciseId, exercises.id))
      .where(eq(exercisePrs.userId, auth.user.id))
      .orderBy(desc(exercisePrs.achievedAt))
      .limit(limit);

    const data: PrFeedEntry[] = rows.map((r) => ({
      id: r.id,
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      prType: r.prType as PrFeedEntry["prType"],
      value: Number(r.value),
      weightKg: r.weightKg != null ? Number(r.weightKg) : null,
      discipline: (r.discipline as Discipline | null) ?? null,
      distanceMeters: r.distanceMeters != null ? Number(r.distanceMeters) : null,
      bracket: r.bracket ?? null,
      achievedAt: r.achievedAt.toISOString(),
      isCurrent: r.supersededAt == null,
    }));
    return { success: true, data };
  } catch (err) {
    console.error("[getRecentPRs] failed", err);
    return { success: false, error: "Failed to load PRs" };
  }
}

// ── Exported actions ───────────────────────────────────────────────────────

export async function getMetricsData(): Promise<ActionResult<MetricsData>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const [weekly, personalRecords, muscleBalance, moodDistribution] =
      await Promise.all([
        fetchWeeklyMetrics(userId),
        fetchPersonalRecords(userId),
        fetchMuscleBalance(userId),
        fetchMoodDistribution(userId),
      ]);
    return {
      success: true,
      data: { weekly, personalRecords, muscleBalance, moodDistribution },
    };
  } catch (err) {
    console.error("[getMetricsData] failed", err);
    return { success: false, error: "Failed to load metrics" };
  }
}

export async function getExerciseProgress(
  exerciseId: number,
): Promise<ActionResult<ExerciseProgress[]>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const rows = await db
      .select({
        date: workoutSessions.date,
        maxWeightKg: sql<number>`MAX(CAST(${workoutSets.weightKg} AS numeric))`,
        repsAtMaxWeight: sql<number>`(
          SELECT ws2.actual_reps
          FROM workout_sets ws2
          WHERE ws2.session_id = ${workoutSessions.id}
            AND ws2.exercise_id = ${exerciseId}
            AND CAST(ws2.weight_kg AS numeric) = MAX(CAST(${workoutSets.weightKg} AS numeric))
          ORDER BY ws2.id ASC
          LIMIT 1
        )`,
        totalVolume: sql<number>`SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps})`,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.isCompleted, true),
          eq(workoutSets.exerciseId, exerciseId),
          sql`CAST(${workoutSets.weightKg} AS numeric) > 0`,
        ),
      )
      .groupBy(workoutSessions.date, workoutSessions.id)
      .orderBy(asc(workoutSessions.date))
      .limit(16);

    return {
      success: true,
      data: rows.map((r) => ({
        date: r.date,
        maxWeightKg: Number(r.maxWeightKg),
        repsAtMaxWeight: Number(r.repsAtMaxWeight ?? 1),
        totalVolume: Number(r.totalVolume),
      })),
    };
  } catch (err) {
    console.error("[getExerciseProgress] failed", err);
    return { success: false, error: "Failed to load progress" };
  }
}

export async function getSummaryStats(): Promise<ActionResult<SummaryStats>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const [sessionRows, volumeRows, weekRows] = await Promise.all([
      db
        .select({
          totalSessions: sql<number>`COUNT(*)`,
          avgDurationMinutes: sql<number>`AVG(
            EXTRACT(EPOCH FROM (${workoutSessions.endTime} - ${workoutSessions.startTime})) / 60
          )`,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
            isNotNull(workoutSessions.endTime),
          ),
        ),

      db
        .select({
          lifetimeVolumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
        })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
          ),
        ),

      db
        .select({
          weekStart: sql<string>`date_trunc('week', ${workoutSessions.startTime})::date`,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
            sql`${workoutSessions.startTime} >= NOW() - interval '52 weeks'`,
          ),
        )
        .groupBy(sql`date_trunc('week', ${workoutSessions.startTime})`)
        .orderBy(desc(sql`date_trunc('week', ${workoutSessions.startTime})`)),
    ]);

    const sessionRow = sessionRows[0];
    const volumeRow = volumeRows[0];

    return {
      success: true,
      data: {
        totalSessions: Number(sessionRow?.totalSessions ?? 0),
        avgSessionDurationMinutes: Number(sessionRow?.avgDurationMinutes ?? 0),
        lifetimeVolumeKg: Number(volumeRow?.lifetimeVolumeKg ?? 0),
        currentStreakWeeks: computeStreakWeeks(weekRows.map((r) => r.weekStart)),
      },
    };
  } catch (err) {
    console.error("[getSummaryStats] failed", err);
    return { success: false, error: "Failed to load summary stats" };
  }
}

export async function getTopProgressingExercises(): Promise<ActionResult<TopProgressingExercise[]>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const rows = await db
      .select({
        exerciseId: workoutSets.exerciseId,
        exerciseName: exercises.name,
        muscleGroup: exercises.muscleGroup,
        sessionDate: workoutSessions.date,
        session1RM: sql<number>`MAX(CAST(${workoutSets.weightKg} AS numeric) * (1 + ${workoutSets.actualReps} / 30.0))`,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.isCompleted, true),
          sql`${workoutSessions.startTime} >= NOW() - interval '8 weeks'`,
          sql`CAST(${workoutSets.weightKg} AS numeric) > 0`,
          sql`${workoutSets.actualReps} BETWEEN 1 AND 12`,
        ),
      )
      .groupBy(
        workoutSets.exerciseId,
        exercises.name,
        exercises.muscleGroup,
        workoutSessions.date,
      )
      .orderBy(workoutSets.exerciseId, asc(workoutSessions.date));

    return {
      success: true,
      data: computeTopGains(
        rows.map((r) => ({
          exerciseId: r.exerciseId,
          exerciseName: r.exerciseName,
          muscleGroup: r.muscleGroup ?? null,
          sessionDate: r.sessionDate,
          session1RM: Number(r.session1RM),
        })),
      ),
    };
  } catch (err) {
    console.error("[getTopProgressingExercises] failed", err);
    return { success: false, error: "Failed to load progression data" };
  }
}

export async function getMetricsCycles(): Promise<ActionResult<CyclePickerItem[]>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const rows = await db
      .select({
        id: trainingCycles.id,
        name: trainingCycles.name,
        status: trainingCycles.status,
        startDate: trainingCycles.startDate,
        durationWeeks: trainingCycles.durationWeeks,
        sessionCount: sql<number>`COUNT(${workoutSessions.id})`,
      })
      .from(trainingCycles)
      .leftJoin(
        workoutSessions,
        and(
          eq(workoutSessions.userId, trainingCycles.userId),
          eq(workoutSessions.isCompleted, true),
          sql`${workoutSessions.date} >= ${trainingCycles.startDate}`,
          sql`${workoutSessions.date} < ${trainingCycles.startDate}::date + (${trainingCycles.durationWeeks} * 7 * interval '1 day')`,
        ),
      )
      .where(eq(trainingCycles.userId, userId))
      .groupBy(
        trainingCycles.id,
        trainingCycles.name,
        trainingCycles.status,
        trainingCycles.startDate,
        trainingCycles.durationWeeks,
      )
      .orderBy(
        sql`CASE ${trainingCycles.status} WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END`,
        desc(trainingCycles.startDate),
      );

    return {
      success: true,
      data: rows.map((r) => {
        const endDate = r.startDate
          ? (() => {
              const d = new Date(r.startDate + "T00:00:00");
              d.setDate(d.getDate() + r.durationWeeks * 7);
              return d.toISOString().split("T")[0];
            })()
          : null;
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          startDate: r.startDate ?? null,
          endDate,
          durationWeeks: r.durationWeeks,
          sessionCount: Number(r.sessionCount),
        };
      }),
    };
  } catch (err) {
    console.error("[getMetricsCycles] failed", err);
    return { success: false, error: "Failed to load cycles" };
  }
}

export async function getCycleMetrics(
  cycleId: number,
): Promise<ActionResult<CycleMetrics>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  const emptyCycleMetrics: CycleMetrics = {
    summary: { sessionCount: 0, totalVolumeKg: 0, avgSessionDurationMinutes: 0, sessionsPerWeek: 0 },
    weekly: [],
    muscleBalance: [],
    moodDistribution: [],
    topGains: [],
    rpeTrend: [],
  };

  try {
    const cycleRows = await db
      .select({
        startDate: trainingCycles.startDate,
        durationWeeks: trainingCycles.durationWeeks,
      })
      .from(trainingCycles)
      .where(and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId)));

    const cycleRow = cycleRows[0] ?? null;

    if (!cycleRow || !cycleRow.startDate) {
      return { success: true, data: emptyCycleMetrics };
    }

    const { start, end } = getCycleDateRange(cycleRow.startDate, cycleRow.durationWeeks);

    const [summary, weekly, muscleBalance, moodDistribution, topGains, rpeTrend] =
      await Promise.all([
        fetchCycleSummary(userId, start, end, cycleRow.durationWeeks),
        fetchCycleWeeklyVolume(userId, start, end, cycleRow.startDate, cycleRow.durationWeeks),
        fetchCycleMuscleBalance(userId, start, end),
        fetchCycleMoodDistribution(userId, start, end),
        fetchCycleTopGains(userId, start, end),
        fetchCycleRpeTrend(userId, start, end, cycleRow.startDate, cycleRow.durationWeeks),
      ]);

    return { success: true, data: { summary, weekly, muscleBalance, moodDistribution, topGains, rpeTrend } };
  } catch (err) {
    console.error("[getCycleMetrics] failed", err);
    return { success: false, error: "Failed to load cycle metrics" };
  }
}
