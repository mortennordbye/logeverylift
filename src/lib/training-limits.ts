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
  exercises,
  garminActivities,
  garminActivityMetrics,
  garminConnections,
  programExercises,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
} from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { liveCycles, liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import type { PlanWriteSession, Tx } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { deloadCadenceForLevel, periodizedLoad, scaledDistance, scaledDuration } from "@/lib/utils/periodization";
import {
  LONG_RUN_WINDOW_DAYS,
  hardSessionsPerWeek,
  isHardSession,
  longRunCap,
  longestRuns,
  plannedRun,
  remainingAfterOverride,
  type BrokenLimit,
  type LimitCheck,
  type LimitNotChecked,
  type LimitRule,
  type PlannedRun,
  type RunHistory,
  type WeekSession,
} from "@/lib/utils/training-limits";
import { and, eq, gte, inArray, isNotNull, or } from "drizzle-orm";

type Executor = typeof db | Tx;

/** What a user's limits can run on, read once per tool call. */
export type LimitContext = {
  endurance: boolean;
  /** The 30-day run history, or null with the reason it is missing. */
  runs: RunHistory | null;
  runsWhy: string | null;
};

const NO_ENDURANCE = "The endurance features are off for this account, so no training limit runs.";
const NO_GARMIN =
  "Long-run cap not checked: no Garmin data for this account. Check the change against the long-run rule in logeverylift://docs/endurance-training-reference yourself.";

export async function limitContext(userId: string): Promise<LimitContext> {
  if (!(await enduranceEnabledFor(userId))) return { endurance: false, runs: null, runsWhy: NO_ENDURANCE };
  if (!(await garminAllowedFor(userId))) return { endurance: true, runs: null, runsWhy: NO_GARMIN };
  const [conn] = await db
    .select({ lastSyncedAt: garminConnections.lastSyncedAt })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId));
  if (!conn?.lastSyncedAt) return { endurance: true, runs: null, runsWhy: NO_GARMIN };

  // The 30 days up to and including today.
  const from = toDateStr(addDays(await userToday(userId), -(LONG_RUN_WINDOW_DAYS - 1)));
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
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const runs = rows
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
  return { endurance: true, runs: longestRuns(runs), runsWhy: null };
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

/** A weekday cycle's week of sessions, or null for a rotation cycle (no fixed week). */
export async function cycleWeekSessions(ex: Executor, cycleId: number): Promise<WeekSession[] | null> {
  const [cycle] = await ex
    .select({ scheduleType: trainingCycles.scheduleType })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), liveCycles));
  if (!cycle || cycle.scheduleType !== "day_of_week") return null;
  const slots = await ex
    .select({ dayOfWeek: trainingCycleSlots.dayOfWeek, programId: trainingCycleSlots.programId })
    .from(trainingCycleSlots)
    .where(eq(trainingCycleSlots.trainingCycleId, cycleId));
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
    .filter((s) => s.dayOfWeek != null && s.programId != null)
    .map((s) => ({
      dayOfWeek: s.dayOfWeek!,
      // A slot on a deleted program has no live sets, so it is not hard.
      hard: isHardSession(
        sets
          .filter((x) => x.programId === s.programId)
          .map((x) => ({ discipline: x.discipline, sessionRole: x.sessionRole === "work" ? "work" : null, targetHeartRateZone: x.targetHeartRateZone })),
      ),
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

/** What a write is about: the programs whose runs it can change and the cycles whose week it can change. */
export type LimitScope = { programIds: number[]; cycleIds: number[] };

export type PlanFacts = {
  runs: Map<number, { label: string; run: PlannedRun }>;
  /** Each cycle's week; null for a rotation cycle (no fixed week). */
  weeks: Map<number, WeekSession[] | null>;
};

export async function planFacts(ex: Executor, scope: LimitScope, share: number | null = null): Promise<PlanFacts> {
  const weeks = new Map<number, WeekSession[] | null>();
  for (const id of scope.cycleIds) weeks.set(id, await cycleWeekSessions(ex, id));
  return { runs: await programRuns(ex, scope.programIds, share), weeks };
}

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
    notChecked.push({ rule: "long_run_cap", why: NO_ENDURANCE }, { rule: "hard_sessions_per_week", why: NO_ENDURANCE });
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
    const weeks = [...after.weeks].filter((e): e is [number, WeekSession[]] => e[1] != null);
    if (weeks.length) {
      checked.push("hard_sessions_per_week");
      const hits = weeks
        .map(([id, week]) => hardSessionsPerWeek(before.weeks.get(id) ?? [], week))
        .filter((h): h is BrokenLimit => h != null);
      // One result per rule, so one override covers it.
      if (hits.length) broken.push({ ...hits[0], message: hits.map((h) => h.message).join(" "), numbers: hits.length > 1 ? { cycles: hits.map((h) => h.numbers) } : hits[0].numbers });
    } else {
      notChecked.push({
        rule: "hard_sessions_per_week",
        why: after.weeks.size
          ? "Rotation cycles have no fixed week, so hard sessions per week are not counted."
          : "The change is not in a weekday cycle that is active, scheduled or being started.",
      });
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
 */
export async function withLimits<T>(
  w: PlanWriteSession,
  lc: LimitContext,
  scope: LimitScope,
  override: LimitOverride,
  write: () => Promise<T>,
): Promise<{ result: T; check: LimitCheck; unusedOverrides: LimitRule[] }> {
  const before = lc.endurance ? await planFacts(w.tx, scope) : NO_FACTS;
  const result = await write();
  const after = lc.endurance ? await planFacts(w.tx, scope) : NO_FACTS;
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
  const { multiplier } = periodizedLoad(week, c.durationWeeks, c.goal, deloadCadenceForLevel(c.athleteLevel));
  return {
    scope: { programIds: [...new Set(slots.map((s) => s.programId))], cycleIds: [cycleId] },
    share: multiplier * (pct / 100),
  };
}

