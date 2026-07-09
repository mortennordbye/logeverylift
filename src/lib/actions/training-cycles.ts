"use server";

/**
 * Training Cycles Server Actions
 *
 * CRUD operations for training cycles (mesocycles) and their weekly slots.
 */

import { db } from "@/db";
import { dismissedMakeups, programExercises, programSets, programs, trainingCycleSlots, trainingCycles, users, workoutSessions, workoutSets } from "@/db/schema";
import {
  computeAdaptationFactor,
  deloadCadenceForLevel,
  intervalPhaseRecipe,
  periodizedLoad,
  phaseLabel,
  phaseLayout,
  scaledDistance,
  scaledDuration,
  strengthPhaseRecipe,
  type AthleteLevel,
  type TrainingGoal,
  type TrainingPhase,
} from "@/lib/utils/periodization";
import { requireSession } from "@/lib/utils/session";
import {
  createTrainingCycleSchema,
  importCycleSchema,
  reorderCycleSlotsSchema,
  updateTrainingCycleSchema,
  upsertCycleSlotSchema,
} from "@/lib/validators/training-cycles";
import type {
  ActionResult,
  ActiveCycleInfo,
  MissedSlot,
  TrainingCycle,
  TrainingCycleSlot,
  TrainingCycleSlotWithProgram,
  TrainingCycleWithSlots,
} from "@/types/workout";
import {
  findDayOfWeekMissed,
  jsDayToDow,
  resolveRotation,
  toDateStr,
} from "@/lib/utils/cycle-position";
import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export async function getTrainingCycles(): Promise<ActionResult<TrainingCycle[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select()
      .from(trainingCycles)
      .where(eq(trainingCycles.userId, auth.user.id))
      .orderBy(asc(trainingCycles.status), asc(trainingCycles.createdAt));
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getTrainingCycleWithSlots(
  cycleId: number,
): Promise<ActionResult<TrainingCycleWithSlots>> {
  const auth = await requireSession();
  try {
    const cycle = await db.query.trainingCycles.findFirst({
      where: and(
        eq(trainingCycles.id, cycleId),
        eq(trainingCycles.userId, auth.user.id),
      ),
      with: {
        slots: {
          orderBy: (s, { asc }) => [asc(s.dayOfWeek), asc(s.orderIndex)],
          with: {
            program: true,
          },
        },
      },
    });

    if (!cycle) {
      return { success: false, error: "Cycle not found" };
    }

    return { success: true, data: cycle as TrainingCycleWithSlots };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getAllCyclesWithSlots(): Promise<ActionResult<TrainingCycleWithSlots[]>> {
  const auth = await requireSession();
  try {
    const rows = await db.query.trainingCycles.findMany({
      where: eq(trainingCycles.userId, auth.user.id),
      orderBy: [asc(trainingCycles.startDate)],
      with: {
        slots: {
          orderBy: (s, { asc }) => [asc(s.dayOfWeek), asc(s.orderIndex)],
          with: { program: true },
        },
      },
    });
    return { success: true, data: rows as TrainingCycleWithSlots[] };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getActiveCycleForUser(): Promise<ActionResult<ActiveCycleInfo | null>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const cycle = await db.query.trainingCycles.findFirst({
      where: and(
        eq(trainingCycles.userId, userId),
        eq(trainingCycles.status, "active"),
      ),
      with: {
        slots: {
          orderBy: (s, { asc }) => [asc(s.dayOfWeek), asc(s.orderIndex)],
          with: {
            program: true,
          },
        },
      },
    });

    if (!cycle) {
      return { success: true, data: null };
    }

    const startDate = new Date(cycle.startDate!);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + cycle.durationWeeks * 7);
    const endDateStr = endDate.toISOString().split("T")[0];

    // Auto-complete if past end date
    if (today > endDate) {
      await db
        .update(trainingCycles)
        .set({ status: "completed" })
        .where(eq(trainingCycles.id, cycle.id));
      revalidatePath("/cycles");
      revalidatePath("/");
      return { success: true, data: null };
    }

    const daysSinceStart = Math.floor(
      (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const currentWeek = Math.floor(daysSinceStart / 7) + 1;

    const slots = cycle.slots as TrainingCycleWithSlots["slots"];

    // Periodization: once per cycle-week, scale the endurance targets from their
    // stored peak via the curve (Base→Build→Peak→Taper, or flat for "maintain").
    // No-op for non-triathlon cycles (no peak_distance_meters anchors).
    if (cycle.lastSyncedWeek !== currentWeek) {
      await syncPeriodizedTargets(cycle.id, userId, slots, currentWeek, cycle.durationWeeks, cycle.goal, cycle.athleteLevel);
    }
    const slotById = new Map<number, TrainingCycleSlotWithProgram>(
      slots.map((s) => [s.id, s]),
    );

    // User opt-out: when missed workouts are disabled, suppress all missed/
    // overdue prompts (the day-of-week make-up card and the rotation badge both
    // derive from missedSlots, so an empty list hides both).
    const [userPref] = await db
      .select({ missedWorkoutsEnabled: users.missedWorkoutsEnabled })
      .from(users)
      .where(eq(users.id, userId));
    const missedEnabled = userPref?.missedWorkoutsEnabled ?? true;

    let todaySlot: TrainingCycleSlotWithProgram | null = null;
    let missedSlots: MissedSlot[] = [];

    if (cycle.scheduleType === "day_of_week") {
      const dayOfWeek = jsDayToDow(today.getDay());
      todaySlot = slots.find((s) => s.dayOfWeek === dayOfWeek) ?? null;

      if (missedEnabled) {
        // Look back up to 7 days for missed active slots (bounded by startDate).
        const lookbackStart = new Date(today);
        lookbackStart.setDate(lookbackStart.getDate() - 7);
        const windowStart = lookbackStart < startDate ? startDate : lookbackStart;
        const sessions = await db
          .select({
            date: workoutSessions.date,
            intendedDate: workoutSessions.intendedDate,
          })
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.isCompleted, true),
              gte(workoutSessions.date, toDateStr(windowStart)),
            ),
          );
        // A slot is satisfied by a session logged on its date OR by a make-up
        // session that points back to it via intendedDate.
        const completedDates = new Set<string>();
        for (const s of sessions) {
          completedDates.add(s.date);
          if (s.intendedDate) completedDates.add(s.intendedDate);
        }

        // Declined missed days — filtered out so they stop nagging.
        const dismissed = await db
          .select({ date: dismissedMakeups.date })
          .from(dismissedMakeups)
          .where(eq(dismissedMakeups.userId, userId));
        const dismissedDates = new Set(dismissed.map((d) => d.date));

        const missed = findDayOfWeekMissed(startDate, slots, completedDates, today, 7);
        missedSlots = missed
          .filter((m) => !dismissedDates.has(m.date))
          .map((m) => {
            const slot = slotById.get(m.slotId);
            return slot ? { date: m.date, slot } : null;
          })
          .filter((x): x is MissedSlot => x !== null);
      }
    } else {
      // Rotation: walk forward from startDate, advancing position per-slot.
      // todaySlot is always needed; the missed list is gated on the opt-out.
      const sessions = await db
        .select({ date: workoutSessions.date })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
            gte(workoutSessions.date, toDateStr(startDate)),
          ),
        );
      const sortedDates = sessions.map((s) => s.date).sort();
      const { todaySlotId, missed } = resolveRotation(
        startDate,
        slots,
        sortedDates,
        today,
      );
      todaySlot = todaySlotId != null ? (slotById.get(todaySlotId) ?? null) : null;
      if (missedEnabled) {
        missedSlots = missed
          .map((m) => {
            const slot = slotById.get(m.slotId);
            return slot ? { date: m.date, slot } : null;
          })
          .filter((x): x is MissedSlot => x !== null);
      }
    }

    return {
      success: true,
      data: {
        cycle: cycle as unknown as TrainingCycleWithSlots,
        todaySlot,
        currentWeek,
        endDate: endDateStr,
        missedSlots,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

const dismissMissedWorkoutSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
});

/**
 * Decline a specific missed workout so it stops appearing in the "Missed this
 * week" list. Keyed by the original scheduled date of the missed slot.
 */
export async function dismissMissedWorkout(
  data: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = dismissMissedWorkoutSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await db
      .insert(dismissedMakeups)
      .values({ userId: auth.user.id, date: parsed.data.date })
      .onConflictDoNothing();
    revalidatePath("/");
    return { success: true, data: null };
  } catch (e) {
    console.error("[dismissMissedWorkout] failed", e);
    return { success: false, error: "Failed to dismiss missed workout" };
  }
}

const setMissedWorkoutsEnabledSchema = z.object({ enabled: z.boolean() });

/**
 * Toggle the missed-workout / overdue prompts on the home screen.
 */
export async function setMissedWorkoutsEnabled(
  data: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = setMissedWorkoutsEnabledSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await db
      .update(users)
      .set({ missedWorkoutsEnabled: parsed.data.enabled })
      .where(eq(users.id, auth.user.id));
    revalidatePath("/");
    revalidatePath("/settings");
    return { success: true, data: null };
  } catch (e) {
    console.error("[setMissedWorkoutsEnabled] failed", e);
    return { success: false, error: "Failed to update setting" };
  }
}

export type CyclePeriodization = {
  goal: TrainingGoal;
  currentWeek: number;
  totalWeeks: number;
  phase: TrainingPhase;
  phaseLabel: string;
  /** This week's endurance volume as a fraction of peak. */
  multiplier: number;
  isDeload: boolean;
  /** Weeks until the peak block (0 once in/after peak). */
  weeksUntilPeak: number;
  /** Weeks until taper begins (0 once in/after taper). */
  weeksUntilTaper: number;
  /** Human note for the no-wearable performance nudge, or null when neutral. */
  adaptationNote: string | null;
};

/**
 * Periodization summary for a triathlon cycle's detail page. Returns null for
 * cycles with no peak-anchored endurance (i.e. ordinary, non-periodized cycles).
 */
export async function getCyclePeriodization(
  cycleId: number,
): Promise<ActionResult<CyclePeriodization | null>> {
  const auth = await requireSession();
  try {
    const cycle = await db.query.trainingCycles.findFirst({
      where: and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, auth.user.id)),
      with: { slots: { with: { program: true } } },
    });
    if (!cycle) return { success: true, data: null };

    const programIds = (cycle.slots ?? [])
      .map((s) => s.programId)
      .filter((id): id is number => id != null);
    if (programIds.length === 0) return { success: true, data: null };

    const [peak] = await db
      .select({ id: programSets.id })
      .from(programSets)
      .innerJoin(programExercises, eq(programSets.programExerciseId, programExercises.id))
      .where(
        and(
          inArray(programExercises.programId, programIds),
          isNotNull(programSets.peakDistanceMeters),
        ),
      )
      .limit(1);
    if (!peak) return { success: true, data: null };

    const totalWeeks = cycle.durationWeeks;
    let currentWeek = 1;
    if (cycle.status === "active" && cycle.startDate) {
      const start = new Date(cycle.startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
      currentWeek = Math.min(totalWeeks, Math.max(1, Math.floor(days / 7) + 1));
    } else if (cycle.status === "completed") {
      currentWeek = totalWeeks;
    }

    const load = periodizedLoad(currentWeek, totalWeeks, cycle.goal, deloadCadenceForLevel(cycle.athleteLevel));
    const { rampWeeks, peakWeeks } = phaseLayout(totalWeeks);
    const peakStart = rampWeeks + 1;
    const taperStart = rampWeeks + peakWeeks + 1;
    // Show the *effective* volume — the curve after the no-wearable nudge — so the
    // displayed % matches what's actually prescribed this week.
    const effectiveMultiplier = Math.round(load.multiplier * cycle.adaptationPct) / 100;

    return {
      success: true,
      data: {
        goal: cycle.goal,
        currentWeek,
        totalWeeks,
        phase: load.phase,
        phaseLabel: phaseLabel(load.phase),
        multiplier: effectiveMultiplier,
        isDeload: load.isDeload,
        weeksUntilPeak: Math.max(0, peakStart - currentWeek),
        weeksUntilTaper: Math.max(0, taperStart - currentWeek),
        adaptationNote: cycle.adaptationNote ?? null,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Periodization for the active cycle a given program belongs to — for the
 * in-workout header. Returns null when the program isn't part of an active
 * (periodized) cycle. Scoped to the session user via the cycle's userId.
 */
export async function getProgramPeriodization(
  programId: number,
): Promise<ActionResult<CyclePeriodization | null>> {
  const auth = await requireSession();
  try {
    const [slot] = await db
      .select({ cycleId: trainingCycleSlots.trainingCycleId })
      .from(trainingCycleSlots)
      .innerJoin(trainingCycles, eq(trainingCycleSlots.trainingCycleId, trainingCycles.id))
      .where(
        and(
          eq(trainingCycleSlots.programId, programId),
          eq(trainingCycles.userId, auth.user.id),
          eq(trainingCycles.status, "active"),
        ),
      )
      .limit(1);
    if (!slot) return { success: true, data: null };
    return getCyclePeriodization(slot.cycleId);
  } catch (err) {
    return { success: false, error: String(err) };
  }
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
  let avgRpe: number | null = null;
  if (recent.length > 0) {
    const rpeRows = await db
      .select({ rpe: workoutSets.rpe })
      .from(workoutSets)
      .where(inArray(workoutSets.sessionId, recent.map((r) => r.id)));
    if (rpeRows.length > 0) {
      avgRpe = rpeRows.reduce((a, r) => a + r.rpe, 0) / rpeRows.length;
    }
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
async function syncPeriodizedTargets(
  cycleId: number,
  userId: string,
  slots: TrainingCycleWithSlots["slots"],
  currentWeek: number,
  durationWeeks: number,
  goal: TrainingGoal,
  athleteLevel: AthleteLevel | null,
): Promise<void> {
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
          or(
            isNotNull(programSets.peakDistanceMeters),
            isNotNull(programSets.peakDurationSeconds),
            // Main strength lifts periodize their reps/rest by phase too.
            eq(programSets.sessionRole, "strength"),
          ),
        ),
      );

    if (peakSets.length > 0) {
      await Promise.all(
        peakSets.map((ps) => {
          const update: {
            distanceMeters?: number;
            durationSeconds?: number;
            targetHeartRateZone?: number;
            targetReps?: number;
            restTimeSeconds?: number;
          } = {};
          if (ps.peakDistance != null) update.distanceMeters = scaledDistance(ps.peakDistance, effective);
          if (ps.peakDuration != null) update.durationSeconds = scaledDuration(ps.peakDuration, effective);
          // Phase-aware: the quality session's hard reps swap zone/recovery by phase.
          if (ps.sessionRole === "work") {
            update.targetHeartRateZone = recipe.zone;
            update.restTimeSeconds = recipe.restSeconds;
          }
          // Main strength lifts move reps/rest by phase (load stays athlete-entered).
          if (ps.sessionRole === "strength") {
            const s = strengthPhaseRecipe(phase);
            update.targetReps = s.reps;
            update.restTimeSeconds = s.restSeconds;
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function createTrainingCycle(
  data: unknown,
): Promise<ActionResult<TrainingCycle>> {
  const auth = await requireSession();

  const validation = createTrainingCycleSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: validation.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ ...validation.data, userId: auth.user.id })
      .returning();

    revalidatePath("/cycles");
    return { success: true, data: cycle };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateTrainingCycle(
  data: unknown,
): Promise<ActionResult<TrainingCycle>> {
  const auth = await requireSession();
  try {
    const validation = updateTrainingCycleSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid input" };
    }

    const { id, ...rest } = validation.data;

    // Verify ownership
    const existing = await db.query.trainingCycles.findFirst({
      where: and(
        eq(trainingCycles.id, id),
        eq(trainingCycles.userId, auth.user.id),
      ),
    });
    if (!existing) return { success: false, error: "Cycle not found" };

    // Guard: disallow shortening an active cycle past its elapsed time
    if (rest.durationWeeks && existing.status === "active" && existing.startDate) {
      const start = new Date(existing.startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const elapsed = Math.floor((today.getTime() - start.getTime()) / 86400000);
      if (rest.durationWeeks * 7 <= elapsed) {
        return {
          success: false,
          error: "New duration would end the cycle immediately — choose a longer duration",
        };
      }
    }

    const [cycle] = await db
      .update(trainingCycles)
      .set(rest as Partial<typeof trainingCycles.$inferInsert>)
      .where(eq(trainingCycles.id, id))
      .returning();

    revalidatePath("/cycles");
    revalidatePath(`/cycles/${id}`);
    return { success: true, data: cycle };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteTrainingCycle(
  cycleId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();

  try {
    const [existing] = await db
      .select({ userId: trainingCycles.userId })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, cycleId));
    if (!existing) return { success: false, error: "Training cycle not found" };
    if (existing.userId !== auth.user.id) return { success: false, error: "Unauthorized" };

    await db
      .delete(trainingCycles)
      .where(eq(trainingCycles.id, cycleId));
    revalidatePath("/cycles");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteManyTrainingCycles(
  cycleIds: number[],
): Promise<ActionResult<void>> {
  if (cycleIds.length === 0) return { success: true, data: undefined };
  const auth = await requireSession();
  try {
    await db.delete(trainingCycles).where(
      and(inArray(trainingCycles.id, cycleIds), eq(trainingCycles.userId, auth.user.id))
    );
    revalidatePath("/cycles");
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function startTrainingCycle(
  cycleId: number,
): Promise<ActionResult<TrainingCycle>> {
  const auth = await requireSession();
  const userId = auth.user.id;

  try {
    // Only one active cycle at a time — deactivate any current active cycle
    await db
      .update(trainingCycles)
      .set({ status: "completed" })
      .where(
        and(
          eq(trainingCycles.userId, userId),
          eq(trainingCycles.status, "active"),
        ),
      );

    const today = new Date().toISOString().split("T")[0];
    const [cycle] = await db
      .update(trainingCycles)
      .set({ status: "active", startDate: today })
      .where(and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId)))
      .returning();

    if (!cycle) return { success: false, error: "Training cycle not found" };

    revalidatePath("/cycles");
    revalidatePath(`/cycles/${cycleId}`);
    revalidatePath("/");
    return { success: true, data: cycle };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function restartTrainingCycle(
  cycleId: number,
): Promise<ActionResult<TrainingCycle>> {
  const auth = await requireSession();
  const userId = auth.user.id;

  try {
    // Verify ownership
    const existing = await db.query.trainingCycles.findFirst({
      where: and(
        eq(trainingCycles.id, cycleId),
        eq(trainingCycles.userId, userId),
      ),
    });
    if (!existing) return { success: false, error: "Cycle not found" };

    // Deactivate any currently active cycle
    await db
      .update(trainingCycles)
      .set({ status: "completed" })
      .where(
        and(
          eq(trainingCycles.userId, userId),
          eq(trainingCycles.status, "active"),
        ),
      );

    const today = new Date().toISOString().split("T")[0];
    const [cycle] = await db
      .update(trainingCycles)
      .set({ status: "active", startDate: today })
      .where(eq(trainingCycles.id, cycleId))
      .returning();

    revalidatePath("/cycles");
    revalidatePath(`/cycles/${cycleId}`);
    revalidatePath("/");
    return { success: true, data: cycle };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function upsertCycleSlot(
  data: unknown,
): Promise<ActionResult<TrainingCycleSlot>> {
  const auth = await requireSession();
  try {
    const validation = upsertCycleSlotSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid input" };
    }

    const { trainingCycleId, dayOfWeek, orderIndex, ...rest } = validation.data;

    // Verify ownership of the cycle
    const [cycle] = await db
      .select({ userId: trainingCycles.userId })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, trainingCycleId))
      .limit(1);
    if (!cycle || cycle.userId !== auth.user.id) {
      return { success: false, error: "Cycle not found" };
    }

    // If assigning a program to the slot, verify the caller owns it — otherwise
    // a user could attach (and surface) another user's program in their cycle.
    if (rest.programId != null) {
      const [prog] = await db
        .select({ userId: programs.userId })
        .from(programs)
        .where(eq(programs.id, rest.programId))
        .limit(1);
      if (!prog || prog.userId !== auth.user.id) {
        return { success: false, error: "Program not found" };
      }
    }

    // Find existing slot to upsert
    let existingSlot = null;
    if (dayOfWeek !== undefined) {
      existingSlot = await db.query.trainingCycleSlots.findFirst({
        where: and(
          eq(trainingCycleSlots.trainingCycleId, trainingCycleId),
          eq(trainingCycleSlots.dayOfWeek, dayOfWeek),
        ),
      });
    } else if (orderIndex !== undefined) {
      existingSlot = await db.query.trainingCycleSlots.findFirst({
        where: and(
          eq(trainingCycleSlots.trainingCycleId, trainingCycleId),
          eq(trainingCycleSlots.orderIndex, orderIndex),
        ),
      });
    }

    let slot: TrainingCycleSlot;
    if (existingSlot) {
      const [updated] = await db
        .update(trainingCycleSlots)
        .set({ ...rest, dayOfWeek, orderIndex })
        .where(eq(trainingCycleSlots.id, existingSlot.id))
        .returning();
      slot = updated;
    } else {
      const [inserted] = await db
        .insert(trainingCycleSlots)
        .values({ trainingCycleId, dayOfWeek, orderIndex, ...rest })
        .returning();
      slot = inserted;
    }

    revalidatePath(`/cycles/${trainingCycleId}`);
    return { success: true, data: slot };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function removeCycleSlot(
  slotId: number,
  cycleId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  try {
    const [cycle] = await db
      .select({ userId: trainingCycles.userId })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, cycleId))
      .limit(1);
    if (!cycle || cycle.userId !== auth.user.id) {
      return { success: false, error: "Cycle not found" };
    }
    await db
      .delete(trainingCycleSlots)
      .where(eq(trainingCycleSlots.id, slotId));
    revalidatePath(`/cycles/${cycleId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function reorderCycleSlots(
  cycleId: number,
  orderedIds: number[],
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const validation = reorderCycleSlotsSchema.safeParse({ cycleId, orderedIds });
  if (!validation.success) return { success: false, error: "Invalid input" };
  try {
    const [cycle] = await db
      .select({ userId: trainingCycles.userId })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, cycleId))
      .limit(1);
    if (!cycle || cycle.userId !== auth.user.id) {
      return { success: false, error: "Cycle not found" };
    }
    await Promise.all(
      validation.data.orderedIds.map((id, index) =>
        db
          .update(trainingCycleSlots)
          .set({ orderIndex: index + 1 })
          .where(eq(trainingCycleSlots.id, id)),
      ),
    );
    revalidatePath(`/cycles/${cycleId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function importCycle(
  data: unknown,
): Promise<ActionResult<{ cycleName: string; unresolvedPrograms: string[] }>> {
  const auth = await requireSession();

  const parsed = importCycleSchema.safeParse(data);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue
      ? `${firstIssue.path.join(".") || "cycle"}: ${firstIssue.message}`
      : null;
    return {
      success: false,
      error: detail
        ? `Cycle data is invalid — ${detail}`
        : "Cycle data is invalid. The AI may have used an unsupported format.",
    };
  }

  const { slots, weeks, sched, ...restCycleFields } = parsed.data;
  const cycleFields = { ...restCycleFields, durationWeeks: weeks, scheduleType: sched };

  // Resolve program names → IDs from the user's programs (includes just-imported ones)
  const programNames = [...new Set(slots.map((s) => s.prog))];
  const matched = programNames.length > 0
    ? await db
        .select({ id: programs.id, name: programs.name })
        .from(programs)
        .where(and(inArray(programs.name, programNames), eq(programs.userId, auth.user.id)))
    : [];

  const nameToId = new Map(matched.map((p) => [p.name, p.id]));

  // Detect slots whose program couldn't be resolved
  const unresolvedPrograms = [...new Set(
    slots.filter((s) => !nameToId.has(s.prog)).map((s) => s.prog),
  )];

  try {
    await db.transaction(async (tx) => {
      const [cycle] = await tx
        .insert(trainingCycles)
        .values({ ...cycleFields, userId: auth.user.id })
        .returning({ id: trainingCycles.id });

      for (const slot of slots) {
        await tx.insert(trainingCycleSlots).values({
          trainingCycleId: cycle.id,
          programId: nameToId.get(slot.prog) ?? null,
          dayOfWeek: slot.day,
          orderIndex: slot.idx,
          label: slot.label,
          notes: slot.notes,
        });
      }
    });

    revalidatePath("/cycles");
    revalidatePath("/");
    return { success: true, data: { cycleName: cycleFields.name, unresolvedPrograms } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
