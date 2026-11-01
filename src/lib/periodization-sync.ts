/**
 * The weekly periodization sync and the share of peak it scales by, as plain
 * server code rather than Server Actions: they take a resolved `userId`, so a
 * Server Action (after requireSession) and an MCP tool (after its own auth) can
 * both call them, and nothing here is reachable from the client.
 */

import { db } from "@/db";
import { programExercises, programSets, trainingCycleSlots, trainingCycles, workoutSessions, workoutSets } from "@/db/schema";
import { cycleWeek, parseDateStr } from "@/lib/utils/cycle-position";
import {
  computeAdaptationFactor,
  deloadCadenceForLevel,
  intervalPhaseRecipe,
  meanLoggedRpe,
  periodizedLoad,
  scaledDistance,
  scaledDuration,
  type AthleteLevel,
  type TrainingGoal,
} from "@/lib/utils/periodization";
import { and, eq, gte, inArray, isNotNull, or } from "drizzle-orm";

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
  const cycle = await db.query.trainingCycles.findFirst({
    where: and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active")),
    with: { slots: true },
  });
  if (!cycle?.startDate) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
      ),
    )
    .limit(1);
  if (!cycle?.startDate) return 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
  if (currentWeek < 2 || programIds.length === 0) return { pct: 100, note: "" };

  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceStr = since.toISOString().split("T")[0];

  const recent = await db
    .select({ id: workoutSessions.id, readiness: workoutSessions.readiness })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        inArray(workoutSessions.programId, programIds),
        gte(workoutSessions.date, sinceStr),
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

  return computeAdaptationFactor({ adherence, avgReadiness, avgRpe });
}

/**
 * Scale a periodized cycle's endurance targets to the given week. For each
 * endurance set with a stored peak, distance_meters = peak × curve(week) and/or
 * duration_seconds = peak × curve(week) (time mode). Idempotent per week via
 * training_cycles.last_synced_week. No-op (beyond the marker) for cycles with no
 * peak anchors (i.e. non-triathlon cycles).
 */
export async function syncPeriodizedTargets(
  cycleId: number,
  userId: string,
  slots: { programId: number | null }[],
  currentWeek: number,
  durationWeeks: number,
  goal: TrainingGoal,
  athleteLevel: AthleteLevel | null,
): Promise<{ pct: number; note: string }> {
  const programIds = slots
    .map((s) => s.programId)
    .filter((id): id is number => id != null);

  const { phase, multiplier } = periodizedLoad(
    currentWeek,
    durationWeeks,
    goal,
    deloadCadenceForLevel(athleteLevel),
  );
  const recipe = intervalPhaseRecipe(phase);

  // No-wearable performance nudge from the last 7 days. Skipped on week 1 (no
  // history yet) so a fresh cycle is never eased for "missing" sessions.
  const adaptation = await computeCycleAdaptation(userId, programIds, currentWeek);
  const effective = multiplier * (adaptation.pct / 100);

  if (programIds.length > 0) {
    const peakSets = await db
      .select({
        id: programSets.id,
        peakDistance: programSets.peakDistanceMeters,
        peakDuration: programSets.peakDurationSeconds,
        sessionRole: programSets.sessionRole,
      })
      .from(programSets)
      .innerJoin(programExercises, eq(programSets.programExerciseId, programExercises.id))
      .where(
        and(
          inArray(programExercises.programId, programIds),
          hasPeakAnchor,
        ),
      );

    if (peakSets.length > 0) {
      await Promise.all(
        peakSets.map((ps) => {
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
          return db.update(programSets).set(update).where(eq(programSets.id, ps.id));
        }),
      );
    }
  }

  await db
    .update(trainingCycles)
    .set({
      lastSyncedWeek: currentWeek,
      adaptationPct: adaptation.pct,
      adaptationNote: adaptation.note || null,
    })
    .where(eq(trainingCycles.id, cycleId));
  return adaptation;
}
