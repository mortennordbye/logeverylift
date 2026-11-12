/**
 * The weekly periodization sync and the share of peak it scales by, as plain
 * server code rather than Server Actions: they take a resolved `userId`, so a
 * Server Action (after requireSession) and an MCP tool (after its own auth) can
 * both call them, and nothing here is reachable from the client.
 */

import { db } from "@/db";
import { garminDailyMetrics, programExercises, programSets, trainingCycleSlots, trainingCycles, workoutSessions, workoutSets } from "@/db/schema";
import { userToday } from "@/lib/user-settings";
import { liveCycles, liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { planWrite, startDueScheduledCycle, type PlanWriteContext } from "@/lib/plan-revisions";
import { programs } from "@/db/schema";
import { cycleWeek, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";
import {
  computeAdaptationFactor,
  deloadCadenceForLevel,
  intervalPhaseRecipe,
  meanLoggedRpe,
  periodizedLoad,
  scaledDistance,
  scaledDuration,
  uncoupledAcwr,
  type Adaptation,
  type AdaptationSignals,
  type AthleteLevel,
  type TrainingGoal,
  type WearableSignals,
} from "@/lib/utils/periodization";
import { and, asc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

/**
 * A set is periodized when it carries either peak anchor. Shared by the sync and
 * the periodization summary so the two cannot disagree about which cycles count.
 */
export const hasPeakAnchor = or(
  isNotNull(programSets.peakDistanceMeters),
  isNotNull(programSets.peakDurationSeconds),
);

/**
 * Run the user's active cycle's weekly sync if this week's has not run yet. A
 * no-op with no active cycle, once the block is over (getActiveCycleForUser
 * completes it), or when the week is already synced, which is one indexed read.
 */
export async function syncDueCycle(userId: string): Promise<void> {
  // A block scheduled to start today (or earlier) starts first.
  await startDueScheduledCycle(userId);
  const cycle = await db.query.trainingCycles.findFirst({
    where: and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), liveCycles),
    with: { slots: true },
  });
  if (!cycle?.startDate) return;
  const today = await userToday(userId);
  const { currentWeek, isOver } = cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, today);
  if (!isOver && cycle.lastSyncedWeek !== currentWeek) {
    await syncPeriodizedTargets(cycle.id, userId, cycle.slots, currentWeek, cycle.durationWeeks, cycle.goal, cycle.athleteLevel);
  }
}

/**
 * This week's share of peak for a program in the user's active cycle: the curve
 * times the adaptation nudge, the same factor the weekly sync scales peaks by.
 * 1 when the program is in no active cycle, so a typed value is the peak.
 *
 * Takes `userId` because it is called from a Server Action and an MCP tool that
 * have each already resolved it; it is not an action itself.
 */
export async function periodizationShare(programId: number, userId: string): Promise<number> {
  // The share is this week's curve times this week's nudge, and the nudge is
  // the sync's output: until this week has synced, adaptationPct is last
  // week's, and a value divided by it would not survive the sync.
  await syncDueCycle(userId);
  const [cycle] = await db
    .select({
      startDate: trainingCycles.startDate,
      durationWeeks: trainingCycles.durationWeeks,
      goal: trainingCycles.goal,
      athleteLevel: trainingCycles.athleteLevel,
      adaptationPct: trainingCycles.adaptationPct,
    })
    .from(trainingCycleSlots)
    .innerJoin(trainingCycles, eq(trainingCycles.id, trainingCycleSlots.trainingCycleId))
    .where(
      and(
        eq(trainingCycleSlots.programId, programId),
        eq(trainingCycles.userId, userId),
        eq(trainingCycles.status, "active"),
        liveCycles,
      ),
    )
    .limit(1);
  if (!cycle?.startDate) return 1;
  const today = await userToday(userId);
  const { currentWeek } = cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, today);
  const { multiplier } = periodizedLoad(
    currentWeek,
    cycle.durationWeeks,
    cycle.goal,
    deloadCadenceForLevel(cycle.athleteLevel),
  );
  const share = multiplier * (cycle.adaptationPct / 100);
  return share > 0 ? share : 1;
}

/**
 * No-wearable performance nudge. Looks at the last 7 days of completed sessions
 * for this cycle's programs and returns a percent to apply on top of the curve:
 * adherence (did the prescribed sessions happen), pre-workout readiness, and RPE.
 * Neutral (100) on week 1 or when there's no signal — it never moves on no data.
 */
async function computeCycleAdaptation(
  userId: string,
  programIds: number[],
  currentWeek: number,
): Promise<{ pct: number; note: string }> {
  const signals = await cycleAdaptationSignals(userId, programIds, currentWeek);
  return signals ? computeAdaptationFactor(signals) : { pct: 100, note: "" };
}

/** The logged signals the nudge reads; null on week 1 or with no programs (the neutral case). */
async function cycleAdaptationSignals(
  userId: string,
  programIds: number[],
  currentWeek: number,
): Promise<AdaptationSignals | null> {
  if (currentWeek < 2 || programIds.length === 0) return null;

  // The last 7 days in the user's zone, matching the dates sessions are logged on.
  const since = await userToday(userId);
  since.setDate(since.getDate() - 7);
  const sinceStr = toDateStr(since);

  const recent = await db
    .select({ id: workoutSessions.id, readiness: workoutSessions.readiness })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        inArray(workoutSessions.programId, programIds),
        gte(workoutSessions.date, sinceStr),
        // A session with no sets is a workout screen opened and left, closed
        // by the stale sweep; it was not done. A day the cycle completed
        // itself (source 'auto') has no sets by design and counts.
        or(
          eq(workoutSessions.source, "auto"),
          sql`EXISTS (SELECT 1 FROM ${workoutSets} WHERE ${workoutSets.sessionId} = ${workoutSessions.id})`,
        ),
      ),
    );

  // Scheduled sessions/week ≈ the number of training (non-rest) slots.
  const adherence = Math.min(1, recent.length / programIds.length);

  const readinessVals = recent
    .map((r) => r.readiness)
    .filter((x): x is number => x != null);
  const avgReadiness = readinessVals.length
    ? readinessVals.reduce((a, b) => a + b, 0) / readinessVals.length
    : null;

  // rpe is RIR-derived (rpe = 10 − rir) for sets logged with Reps In Reserve,
  // so this average is a real effort signal — the avgRpe ≤ 6 "push" condition in
  // computeAdaptationFactor corresponds to averaging ≥ 4 reps in reserve.
  //
  // Sets with no logged effort are dropped, not counted as zero: the average is
  // "how hard the logged sets were", and a week where nobody answered stays the
  // no-signal case (null) that leaves the block neutral.
  let avgRpe: number | null = null;
  if (recent.length > 0) {
    const rpeRows = await db
      .select({ rpe: workoutSets.rpe })
      .from(workoutSets)
      .where(inArray(workoutSets.sessionId, recent.map((r) => r.id)));
    avgRpe = meanLoggedRpe(rpeRows.map((r) => r.rpe));
  }

  return { adherence, avgReadiness, avgRpe };
}

/**
 * Scale a periodized cycle's endurance targets to the given week. For each
 * endurance set with a stored peak, distance_meters = peak × curve(week) and/or
 * duration_seconds = peak × curve(week) (time mode). Idempotent per week via
 * training_cycles.last_synced_week. No-op (beyond the marker) for cycles with no
 * peak anchors (i.e. non-triathlon cycles).
 */
/** The live programs a cycle's slots point at. A deleted program reads as an empty slot. */
async function liveSlotProgramIds(slots: { programId: number | null }[]): Promise<number[]> {
  const ids = slots.map((s) => s.programId).filter((id): id is number => id != null);
  if (ids.length === 0) return [];
  const rows = await db.select({ id: programs.id }).from(programs).where(and(inArray(programs.id, ids), livePrograms));
  const live = new Set(rows.map((r) => r.id));
  return ids.filter((id) => live.has(id));
}

export async function syncPeriodizedTargets(
  cycleId: number,
  userId: string,
  slots: { programId: number | null }[],
  currentWeek: number,
  durationWeeks: number,
  goal: TrainingGoal,
  athleteLevel: AthleteLevel | null,
  /** Use this nudge instead of computing it (an applied wearable suggestion). */
  adaptationOverride?: Adaptation,
  /**
   * Who the revisions name: the weekly sync, an applied wearable suggestion,
   * or an assistant's volume change (set_volume, docs/plans/ai-coach.md, 2.2),
   * which passes its whole write context.
   */
  writer: "sync" | "apply" | PlanWriteContext = "sync",
  /** An assistant's write (set_volume) is refused when the cycle moved past this version (T9). */
  expectedVersion?: number,
): Promise<{ pct: number; note: string }> {
  // A slot keeps its program id when the program is deleted; the sync never
  // writes into a deleted program.
  const programIds = await liveSlotProgramIds(slots);

  const { phase, multiplier } = periodizedLoad(
    currentWeek,
    durationWeeks,
    goal,
    deloadCadenceForLevel(athleteLevel),
  );
  const recipe = intervalPhaseRecipe(phase);

  // No-wearable performance nudge from the last 7 days. Skipped on week 1 (no
  // history yet) so a fresh cycle is never eased for "missing" sessions.
  const adaptation = adaptationOverride ?? (await computeCycleAdaptation(userId, programIds, currentWeek));
  const effective = multiplier * (adaptation.pct / 100);

  // One change set per cycle-week, so the history groups a week's rewrite.
  await planWrite(
    typeof writer === "object"
      ? writer
      : {
          userId,
          writer,
          reason: writer === "apply" ? `Garmin suggestion applied, week ${currentWeek}` : `Weekly sync, week ${currentWeek}`,
          changeSetId: `${writer}:${cycleId}:${currentWeek}`,
        },
    async (w) => {
  const tx = w.tx;
  // Cycle first, then programs: the lock order every plan write uses.
  await w.touch({ type: "cycle", id: cycleId }, { expectedVersion });
  if (programIds.length > 0) {
    const peakSets = await tx
      .select({
        id: programSets.id,
        peakDistance: programSets.peakDistanceMeters,
        peakDuration: programSets.peakDurationSeconds,
        sessionRole: programSets.sessionRole,
        programId: programExercises.programId,
      })
      .from(programSets)
      .innerJoin(programExercises, eq(programSets.programExerciseId, programExercises.id))
      .where(
        and(
          inArray(programExercises.programId, programIds),
          hasPeakAnchor,
          liveProgramExercises,
          liveProgramSets,
        ),
      );

    if (peakSets.length > 0) {
      for (const id of [...new Set(peakSets.map((ps) => ps.programId))].sort((a, b) => a - b)) {
        await w.touch({ type: "program", id });
      }
      for (const ps of peakSets) {
          const update: {
            distanceMeters?: number;
            durationSeconds?: number;
            targetHeartRateZone?: number;
            restTimeSeconds?: number;
          } = {};
          if (ps.peakDistance != null) update.distanceMeters = scaledDistance(ps.peakDistance, effective);
          if (ps.peakDuration != null) update.durationSeconds = scaledDuration(ps.peakDuration, effective);
          // Phase-aware: the quality session's hard reps swap zone/recovery by phase.
          if (ps.sessionRole === "work") {
            update.targetHeartRateZone = recipe.zone;
            update.restTimeSeconds = recipe.restSeconds;
          }
          await tx.update(programSets).set(update).where(eq(programSets.id, ps.id));
      }
    }
  }

  await tx
    .update(trainingCycles)
    .set({
      lastSyncedWeek: currentWeek,
      adaptationPct: adaptation.pct,
      adaptationNote: adaptation.note || null,
    })
    .where(eq(trainingCycles.id, cycleId));
    },
  );
  return adaptation;
}

// ── Wearable suggestion (docs/plans/garmin-insights-design.md, 2.14) ─────────

/** Garmin days older than this are too stale to steer the plan. */
const WEARABLE_FRESH_DAYS = 3;

/** Wearable signals from the user's newest Garmin daily metrics, or null when there are none or they are stale. */
export async function wearableSignals(userId: string, today = new Date()): Promise<WearableSignals | null> {
  const since = new Date(today);
  since.setDate(since.getDate() - 27);
  const rows = await db
    .select({
      day: garminDailyMetrics.day,
      hrvState: sql<WearableSignals["hrvState"]>`${garminDailyMetrics.metrics}->'hrv'->>'state'`,
      rhrFlag: sql<boolean | null>`(${garminDailyMetrics.metrics}->'restingHr'->>'flag')::boolean`,
      debtS: sql<number | null>`(${garminDailyMetrics.metrics}->>'sleepDebtS')::float8`,
      ramp: sql<number | null>`(${garminDailyMetrics.metrics}->>'ramp')::float8`,
      load: sql<number | null>`(${garminDailyMetrics.metrics}->'pmc'->'total'->>'load')::float8`,
      // Whether the watch measured anything that day: a daily row exists for every calendar day.
      measured: sql<boolean>`(${garminDailyMetrics.metrics}->'hrv'->>'ms') is not null or (${garminDailyMetrics.metrics}->>'sleepSeconds') is not null`,
    })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, since.toISOString().slice(0, 10))))
    .orderBy(asc(garminDailyMetrics.day));
  // Freshness from the newest day the watch measured, not the newest row: rows are
  // built up to today even when the watch has not been worn for days.
  const last = rows.findLast((r) => r.measured);
  if (!last) return null;
  const ageDays = (Date.parse(today.toISOString().slice(0, 10)) - Date.parse(last.day)) / 86_400_000;
  if (ageDays > WEARABLE_FRESH_DAYS) return null;
  // Four 7-day blocks ending on the newest day, for ACWR.
  const loads = rows.map((r) => r.load ?? 0);
  const weeks: number[] = [];
  for (let end = loads.length; end - 7 >= 0 && weeks.length < 4; end -= 7) weeks.unshift(loads.slice(end - 7, end).reduce((a, b) => a + b, 0));
  return {
    hrvState: last.hrvState,
    restingHrFlag: Boolean(last.rhrFlag),
    sleepDebtH: last.debtS !== null ? last.debtS / 3600 : null,
    acwr: weeks.length === 4 ? uncoupledAcwr(weeks).at(-1)! : null,
    ramp: last.ramp,
  };
}

export type WearableSuggestion = Adaptation & { current: number; cycleId: number; week: number };

/**
 * What the week's nudge would be with the wearable signals, when that differs
 * from what the weekly sync set. Read-only: the sync itself never uses the
 * wearable (decision O-3, suggest first). Null when there is nothing to suggest.
 */
export async function wearableSuggestion(userId: string, now = new Date()): Promise<WearableSuggestion | null> {
  await syncDueCycle(userId);
  const cycle = await db.query.trainingCycles.findFirst({
    where: and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), liveCycles),
    with: { slots: true },
  });
  // A missing athlete level is fine: the weekly sync uses the default deload cadence then too.
  if (!cycle?.startDate) return null;
  const today = await userToday(userId, now);
  const { currentWeek, isOver } = cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, today);
  if (isOver) return null;
  const programIds = await liveSlotProgramIds(cycle.slots);
  const signals = await cycleAdaptationSignals(userId, programIds, currentWeek);
  const wearable = await wearableSignals(userId, now);
  if (!signals || !wearable) return null;
  const suggested = computeAdaptationFactor({ ...signals, wearable });
  if (suggested.pct === cycle.adaptationPct) return null;
  return { ...suggested, current: cycle.adaptationPct, cycleId: cycle.id, week: currentWeek };
}

/** Apply the current suggestion to this week's targets. Recomputed here: a client never sends the percent. */
export async function applyWearableSuggestion(userId: string, now = new Date()): Promise<WearableSuggestion | null> {
  const suggestion = await wearableSuggestion(userId, now);
  if (!suggestion) return null;
  const cycle = await db.query.trainingCycles.findFirst({
    where: and(eq(trainingCycles.id, suggestion.cycleId), eq(trainingCycles.userId, userId), liveCycles),
    with: { slots: true },
  });
  if (!cycle) return null;
  await syncPeriodizedTargets(
    cycle.id,
    userId,
    cycle.slots,
    suggestion.week,
    cycle.durationWeeks,
    cycle.goal,
    cycle.athleteLevel,
    { pct: suggestion.pct, note: suggestion.note },
    "apply",
  );
  return suggestion;
}
