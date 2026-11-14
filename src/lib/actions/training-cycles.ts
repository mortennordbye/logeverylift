"use server";

/**
 * Training Cycles Server Actions
 *
 * CRUD operations for training cycles (mesocycles) and their weekly slots.
 */

import { db } from "@/db";
import { dismissedMakeups, programExercises, programSets, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "@/db/schema";
import {
  cycleLoad,
  phaseLabel,
  phaseLayout,
  type TrainingGoal,
  type TrainingPhase,
} from "@/lib/utils/periodization";
import { applyWearableSuggestion, hasPeakAnchor, syncDueCycle, syncPeriodizedTargets } from "@/lib/periodization-sync";
import { insertAutoSessions } from "@/lib/auto-sessions";
import { declineDay, removeSlotInTx, rotationOverrides, skipAutoDay, upsertSlotInTx, weekdayToday } from "@/lib/planned-sessions";
import { enduranceEnabledFor } from "@/lib/endurance";
import { liveCycles, liveProgramExercises, liveProgramSets, livePrograms, liveSlotProgram } from "@/lib/plan-live";
import { OpenWorkoutError, PlanNotFoundError, PlanStateError, activateCycle, deleteCycles, liveSeasonId, planWrite, startDueScheduledCycle, type Tx } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { ForbiddenError, assertOwner, requireSession } from "@/lib/utils/session";
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
  TodaySession,
  TrainingCycle,
  TrainingCycleSlot,
  TrainingCycleSlotWithProgram,
  TrainingCycleWithSlots,
} from "@/types/workout";
import {
  autoCompleteDue,
  autoDayKey,
  cycleWeek,
  parseDateStr,
  resolveRotation,
  toDateStr,
} from "@/lib/utils/cycle-position";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { SEASON_CYCLE_LENGTH, SEASON_CYCLE_RACE } from "@/lib/utils/seasons";
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
      .where(and(eq(trainingCycles.userId, auth.user.id), liveCycles))
      .orderBy(asc(trainingCycles.status), asc(trainingCycles.createdAt));
    return { success: true, data: rows };
  } catch (err) {
    console.error("[getTrainingCycles] failed", err);
    return { success: false, error: "Failed to load the cycles" };
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
        liveCycles,
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

    return { success: true, data: { ...cycle, slots: cycle.slots.map(liveSlotProgram) } as TrainingCycleWithSlots };
  } catch (err) {
    console.error("[getTrainingCycleWithSlots] failed", err);
    return { success: false, error: "Failed to load the cycle" };
  }
}

export async function getAllCyclesWithSlots(): Promise<ActionResult<TrainingCycleWithSlots[]>> {
  const auth = await requireSession();
  try {
    const rows = await db.query.trainingCycles.findMany({
      where: and(eq(trainingCycles.userId, auth.user.id), liveCycles),
      orderBy: [asc(trainingCycles.startDate)],
      with: {
        slots: {
          orderBy: (s, { asc }) => [asc(s.dayOfWeek), asc(s.orderIndex)],
          with: { program: true },
        },
      },
    });
    return {
      success: true,
      data: rows.map((c) => ({ ...c, slots: c.slots.map(liveSlotProgram) })) as TrainingCycleWithSlots[],
    };
  } catch (err) {
    console.error("[getAllCyclesWithSlots] failed", err);
    return { success: false, error: "Failed to load the cycles" };
  }
}

/**
 * Run the active cycle's weekly periodization sync if this week's has not run
 * yet. Pages that read program sets await it *before* reading them: run in the
 * same Promise.all as the read, the read won and showed last week's targets
 * under this week's header (PZ-29). A no-op when the user has no active cycle,
 * when it is over (getActiveCycleForUser completes it), or when the week is
 * already synced, which is one indexed read.
 */
export async function syncActiveCyclePeriodization(): Promise<ActionResult<null>> {
  const auth = await requireSession();
  try {
    await syncDueCycle(auth.user.id);
    return { success: true, data: null };
  } catch (e) {
    console.error("[syncActiveCyclePeriodization] failed", e);
    return { success: false, error: "Failed to sync the training cycle" };
  }
}

export async function getActiveCycleForUser(): Promise<ActionResult<ActiveCycleInfo | null>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    // A block scheduled to start today (or earlier) becomes the active one
    // first, completing the old block then (docs/plans/ai-coach.md, decision 7).
    await startDueScheduledCycle(userId);
    const cycle = await db.query.trainingCycles.findFirst({
      where: and(
        eq(trainingCycles.userId, userId),
        eq(trainingCycles.status, "active"),
        liveCycles,
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

    const startDate = parseDateStr(cycle.startDate!);
    // Today in the user's zone (src/lib/utils/user-date.ts), not the server's.
    const today = await userToday(userId);

    const { currentWeek, endDate, isOver } = cycleWeek(startDate, cycle.durationWeeks, today, cycle.durationDays);
    const endDateStr = toDateStr(endDate);

    // Auto-complete once the block is over.
    //
    // No revalidatePath here: this is a read, and it is called from Server
    // Components during render, where revalidatePath is not allowed. It was
    // also pointless — the caller is rendering right now and already sees the
    // post-update result returned below, and every route that shows cycle
    // state resolves its data per request.
    if (isOver) {
      await planWrite({ userId, writer: "sync", reason: "The block ended" }, async (w) => {
        await w.touch({ type: "cycle", id: cycle.id });
        await w.tx.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.id, cycle.id));
      });
      return { success: true, data: null };
    }

    const slots = cycle.slots.map(liveSlotProgram) as TrainingCycleWithSlots["slots"];

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
    let todaySessions: TodaySession[] = [];
    let missedSlots: MissedSlot[] = [];

    if (cycle.scheduleType === "day_of_week") {
      // Weekday cycles read their dated sessions (docs/plans/sessions.md, 4.2).
      const day = await weekdayToday({ userId, cycleId: cycle.id, startDate, slots, today, missedEnabled });
      todaySlot = day.todaySlot;
      todaySessions = day.todaySessions;
      missedSlots = day.missedSlots;
    } else {
      // Rotation: walk forward from startDate, advancing position per-slot.
      // todaySlot is always needed; the missed list is gated on the opt-out.
      const sessions = await db
        .select({ programId: workoutSessions.programId, date: workoutSessions.date })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
            gte(workoutSessions.date, toDateStr(startDate)),
          ),
        );
      const sortedDates = sessions.map((s) => s.date).sort();
      // Skips and program changes stored on walk positions (4.3).
      const overrides = await rotationOverrides(db, cycle.id);
      const { todaySlotId, todayPosition, missed } = resolveRotation(
        startDate,
        slots,
        sortedDates,
        today,
        overrides.skipped,
      );
      todaySlot = todaySlotId != null ? (slotById.get(todaySlotId) ?? null) : null;
      if (todaySlot && overrides.skipped.has(todayPosition)) {
        todaySlot = null;
      } else if (todaySlot && overrides.changed.get(todayPosition)?.programId != null) {
        const [program] = await db
          .select()
          .from(programs)
          .where(and(eq(programs.id, overrides.changed.get(todayPosition)!.programId!), livePrograms));
        if (program) todaySlot = { ...todaySlot, programId: program.id, program };
      }

      // The walk never consumes today, so writing today's auto session doesn't
      // change todaySlot or missed; the rotation advances on its own tomorrow.
      if (todaySlot?.autoComplete) {
        const todayStr = toDateStr(today);
        const dismissed = await db
          .select({ date: dismissedMakeups.date })
          .from(dismissedMakeups)
          .where(and(eq(dismissedMakeups.userId, userId), eq(dismissedMakeups.date, todayStr)));
        const due = autoCompleteDue({
          scheduleType: "rotation",
          startDate,
          slots,
          todaySlotId: todaySlot.id,
          loggedKeys: new Set(
            sessions
              .filter((s) => s.programId != null)
              .map((s) => autoDayKey(s.programId!, s.date)),
          ),
          skippedDates: new Set(dismissed.map((d) => d.date)),
          today,
        });
        await insertAutoSessions(userId, due);
      }

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
        cycle: { ...cycle, slots } as unknown as TrainingCycleWithSlots,
        todaySlot,
        currentWeek,
        endDate: endDateStr,
        missedSlots,
        todaySessions,
      },
    };
  } catch (err) {
    console.error("[getActiveCycleForUser] failed", err);
    return { success: false, error: "Failed to load the active cycle" };
  }
}

const skipAutoCompletedDaySchema = z.object({
  sessionId: z.number().int().positive(),
});

/**
 * "I skipped it" on an auto-completed cycle day. Deletes the auto session and
 * records the date in dismissed_makeups, so getActiveCycleForUser neither
 * recreates it nor flags it as missed.
 */
export async function skipAutoCompletedDay(
  data: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = skipAutoCompletedDaySchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const [existing] = await db
      .select({
        userId: workoutSessions.userId,
        date: workoutSessions.date,
        source: workoutSessions.source,
        programId: workoutSessions.programId,
        plannedSessionId: workoutSessions.plannedSessionId,
      })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, parsed.data.sessionId));
    assertOwner(existing, auth.user.id);
    if (existing.source !== "auto") {
      return { success: false, error: "Only automatic days can be skipped" };
    }

    // The planned session it stood for is skipped and the auto row deleted in
    // one transaction (docs/plans/sessions.md, 4.4), so it is neither written
    // again nor missed.
    await skipAutoDay({ userId: auth.user.id, writer: "user" }, { id: parsed.data.sessionId, ...existing });
    revalidatePath("/");
    revalidatePath("/history");
    return { success: true, data: null };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[skipAutoCompletedDay] failed", e);
    return { success: false, error: "Failed to skip day" };
  }
}

const dismissMissedWorkoutSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  // The one dated session to skip. Without it (an older app), every session
  // planned that day is skipped, as a decline did before C2.
  plannedSessionId: z.number().int().positive().optional(),
});

/**
 * Decline a specific missed workout so it stops appearing in the "Missed this
 * week" list: its dated session is skipped (docs/plans/sessions.md, 4.4).
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
    await declineDay({ userId: auth.user.id, writer: "user" }, parsed.data.date, parsed.data.plannedSessionId);
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
      where: and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, auth.user.id), liveCycles),
      with: { slots: { with: { program: true } } },
    });
    if (!cycle) return { success: true, data: null };
    cycle.slots = cycle.slots.map(liveSlotProgram);

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
          hasPeakAnchor,
          liveProgramExercises,
          liveProgramSets,
        ),
      )
      .limit(1);
    if (!peak) return { success: true, data: null };

    const totalWeeks = cycle.durationWeeks;
    let currentWeek = 1;
    // The adaptation this summary scales by is the sync's output, so a new
    // week's phase must not be reported against last week's adaptation (PZ-40).
    let adaptationPct = cycle.adaptationPct;
    let adaptationNote = cycle.adaptationNote ?? null;
    if (cycle.status === "active" && cycle.startDate) {
      const week = cycleWeek(parseDateStr(cycle.startDate), totalWeeks, await userToday(auth.user.id), cycle.durationDays);
      currentWeek = week.currentWeek;
      if (!week.isOver && cycle.lastSyncedWeek !== currentWeek) {
        const adaptation = await syncPeriodizedTargets(cycle.id, auth.user.id, cycle.slots, currentWeek, totalWeeks, cycle.goal, cycle.athleteLevel);
        adaptationPct = adaptation.pct;
        adaptationNote = adaptation.note || null;
      }
    } else if (cycle.status === "completed") {
      currentWeek = totalWeeks;
    }

    const load = cycleLoad(cycle, currentWeek, totalWeeks);
    const { rampWeeks, peakWeeks } = phaseLayout(totalWeeks);
    // A typed phase of a season is one phase start to end: no peak or taper
    // inside it to count down to (docs/plans/seasons.md, 2.5).
    const peakStart = cycle.phaseType ? 0 : rampWeeks + 1;
    const taperStart = cycle.phaseType ? 0 : rampWeeks + peakWeeks + 1;
    // Show the *effective* volume — the curve after the no-wearable nudge — so the
    // displayed % matches what's actually prescribed this week.
    const effectiveMultiplier = Math.round(load.multiplier * adaptationPct) / 100;

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
        adaptationNote,
      },
    };
  } catch (err) {
    console.error("[getCyclePeriodization] failed", err);
    return { success: false, error: "Failed to load the periodization" };
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
          liveCycles,
        ),
      )
      .limit(1);
    if (!slot) return { success: true, data: null };
    return getCyclePeriodization(slot.cycleId);
  } catch (err) {
    console.error("[getProgramPeriodization] failed", err);
    return { success: false, error: "Failed to load the periodization" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

const cycleIdSchema = z.number().int().positive();
const cycleIdsSchema = z.array(cycleIdSchema);
const removeCycleSlotSchema = z.object({ slotId: z.number().int().positive(), cycleId: cycleIdSchema });

/**
 * Run a write to one cycle inside the revision layer (docs/plans/revisions.md,
 * 2.2). Null when it is not the caller's live cycle.
 */
async function writeCycle<T>(userId: string, cycleId: number, fn: (tx: Tx) => Promise<T>): Promise<{ result: T } | null> {
  try {
    const { result } = await planWrite({ userId, writer: "user" }, async (w) => {
      await w.touch({ type: "cycle", id: cycleId });
      return fn(w.tx);
    });
    return { result };
  } catch (e) {
    if (e instanceof PlanNotFoundError) return null;
    throw e;
  }
}


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
    const { result: cycle } = await planWrite({ userId: auth.user.id, writer: "user" }, async (w) => {
      const [row] = await w.tx
        .insert(trainingCycles)
        .values({ ...validation.data, userId: auth.user.id })
        .returning();
      w.create({ type: "cycle", id: row.id });
      return row;
    });

    revalidatePath("/cycles");
    return { success: true, data: cycle };
  } catch (err) {
    console.error("[createTrainingCycle] failed", err);
    return { success: false, error: "Failed to create the cycle" };
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
        liveCycles,
      ),
    });
    if (!existing) return { success: false, error: "Cycle not found" };

    // The race on a cycle is part of the endurance add-on (src/lib/endurance.ts).
    // A cycle that already has one keeps it editable, so no stored value is
    // locked away from its owner.
    // A cycle in a live season stores no race: the season holds it (D8). Its
    // length belongs to the season too, which re-chains the next phase.
    if ((await liveSeasonId(db, existing.seasonId)) != null) {
      if (rest.raceDate != null || rest.raceDistance != null) return { success: false, error: SEASON_CYCLE_RACE };
      if (rest.durationWeeks !== undefined && rest.durationWeeks !== existing.durationWeeks) {
        return { success: false, error: SEASON_CYCLE_LENGTH };
      }
    }
    const addsRace = (rest.raceDate != null || rest.raceDistance != null) && existing.raceDate == null;
    if (addsRace && !(await enduranceEnabledFor(auth.user.id))) {
      return { success: false, error: "Races are part of the endurance features, which are not on for this account" };
    }

    // Guard: disallow shortening an active cycle past its elapsed time
    if (rest.durationWeeks && existing.status === "active" && existing.startDate) {
      const { isOver } = cycleWeek(parseDateStr(existing.startDate), rest.durationWeeks, await userToday(auth.user.id));
      if (isOver) {
        return {
          success: false,
          error: "New duration would end the cycle immediately — choose a longer duration",
        };
      }
    }

    // A new block length moves every week's phase and multiplier. Clearing the
    // sync stamp makes the next read re-derive this week's targets.
    const durationChanged =
      rest.durationWeeks !== undefined && rest.durationWeeks !== existing.durationWeeks;

    const done = await writeCycle(auth.user.id, id, async (tx) => {
      const [row] = await tx
        .update(trainingCycles)
        .set({
          ...rest,
          ...(durationChanged && { lastSyncedWeek: null }),
          // A length in weeks replaces a length in days (T8).
          ...(rest.durationWeeks !== undefined && { durationDays: null }),
        } as Partial<typeof trainingCycles.$inferInsert>)
        .where(eq(trainingCycles.id, id))
        .returning();
      return row;
    });
    if (!done) return { success: false, error: "Cycle not found" };
    const cycle = done.result;

    revalidatePath("/cycles");
    revalidatePath(`/cycles/${id}`);
    return { success: true, data: cycle };
  } catch (err) {
    console.error("[updateTrainingCycle] failed", err);
    return { success: false, error: "Failed to update the cycle" };
  }
}

/**
 * Delete a cycle (softly), with the programs it generated, in one change set:
 * one restore brings them all back (docs/plans/revisions.md, 2.3).
 */
export async function deleteTrainingCycle(
  cycleId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  if (!cycleIdSchema.safeParse(cycleId).success) return { success: false, error: "Invalid input" };

  try {
    const [existing] = await db
      .select({ userId: trainingCycles.userId })
      .from(trainingCycles)
      .where(and(eq(trainingCycles.id, cycleId), liveCycles));
    if (!existing) return { success: false, error: "Training cycle not found" };
    if (existing.userId !== auth.user.id) return { success: false, error: "Unauthorized" };

    await deleteCycles({ userId: auth.user.id, writer: "user" }, [cycleId]);
    revalidatePath("/cycles");
    revalidatePath("/programs");
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof OpenWorkoutError || err instanceof PlanStateError) return { success: false, error: err.message };
    console.error("[deleteTrainingCycle] failed", err);
    return { success: false, error: "Failed to delete the cycle" };
  }
}

export async function deleteManyTrainingCycles(
  cycleIds: number[],
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const parsed = cycleIdsSchema.safeParse(cycleIds);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  if (parsed.data.length === 0) return { success: true, data: undefined };
  try {
    const owned = await db
      .select({ id: trainingCycles.id })
      .from(trainingCycles)
      .where(and(inArray(trainingCycles.id, parsed.data), eq(trainingCycles.userId, auth.user.id), liveCycles));
    if (owned.length > 0) {
      await deleteCycles({ userId: auth.user.id, writer: "user" }, owned.map((c) => c.id));
    }
    revalidatePath("/cycles");
    revalidatePath("/programs");
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof OpenWorkoutError || err instanceof PlanStateError) return { success: false, error: err.message };
    console.error("[deleteManyTrainingCycles] failed", err);
    return { success: false, error: "Failed to delete the cycles" };
  }
}

export async function startTrainingCycle(
  cycleId: number,
): Promise<ActionResult<TrainingCycle>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  if (!cycleIdSchema.safeParse(cycleId).success) return { success: false, error: "Invalid input" };

  try {
    // Only one active cycle at a time — any other active cycle completes.
    const cycle = await activateCycle({ userId, writer: "user" }, cycleId);

    revalidatePath("/cycles");
    revalidatePath(`/cycles/${cycleId}`);
    revalidatePath("/");
    return { success: true, data: cycle };
  } catch (err) {
    if (err instanceof PlanNotFoundError) return { success: false, error: "Training cycle not found" };
    if (err instanceof PlanStateError) return { success: false, error: err.message };
    console.error("[startTrainingCycle] failed", err);
    return { success: false, error: "Failed to start the cycle" };
  }
}

export async function restartTrainingCycle(
  cycleId: number,
): Promise<ActionResult<TrainingCycle>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  if (!cycleIdSchema.safeParse(cycleId).success) return { success: false, error: "Invalid input" };

  try {
    // Deactivate any currently active cycle, then start this one today.
    const cycle = await activateCycle({ userId, writer: "user" }, cycleId);

    revalidatePath("/cycles");
    revalidatePath(`/cycles/${cycleId}`);
    revalidatePath("/");
    return { success: true, data: cycle };
  } catch (err) {
    if (err instanceof PlanNotFoundError) return { success: false, error: "Cycle not found" };
    if (err instanceof PlanStateError) return { success: false, error: err.message };
    console.error("[restartTrainingCycle] failed", err);
    return { success: false, error: "Failed to restart the cycle" };
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

    const { trainingCycleId, dayOfWeek, orderIndex, daySlot, ...rest } = validation.data;

    // If assigning a program to the slot, verify the caller owns it — otherwise
    // a user could attach (and surface) another user's program in their cycle.
    if (rest.programId != null) {
      const [prog] = await db
        .select({ userId: programs.userId })
        .from(programs)
        .where(and(eq(programs.id, rest.programId), livePrograms))
        .limit(1);
      if (!prog || prog.userId !== auth.user.id) {
        return { success: false, error: "Program not found" };
      }
    }

    if (dayOfWeek === undefined && orderIndex === undefined) return { success: false, error: "Invalid input" };
    // A day can hold up to three sessions (docs/plans/sessions.md, 3.1).
    const done = await writeCycle(auth.user.id, trainingCycleId, (tx) =>
      upsertSlotInTx(tx, trainingCycleId, { dayOfWeek: dayOfWeek ?? null, orderIndex: orderIndex ?? null, daySlot }, rest),
    );
    if (!done) return { success: false, error: "Cycle not found" };

    revalidatePath(`/cycles/${trainingCycleId}`);
    revalidatePath("/");
    return { success: true, data: done.result as TrainingCycleSlot };
  } catch (err) {
    if (err instanceof PlanStateError) return { success: false, error: err.message };
    console.error("[upsertCycleSlot] failed", err);
    return { success: false, error: "Failed to save the slot" };
  }
}

export async function removeCycleSlot(
  slotId: number,
  cycleId: number,
): Promise<ActionResult<void>> {
  const auth = await requireSession();
  if (!removeCycleSlotSchema.safeParse({ slotId, cycleId }).success) return { success: false, error: "Invalid input" };
  try {
    // A hard delete: nothing logged points at a slot, and the cycle's history
    // keeps it for a restore (docs/plans/revisions.md, 2.3).
    const done = await writeCycle(auth.user.id, cycleId, (tx) => removeSlotInTx(tx, cycleId, slotId));
    if (!done) return { success: false, error: "Cycle not found" };
    revalidatePath(`/cycles/${cycleId}`);
    revalidatePath("/");
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[removeCycleSlot] failed", err);
    return { success: false, error: "Failed to remove the slot" };
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
    const done = await writeCycle(auth.user.id, cycleId, async (tx) => {
      // uniq_cycle_order is checked row by row, so a slot cannot take a place
      // another slot still holds. Park every slot on a negative place first,
      // then write the final places.
      for (const sign of [-1, 1]) {
        for (const [index, id] of validation.data.orderedIds.entries()) {
          await tx
            .update(trainingCycleSlots)
            .set({ orderIndex: sign * (index + 1) })
            .where(
              and(
                eq(trainingCycleSlots.id, id),
                eq(trainingCycleSlots.trainingCycleId, validation.data.cycleId),
              ),
            );
        }
      }
    });
    if (!done) return { success: false, error: "Cycle not found" };
    revalidatePath(`/cycles/${cycleId}`);
    return { success: true, data: undefined };
  } catch (err) {
    console.error("[reorderCycleSlots] failed", err);
    return { success: false, error: "Failed to reorder the slots" };
  }
}

export async function importCycle(
  data: unknown,
): Promise<ActionResult<{ cycleId: number; cycleName: string; unresolvedPrograms: string[] }>> {
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
        .where(and(inArray(programs.name, programNames), eq(programs.userId, auth.user.id), livePrograms))
    : [];

  const nameToId = new Map(matched.map((p) => [p.name, p.id]));

  // Detect slots whose program couldn't be resolved
  const unresolvedPrograms = [...new Set(
    slots.filter((s) => !nameToId.has(s.prog)).map((s) => s.prog),
  )];

  try {
    const { result: cycleId } = await planWrite({ userId: auth.user.id, writer: "user" }, async (w) => {
      const tx = w.tx;
      const [cycle] = await tx
        .insert(trainingCycles)
        .values({ ...cycleFields, userId: auth.user.id })
        .returning({ id: trainingCycles.id });
      w.create({ type: "cycle", id: cycle.id });

      for (const slot of slots) {
        await tx.insert(trainingCycleSlots).values({
          trainingCycleId: cycle.id,
          programId: nameToId.get(slot.prog) ?? null,
          dayOfWeek: slot.day,
          orderIndex: slot.idx,
          label: slot.label,
          notes: slot.notes,
          autoComplete: slot.auto ?? false,
        });
      }
      return cycle.id;
    });

    revalidatePath("/cycles");
    revalidatePath("/");
    return { success: true, data: { cycleId, cycleName: cycleFields.name, unresolvedPrograms } };
  } catch (err) {
    console.error("[importCycle] failed", err);
    return { success: false, error: "Failed to import the cycle" };
  }
}

/**
 * Apply the wearable suggestion for this week (docs/plans/garmin-insights-design.md,
 * 2.14, decision O-3: suggest first). The percent is recomputed on the server
 * from the user's own data; the client only asks.
 */
export async function applyWearablePlanSuggestion(): Promise<ActionResult<{ pct: number; note: string } | null>> {
  const auth = await requireSession();
  try {
    const applied = await applyWearableSuggestion(auth.user.id);
    revalidatePath("/cycles");
    revalidatePath("/more/garmin");
    return { success: true, data: applied ? { pct: applied.pct, note: applied.note } : null };
  } catch (e) {
    console.error("[applyWearablePlanSuggestion] failed", e instanceof Error ? e.message : "unknown");
    return { success: false, error: "Failed to apply the suggestion" };
  }
}
