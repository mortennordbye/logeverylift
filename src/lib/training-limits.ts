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
  plannedSessions,
  programExercises,
  users,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
} from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { liveCycles, livePlannedSessions, liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import type { PlanWriteSession, Tx } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { cycleLoad, scaledDistance, scaledDuration } from "@/lib/utils/periodization";
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
import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

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
    .select({ date: plannedSessions.date, programId: plannedSessions.programId })
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
  for (const r of rows) {
    if (r.programId == null) continue;
    byWeek.get(mondayOf(r.date!))?.push({ dayOfWeek: dowOf(r.date!), hard: hard.get(r.programId) ?? false });
  }
  return { thisMonday, byWeek };
}

/** The weekday cycles among these that have dated sessions. */
async function datedCycles(ex: Executor, cycleIds: number[]): Promise<Set<number>> {
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

/** Whether each program is a hard session (an interval endurance set), by id. */
async function hardPrograms(ex: Executor, programIds: number[]): Promise<Map<number, boolean>> {
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
    .select({ date: plannedSessions.date, programId: plannedSessions.programId })
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
  return rows
    .filter((r) => r.programId != null)
    .map((r) => ({ dayOfWeek: dowOf(r.date!), hard: hard.get(r.programId!) ?? false }));
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
export type LimitScope = { programIds: number[]; cycleIds: number[]; sessionWeeks?: { userId: string; mondays: string[] } };

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
};

export async function planFacts(
  ex: Executor,
  scope: LimitScope,
  share: number | null = null,
  /** Cycles checked on their dated calendar week; the rest on the template's week. */
  dated: ReadonlySet<number> = new Set(),
): Promise<PlanFacts> {
  const weeks = new Map<string, WeekSession[] | null>();
  const labels = new Map<string, string>();
  for (const id of scope.cycleIds) {
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
    if (monday !== thisMonday) labels.set(`s:${monday}`, monday);
  }
  return { runs: await programRuns(ex, scope.programIds, share), weeks, labels };
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
  // A cycle that has dated sessions is checked on them, before and after
  // (review 21); one that has none yet, on its template's week.
  const dated = lc.endurance ? await datedCycles(w.tx, scope.cycleIds) : new Set<number>();
  const before = lc.endurance ? await planFacts(w.tx, scope, null, dated) : NO_FACTS;
  const result = await write();
  // The dated sessions follow a template change before the plan is read
  // again, in the same transaction.
  if (dated.size) await w.regenerateSessions();
  const after = lc.endurance ? await planFacts(w.tx, scope, null, dated) : NO_FACTS;
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

