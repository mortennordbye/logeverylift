"use server";

/**
 * Workout Set Server Actions
 *
 * Server actions for logging workout sets and fetching workout history.
 * These are the core functions for tracking workout performance.
 *
 * Key responsibilities:
 * - Log individual sets with weight, reps, RPE, and rest time
 * - Fetch workout history for progress tracking
 * - Enable future features: PR detection, auto-deload suggestions
 *
 * Usage in Client Components:
 * ```typescript
 * import { logWorkoutSet } from "@/lib/actions/workout-sets";
 *
 * const handleLogSet = async (setData) => {
 *   const result = await logWorkoutSet(setData);
 *   if (result.success) {
 *     // Start rest timer, update UI
 *   }
 * };
 * ```
 */

import { db } from "@/db";
import { exercisePrs, exercises, programExercises, programSets, programs, users, workoutSessions, workoutSets } from "@/db/schema";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import {
    matchingPaceBrackets,
    paceSecondsPerMeter,
    type Discipline,
} from "@/lib/utils/discipline";
import { parseUserGoals } from "@/lib/utils/goals";
import { rpeFromRir } from "@/lib/utils/rir";
import { requireSession } from "@/lib/utils/session";
import {
    logWorkoutSetSchema,
    unlogWorkoutSetSchema,
    workoutHistoryQuerySchema,
} from "@/lib/validators/workout";
import {
    buildSuggestion,
    CONSENSUS_WINDOW,
    estimate1RM,
    toScope,
} from "@/lib/utils/progression";
import type { ProgramSetData, SessionHistory } from "@/lib/utils/progression";
import type {
    ActionResult,
    ActiveCycleInfo,
    LogWorkoutSetResult,
    PRResult,
    SessionDetail,
    SessionWithStats,
    SetSuggestion,
    WorkoutHistoryResult,
    WorkoutSet,
    WorkoutSetWithExercise,
    WorkoutStats,
} from "@/types/workout";
import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * The plan slot a logged set belongs to.
 *
 * A program may hold the same exercise twice (heavy bench, then a back-off
 * bench). `workout_sets` used to be keyed on (session, exercise, setNumber), so
 * logging set 1 of the second slot overwrote set 1 of the first and the heavy
 * set's weight, reps and effort were gone. The slot is the identity; the
 * exercise is not.
 *
 * `programSetId` is resolved server-side rather than trusted from the payload:
 * it decides which row a write lands on, and a slot belonging to another
 * program must never be written into this session.
 */
type PlanSlot = {
  programExerciseId: number;
  programSetId: number | null;
  /** "working" | "warmup", snapshotted onto the row so the log describes itself. */
  setType: string;
  /** Working sets the slot prescribes right now. Null when the slot has none. */
  prescribedWorkingSets: number | null;
};

/**
 * Working sets currently prescribed by the slot that owns the row being
 * selected. Correlated rather than joined so it does not multiply the outer
 * rows, and inlined here so resolving a slot stays one round trip on the
 * hottest write path in the app.
 */
function workingSetCount(slotIdColumn: string) {
  return sql<number>`(
    SELECT COUNT(*)::int FROM "program_sets" wsc
    WHERE wsc."program_exercise_id" = ${sql.raw(slotIdColumn)}
      AND wsc."set_type" = 'working'
  )`;
}

/**
 * Resolve the plan slot for a set being logged into `session`.
 *
 * Returns `{ slot: null }` when there is nothing to resolve (an unprogrammed
 * session, or a program set deleted since the payload was queued). That is not
 * an error: the workout still happened and the row is still written, it just
 * carries no slot and is history-only from then on.
 *
 * Returns `{ error }` only when the caller named a slot that exists but belongs
 * to a different program.
 */
async function resolvePlanSlot(
  programId: number | null,
  exerciseId: number,
  setNumber: number,
  programSetId: number | undefined,
): Promise<{ slot: PlanSlot | null; error?: string }> {
  if (programId == null) return { slot: null };

  if (programSetId != null) {
    const [row] = await db
      .select({
        programSetId: programSets.id,
        programExerciseId: programSets.programExerciseId,
        programId: programExercises.programId,
        setType: programSets.setType,
        prescribedWorkingSets: workingSetCount('"program_sets"."program_exercise_id"'),
      })
      .from(programSets)
      .innerJoin(
        programExercises,
        eq(programExercises.id, programSets.programExerciseId),
      )
      .where(eq(programSets.id, programSetId))
      .limit(1);
    if (row) {
      if (row.programId !== programId) {
        return { slot: null, error: "Set does not belong to this program" };
      }
      return {
        slot: {
          programExerciseId: row.programExerciseId,
          programSetId: row.programSetId,
          setType: row.setType,
          prescribedWorkingSets: row.prescribedWorkingSets || null,
        },
      };
    }
    // Fall through: the set was deleted from the program after the payload was
    // queued. Resolve what we can from the exercise rather than dropping the
    // write.
  }

  // Legacy payload (a bundle cached before programSetId shipped, or a replay
  // queued by one). Resolving by exercise is ambiguous when the program holds
  // that exercise twice, which is the bug this column exists to fix — the
  // lowest slot id reproduces the previous behaviour rather than inventing a
  // new one.
  const [row] = await db
    .select({
      programExerciseId: programExercises.id,
      programSetId: programSets.id,
      setType: programSets.setType,
      prescribedWorkingSets: workingSetCount('"program_exercises"."id"'),
    })
    .from(programExercises)
    .leftJoin(
      programSets,
      and(
        eq(programSets.programExerciseId, programExercises.id),
        eq(programSets.setNumber, setNumber),
      ),
    )
    .where(
      and(
        eq(programExercises.programId, programId),
        eq(programExercises.exerciseId, exerciseId),
      ),
    )
    .orderBy(programExercises.id)
    .limit(1);

  if (!row) return { slot: null };
  return {
    slot: {
      programExerciseId: row.programExerciseId,
      programSetId: row.programSetId,
      // The left join misses when the plan has no set at that position, which
      // says nothing about whether the set logged there was a warm-up. Default
      // to the common case rather than guessing.
      setType: row.setType ?? "working",
      prescribedWorkingSets: row.prescribedWorkingSets || null,
    },
  };
}

/**
 * Match the one `workout_sets` row a set edit addresses, within a session.
 *
 * Prefers the plan slot. Falls back to the exercise for rows the migration
 * could not backfill a slot onto, and for slots deleted since — those still
 * carry the exercise, so an un-log or a note edit on them keeps working.
 */
function setRowKey(slot: PlanSlot | null, exerciseId: number, setNumber: number) {
  return and(
    eq(workoutSets.setNumber, setNumber),
    slot
      ? or(
          eq(workoutSets.programExerciseId, slot.programExerciseId),
          and(
            isNull(workoutSets.programExerciseId),
            eq(workoutSets.exerciseId, exerciseId),
          ),
        )
      : eq(workoutSets.exerciseId, exerciseId),
  );
}

/**
 * Resolve the program_set.id values for every completed workout_set in the
 * given active session. Used on workout-page mount to rehydrate the in-memory
 * `completedSetIds` set — necessary because that state lives only in React and
 * is lost when iOS evicts the PWA's JS context after backgrounding.
 *
 * Reads the slot the set was logged against. This used to re-derive it by
 * joining program_exercises on exercise_id, which returned both slots' set ids
 * when a program held the same exercise twice — ticking sets the user had not
 * done. A pre-migration row with no slot is skipped: its set renders unticked
 * and re-logging it is idempotent.
 */
export async function getActiveSessionCompletedProgramSetIds(
  sessionId: number,
): Promise<ActionResult<number[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select({ id: workoutSets.programSetId })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSets.sessionId, sessionId),
          eq(workoutSessions.userId, auth.user.id),
          eq(workoutSets.isCompleted, true),
          isNotNull(workoutSets.programSetId),
        ),
      );
    return { success: true, data: rows.map((r) => r.id!) };
  } catch (error) {
    console.error("[getActiveSessionCompletedProgramSetIds] failed", error);
    return { success: false, error: "Failed to fetch completed sets" };
  }
}

/**
 * Log a workout set
 *
 * Records a single set within a workout session. This is called after each
 * set is completed by the user.
 *
 * Future enhancement opportunities (marked with comments):
 * - Compare against historical data to detect PRs
 * - Analyze RPE trends to suggest deloads
 * - Calculate estimated 1RM using formulas
 *
 * @returns The created workout set on success
 */
export async function logWorkoutSet(
  data: unknown,
): Promise<ActionResult<LogWorkoutSetResult>> {
  const auth = await requireSession();

  try {
    // Validate input
    const validation = logWorkoutSetSchema.safeParse(data);

    if (!validation.success) {
      return {
        success: false,
        error: "Invalid input data",
        fieldErrors: validation.error.flatten().fieldErrors,
      };
    }

    const {
      sessionId,
      exerciseId,
      setNumber,
      programSetId,
      targetReps,
      actualReps,
      weightKg,
      durationSeconds,
      distanceMeters,
      inclinePercent,
      heartRateZone,
      rir,
      rpe,
      restTimeSeconds,
      notes,
      isCompleted,
      isFailed,
      wasEasy,
    } = validation.data;

    // RIR is the primary effort input; derive RPE from it so all downstream
    // RPE-based progression/adaptation keeps working. Fall back to the supplied
    // RPE for callers that report effort without RIR (e.g. logged runs).
    //
    // Null when neither was supplied: the lifter tapped the set done and said
    // nothing about how hard it was. That is stored as unknown, not as a
    // middling 7 — inventing an effort value is what made every logged set read
    // as a confident hit.
    const effectiveRpe = rir != null ? rpeFromRir(rir) : (rpe ?? null);

    // Verify the session belongs to the authenticated user
    const [session] = await db
      .select({ userId: workoutSessions.userId, programId: workoutSessions.programId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1);
    if (!session || session.userId !== auth.user.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Which plan slot this row belongs to. Resolved before the write because it
    // is part of the row's identity: the upsert below conflicts on it.
    const resolved = await resolvePlanSlot(
      session.programId,
      exerciseId,
      setNumber,
      programSetId,
    );
    if (resolved.error) {
      console.error("[logWorkoutSet] slot_program_mismatch", {
        sessionId,
        programSetId,
      });
      return { success: false, error: resolved.error };
    }
    const slot = resolved.slot;

    // Timed exercises must record a duration. Without this guard, a quick-tap
    // completion (no override, program had no planned duration) silently logs
    // duration=null, which then displays as "—" forever in history.
    if (isCompleted) {
      const [exercise] = await db
        .select({ isTimed: exercises.isTimed, category: exercises.category })
        .from(exercises)
        .where(eq(exercises.id, exerciseId))
        .limit(1);
      const isCardio = exercise?.category === "cardio";
      if (exercise?.isTimed && !isCardio) {
        if (durationSeconds == null || durationSeconds <= 0) {
          return {
            success: false,
            error: "Duration is required for timed exercises",
            fieldErrors: { durationSeconds: ["Duration must be greater than 0"] },
          };
        }
      }
    }

    // Upsert on the (session, plan slot, set_number) unique key. A plain insert
    // would throw on the second write for the same set, which the caller then
    // had to treat as success — silently discarding the user's corrected
    // weight/reps/RIR. Re-logging a set must overwrite it.
    //
    // When the slot could not be resolved the key holds a null and Postgres
    // treats it as distinct, so nothing conflicts and the row is inserted. That
    // only happens for an unprogrammed session or a set deleted from the plan
    // mid-workout; both are better recorded twice than lost.
    //
    // Replays from the offline queue land here too and are idempotent: the row
    // is rewritten with the same values, and PR detection below only inserts
    // when a value strictly beats the current record.
    const setValues = {
      sessionId,
      exerciseId,
      programExerciseId: slot?.programExerciseId ?? null,
      programSetId: slot?.programSetId ?? null,
      setType: slot?.setType ?? "working",
      prescribedWorkingSets: slot?.prescribedWorkingSets ?? null,
      setNumber,
      targetReps,
      actualReps,
      weightKg: weightKg.toString(),
      durationSeconds,
      distanceMeters,
      inclinePercent,
      heartRateZone,
      rir,
      rpe: effectiveRpe,
      restTimeSeconds,
      notes,
      isCompleted,
      isFailed,
      wasEasy,
    };
    const [set] = await db
      .insert(workoutSets)
      .values(setValues)
      .onConflictDoUpdate({
        target: [
          workoutSets.sessionId,
          workoutSets.programExerciseId,
          workoutSets.setNumber,
        ],
        // createdAt is deliberately not updated — it stays the time the set was
        // first logged.
        set: {
          programSetId: setValues.programSetId,
          setType: setValues.setType,
          prescribedWorkingSets: setValues.prescribedWorkingSets,
          targetReps: setValues.targetReps ?? null,
          actualReps: setValues.actualReps,
          weightKg: setValues.weightKg,
          durationSeconds: setValues.durationSeconds ?? null,
          distanceMeters: setValues.distanceMeters ?? null,
          inclinePercent: setValues.inclinePercent ?? null,
          heartRateZone: setValues.heartRateZone ?? null,
          rir: setValues.rir ?? null,
          rpe: setValues.rpe,
          restTimeSeconds: setValues.restTimeSeconds,
          notes: setValues.notes ?? null,
          isCompleted: setValues.isCompleted,
          isFailed: setValues.isFailed,
          wasEasy: setValues.wasEasy,
        },
      })
      .returning();

    // PR Detection: check for new records using the authenticated user's ID
    let newPRs: PRResult[] = [];
    if (actualReps > 0 && weightKg > 0) {
      newPRs = await detectAndRecordPRs({
        userId: auth.user.id,
        exerciseId,
        sessionId,
        setId: set.id,
        weightKg,
        actualReps,
      });
    }
    // Endurance PRs (swim/bike/run): distance + pace-per-bracket. Independent of
    // the weight path — endurance sets carry distance, not weight.
    if (distanceMeters != null && distanceMeters > 0) {
      const endurancePRs = await detectAndRecordEndurancePRs({
        userId: auth.user.id,
        exerciseId,
        sessionId,
        setId: set.id,
        distanceMeters,
        durationSeconds: durationSeconds ?? 0,
      });
      newPRs.push(...endurancePRs);
    }

    // `/workout/[sessionId]` is not a route; the screen this write affects is
    // /programs/[id]/workout (and its exercise subtree, covered by the layout
    // segment). Without this the router cache served up-to-30s-stale insight
    // and suggestions after logging a set.
    if (session.programId != null) {
      revalidatePath(`/programs/${session.programId}/workout`, "layout");
    }
    revalidatePath("/history");

    return {
      success: true,
      data: { set, newPRs },
    };
  } catch (error) {
    console.error("[logWorkoutSet] failed", error);
    return {
      success: false,
      error: "Failed to log workout set. Please try again.",
    };
  }
}

/**
 * Un-log a workout set
 *
 * Removes the row written by logWorkoutSet for (session, plan slot, setNumber).
 * The row is deleted rather than flagged is_completed = false because the
 * metrics aggregates filter on workout_sessions.isCompleted, not on the set
 * flag — a lingering row would keep counting toward volume.
 *
 * Any PRs the set earned are rolled back, otherwise un-logging a mistyped
 * 200 kg set would leave a permanent phantom record that suppresses every
 * genuine PR below it.
 */
export async function unlogWorkoutSet(
  data: unknown,
): Promise<ActionResult<void>> {
  const auth = await requireSession();

  const validation = unlogWorkoutSetSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input data",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }
  const { sessionId, exerciseId, setNumber, programSetId } = validation.data;

  try {
    const [session] = await db
      .select({ userId: workoutSessions.userId, programId: workoutSessions.programId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1);
    if (!session || session.userId !== auth.user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const resolved = await resolvePlanSlot(
      session.programId,
      exerciseId,
      setNumber,
      programSetId,
    );
    if (resolved.error) {
      console.error("[unlogWorkoutSet] slot_program_mismatch", {
        sessionId,
        programSetId,
      });
      return { success: false, error: resolved.error };
    }

    const [existing] = await db
      .select({ id: workoutSets.id })
      .from(workoutSets)
      .where(and(eq(workoutSets.sessionId, sessionId), setRowKey(resolved.slot, exerciseId, setNumber)))
      .limit(1);

    // Already absent — the user un-logged a set that never reached the server
    // (offline queue, failed write). Nothing to do, and reporting success keeps
    // the replay queue from looping.
    if (!existing) return { success: true, data: undefined };

    await rollbackPRsForSet(auth.user.id, existing.id);

    await db.delete(workoutSets).where(eq(workoutSets.id, existing.id));

    revalidatePath("/history");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("[unlogWorkoutSet] failed", error);
    return {
      success: false,
      error: "Failed to remove workout set. Please try again.",
    };
  }
}

/**
 * Undo the PR rows a single set produced.
 *
 * For each PR the set earned: delete it, then un-supersede the record it beat
 * (the most recently superseded row of the same type for that exercise — which
 * is the one this PR displaced, since a PR only supersedes the current record).
 */
async function rollbackPRsForSet(userId: string, setId: number): Promise<void> {
  const earned = await db
    .select()
    .from(exercisePrs)
    .where(and(eq(exercisePrs.userId, userId), eq(exercisePrs.setId, setId)));

  for (const pr of earned) {
    await db.delete(exercisePrs).where(eq(exercisePrs.id, pr.id));

    // reps_at_weight PRs are per-load, so the displaced record must match the
    // same ±0.5 kg bracket used when the PR was detected.
    const sameBracket =
      pr.prType === "reps_at_weight" && pr.weightKg != null
        ? [sql`ABS(CAST(${exercisePrs.weightKg} AS numeric) - ${Number(pr.weightKg)}) <= 0.5`]
        : [];

    const [displaced] = await db
      .select({ id: exercisePrs.id })
      .from(exercisePrs)
      .where(
        and(
          eq(exercisePrs.userId, userId),
          eq(exercisePrs.exerciseId, pr.exerciseId),
          eq(exercisePrs.prType, pr.prType),
          isNotNull(exercisePrs.supersededAt),
          ...sameBracket,
        ),
      )
      .orderBy(desc(exercisePrs.supersededAt))
      .limit(1);

    if (displaced) {
      await db
        .update(exercisePrs)
        .set({ supersededAt: null })
        .where(eq(exercisePrs.id, displaced.id));
    }
  }
}

// ─── PR Detection ─────────────────────────────────────────────────────────────

async function detectAndRecordPRs({
  userId,
  exerciseId,
  sessionId,
  setId,
  weightKg,
  actualReps,
}: {
  userId: string;
  exerciseId: number;
  sessionId: number;
  setId: number;
  weightKg: number;
  actualReps: number;
}): Promise<PRResult[]> {
  const newPRs: PRResult[] = [];
  const now = new Date();

  // Bodyweight / timed sets have no meaningful weight PR — skip entirely
  if (weightKg <= 0) return newPRs;

  try {
    // 1. Weight PR — heaviest single set ever
    const [currentWeightPR] = await db
      .select()
      .from(exercisePrs)
      .where(
        and(
          eq(exercisePrs.userId, userId),
          eq(exercisePrs.exerciseId, exerciseId),
          eq(exercisePrs.prType, "weight"),
          isNull(exercisePrs.supersededAt),
        ),
      )
      .limit(1);

    if (!currentWeightPR || weightKg > Number(currentWeightPR.value)) {
      if (currentWeightPR) {
        await db
          .update(exercisePrs)
          .set({ supersededAt: now })
          .where(and(eq(exercisePrs.id, currentWeightPR.id), isNull(exercisePrs.supersededAt)));
      }
      await db.insert(exercisePrs).values({
        userId,
        exerciseId,
        prType: "weight",
        value: weightKg.toFixed(2),
        sessionId,
        setId,
      });
      newPRs.push({
        type: "weight",
        value: weightKg,
        previousValue: currentWeightPR ? Number(currentWeightPR.value) : undefined,
      });
    }

    // 2. Estimated 1RM PR — Epley formula, valid for 2–12 reps
    if (actualReps >= 2 && actualReps <= 12) {
      const new1RM = estimate1RM(weightKg, actualReps);
      const [current1RMPR] = await db
        .select()
        .from(exercisePrs)
        .where(
          and(
            eq(exercisePrs.userId, userId),
            eq(exercisePrs.exerciseId, exerciseId),
            eq(exercisePrs.prType, "estimated_1rm"),
            isNull(exercisePrs.supersededAt),
          ),
        )
        .limit(1);

      if (!current1RMPR || new1RM > Number(current1RMPR.value)) {
        if (current1RMPR) {
          await db
            .update(exercisePrs)
            .set({ supersededAt: now })
            .where(and(eq(exercisePrs.id, current1RMPR.id), isNull(exercisePrs.supersededAt)));
        }
        await db.insert(exercisePrs).values({
          userId,
          exerciseId,
          prType: "estimated_1rm",
          value: new1RM.toFixed(2),
          weightKg: weightKg.toFixed(2),
          sessionId,
          setId,
        });
        newPRs.push({
          type: "estimated_1rm",
          value: Math.round(new1RM * 10) / 10,
          previousValue: current1RMPR
            ? Math.round(Number(current1RMPR.value) * 10) / 10
            : undefined,
        });
      }
    }

    // 3. Reps-at-weight PR — most reps ever at this load (±0.5 kg)
    if (actualReps > 0) {
      const [currentRepsAtWeightPR] = await db
        .select()
        .from(exercisePrs)
        .where(
          and(
            eq(exercisePrs.userId, userId),
            eq(exercisePrs.exerciseId, exerciseId),
            eq(exercisePrs.prType, "reps_at_weight"),
            sql`ABS(CAST(${exercisePrs.weightKg} AS numeric) - ${weightKg}) <= 0.5`,
            isNull(exercisePrs.supersededAt),
          ),
        )
        .limit(1);

      if (!currentRepsAtWeightPR || actualReps > Number(currentRepsAtWeightPR.value)) {
        if (currentRepsAtWeightPR) {
          await db
            .update(exercisePrs)
            .set({ supersededAt: now })
            .where(and(eq(exercisePrs.id, currentRepsAtWeightPR.id), isNull(exercisePrs.supersededAt)));
        }
        await db.insert(exercisePrs).values({
          userId,
          exerciseId,
          prType: "reps_at_weight",
          value: actualReps.toString(),
          weightKg: weightKg.toFixed(2),
          sessionId,
          setId,
        });
        newPRs.push({
          type: "reps_at_weight",
          value: actualReps,
          previousValue: currentRepsAtWeightPR
            ? Number(currentRepsAtWeightPR.value)
            : undefined,
        });
      }
    }
  } catch (err) {
    // PR detection is non-critical — log and continue
    console.error("[logWorkoutSet] pr_detection_failed", err);
  }

  return newPRs;
}

/**
 * Endurance PR detection for swim/bike/run sets. Records two kinds of record:
 *   - distance: the longest single set ever for this exercise (value = meters)
 *   - pace:     the fastest pace within each standard distance bracket the set
 *               falls into (value = duration seconds, distance_meters = the
 *               effort's distance; faster = lower duration/distance ratio)
 * No-ops for non-discipline exercises. Non-critical — failures are logged.
 */
async function detectAndRecordEndurancePRs({
  userId,
  exerciseId,
  sessionId,
  setId,
  distanceMeters,
  durationSeconds,
}: {
  userId: string;
  exerciseId: number;
  sessionId: number;
  setId: number;
  distanceMeters: number;
  durationSeconds: number;
}): Promise<PRResult[]> {
  const newPRs: PRResult[] = [];
  if (distanceMeters <= 0) return newPRs;

  try {
    // Only swim/bike/run exercises carry endurance PRs.
    const [exercise] = await db
      .select({ discipline: exercises.discipline })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1);
    const discipline = exercise?.discipline as Discipline | null | undefined;
    if (!discipline) return newPRs;

    const now = new Date();

    // 1. Distance PR — longest single endurance set ever.
    const [currentDistancePR] = await db
      .select()
      .from(exercisePrs)
      .where(
        and(
          eq(exercisePrs.userId, userId),
          eq(exercisePrs.exerciseId, exerciseId),
          eq(exercisePrs.prType, "distance"),
          isNull(exercisePrs.supersededAt),
        ),
      )
      .limit(1);

    if (!currentDistancePR || distanceMeters > Number(currentDistancePR.value)) {
      if (currentDistancePR) {
        await db
          .update(exercisePrs)
          .set({ supersededAt: now })
          .where(and(eq(exercisePrs.id, currentDistancePR.id), isNull(exercisePrs.supersededAt)));
      }
      await db.insert(exercisePrs).values({
        userId,
        exerciseId,
        prType: "distance",
        value: distanceMeters.toFixed(2),
        distanceMeters,
        sessionId,
        setId,
      });
      newPRs.push({
        type: "distance",
        value: distanceMeters,
        previousValue: currentDistancePR ? Number(currentDistancePR.value) : undefined,
        discipline,
      });
    }

    // 2. Pace PR — fastest pace in each standard distance bracket this set hits.
    if (durationSeconds > 0) {
      const newPace = paceSecondsPerMeter(durationSeconds, distanceMeters);
      for (const bracket of matchingPaceBrackets(discipline, distanceMeters)) {
        const [currentPacePR] = await db
          .select()
          .from(exercisePrs)
          .where(
            and(
              eq(exercisePrs.userId, userId),
              eq(exercisePrs.exerciseId, exerciseId),
              eq(exercisePrs.prType, "pace"),
              eq(exercisePrs.bracket, bracket.label),
              isNull(exercisePrs.supersededAt),
            ),
          )
          .limit(1);

        const currentPace = currentPacePR
          ? paceSecondsPerMeter(Number(currentPacePR.value), Number(currentPacePR.distanceMeters))
          : Infinity;

        if (newPace < currentPace) {
          if (currentPacePR) {
            await db
              .update(exercisePrs)
              .set({ supersededAt: now })
              .where(and(eq(exercisePrs.id, currentPacePR.id), isNull(exercisePrs.supersededAt)));
          }
          await db.insert(exercisePrs).values({
            userId,
            exerciseId,
            prType: "pace",
            value: durationSeconds.toFixed(2),
            distanceMeters,
            bracket: bracket.label,
            sessionId,
            setId,
          });
          newPRs.push({
            type: "pace",
            value: durationSeconds,
            previousValue: currentPacePR ? Number(currentPacePR.value) : undefined,
            discipline,
            distanceMeters,
            bracket: bracket.label,
          });
        }
      }
    }
  } catch (err) {
    console.error("[logWorkoutSet] endurance_pr_detection_failed", err);
  }

  return newPRs;
}

/**
 * Get the current (non-superseded) personal records for an exercise.
 * Returns a map of prType → value number.
 */
export async function getExercisePRs(
  exerciseId: number,
): Promise<ActionResult<Record<string, number>>> {
  const auth = await requireSession();
  try {
    const prs = await db
      .select({
        prType: exercisePrs.prType,
        value: exercisePrs.value,
      })
      .from(exercisePrs)
      .where(
        and(
          eq(exercisePrs.userId, auth.user.id),
          eq(exercisePrs.exerciseId, exerciseId),
          isNull(exercisePrs.supersededAt),
        ),
      );

    const result: Record<string, number> = {};
    for (const pr of prs) {
      result[pr.prType] = Number(pr.value);
    }
    return { success: true, data: result };
  } catch (error) {
    console.error("[getExercisePRs] failed", error);
    return { success: false, error: "Failed to fetch PRs" };
  }
}

/**
 * Get aggregate workout stats for the home page dashboard.
 *
 * - totalWorkouts: all completed sessions (lifetime)
 * - totalReps / totalSets: lifetime totals across all logged sets
 * - thisWeekWorkouts: completed sessions in the current Mon–Sun week
 */
export async function getWorkoutStats(): Promise<ActionResult<WorkoutStats>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const [
      [totals],
      [thisWeek],
    ] = await Promise.all([
      // Lifetime totals
      db
        .select({
          totalWorkouts: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
          totalReps: sql<number>`COALESCE(SUM(${workoutSets.actualReps}), 0)`,
          totalSets: sql<number>`COUNT(${workoutSets.id})`,
        })
        .from(workoutSessions)
        .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
          ),
        ),
      // This week's session count (Monday 00:00 UTC to now)
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.isCompleted, true),
            sql`${workoutSessions.startTime} >= date_trunc('week', NOW())`,
          ),
        ),
    ]);

    return {
      success: true,
      data: {
        totalWorkouts: Number(totals.totalWorkouts),
        totalReps: Number(totals.totalReps),
        totalSets: Number(totals.totalSets),
        thisWeekWorkouts: Number(thisWeek.count),
      },
    };
  } catch (error) {
    console.error("[getWorkoutStats] failed", error);
    return { success: false, error: "Failed to fetch workout stats" };
  }
}

/**
 * Get workout history for a specific exercise
 *
 * Retrieves all sets performed for an exercise, ordered by date.
 * Used to display progress charts and analyze performance trends.
 *
 * This data powers:
 * - Progress tracking charts
 * - PR detection (heaviest weight, most reps, best estimated 1RM)
 * - Volume calculations (total sets × reps × weight)
 * - RPE trend analysis (detecting overtraining)
 *
 * @returns Paginated workout history
 */
export async function getWorkoutHistory(
  data: unknown,
): Promise<ActionResult<WorkoutHistoryResult>> {
  const auth = await requireSession();
  try {
    // Validate input
    const validation = workoutHistoryQuerySchema.safeParse(data);

    if (!validation.success) {
      return {
        success: false,
        error: "Invalid query parameters",
        fieldErrors: validation.error.flatten().fieldErrors,
      };
    }

    const { exerciseId, limit = 50, offset = 0 } = validation.data;
    const userId = auth.user.id;

    // Build query conditions
    const conditions = [
      eq(workoutSessions.userId, userId),
      eq(workoutSessions.isCompleted, true),
    ];

    if (exerciseId) {
      conditions.push(eq(workoutSets.exerciseId, exerciseId));
    }

    // Fetch sets with related data
    const sets = await db
      .select({
        id: workoutSets.id,
        sessionId: workoutSets.sessionId,
        exerciseId: workoutSets.exerciseId,
        setNumber: workoutSets.setNumber,
        targetReps: workoutSets.targetReps,
        actualReps: workoutSets.actualReps,
        weightKg: workoutSets.weightKg,
        rpe: workoutSets.rpe,
        restTimeSeconds: workoutSets.restTimeSeconds,
        isCompleted: workoutSets.isCompleted,
        createdAt: workoutSets.createdAt,
        exercise: {
          id: exercises.id,
          name: exercises.name,
          category: exercises.category,
          isCustom: exercises.isCustom,
        },
        workoutSession: {
          date: workoutSessions.date,
          startTime: workoutSessions.startTime,
        },
      })
      .from(workoutSets)
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .where(and(...conditions))
      .orderBy(desc(workoutSets.createdAt))
      .limit(limit + 1) // Fetch one extra to check if there are more
      .offset(offset);

    // Check if there are more results
    const hasMore = sets.length > limit;
    const resultSets = hasMore ? sets.slice(0, limit) : sets;

    // Count total matching records (for pagination)
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .where(and(...conditions));

    return {
      success: true,
      data: {
        sets: resultSets as unknown as WorkoutSetWithExercise[],
        totalCount: Number(count),
        hasMore,
      },
    };
  } catch (error) {
    console.error("[getWorkoutHistory] failed", error);
    return {
      success: false,
      error: "Failed to fetch workout history. Please try again.",
    };
  }
}

/**
 * Get all completed sessions for a user with aggregate stats.
 * Used for the history list view.
 */
export async function getCompletedSessions(
  since?: Date,
): Promise<ActionResult<SessionWithStats[]>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const rows = await db
      .select({
        id: workoutSessions.id,
        userId: workoutSessions.userId,
        programId: workoutSessions.programId,
        date: workoutSessions.date,
        startTime: workoutSessions.startTime,
        endTime: workoutSessions.endTime,
        notes: workoutSessions.notes,
        feeling: workoutSessions.feeling,
        isCompleted: workoutSessions.isCompleted,
        readiness: workoutSessions.readiness,
        intendedDate: workoutSessions.intendedDate,
        programName: programs.name,
        setCount: sql<number>`COUNT(${workoutSets.id})`,
        exerciseCount: sql<number>`COUNT(DISTINCT ${workoutSets.exerciseId})`,
        totalVolumeKg: sql<string>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
        exerciseNames: sql<string[]>`COALESCE(ARRAY_AGG(DISTINCT ${exercises.name}) FILTER (WHERE ${exercises.name} IS NOT NULL), ARRAY[]::text[])`,
      })
      .from(workoutSessions)
      .leftJoin(programs, eq(workoutSessions.programId, programs.id))
      .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
      .leftJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.isCompleted, true),
          since ? gte(workoutSessions.startTime, since) : undefined,
        ),
      )
      .groupBy(
        workoutSessions.id,
        workoutSessions.userId,
        workoutSessions.programId,
        workoutSessions.date,
        workoutSessions.startTime,
        workoutSessions.endTime,
        workoutSessions.notes,
        workoutSessions.feeling,
        workoutSessions.isCompleted,
        workoutSessions.readiness,
        workoutSessions.intendedDate,
        programs.name,
      )
      .orderBy(desc(workoutSessions.startTime));

    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        programName: row.programName ?? null,
        setCount: Number(row.setCount),
        exerciseCount: Number(row.exerciseCount),
        totalVolumeKg: Number(row.totalVolumeKg),
        exerciseNames: row.exerciseNames ?? [],
        durationMinutes:
          row.endTime && row.startTime
            ? Math.max(
                1,
                Math.round(
                  (row.endTime.getTime() - row.startTime.getTime()) / 60000,
                ),
              )
            : 0,
      })),
    };
  } catch (error) {
    console.error("[getCompletedSessions] failed", error);
    return { success: false, error: "Failed to fetch workout history" };
  }
}

/**
 * Get full detail for a single session, with sets grouped by exercise.
 */
export async function getSessionDetail(
  sessionId: number,
): Promise<ActionResult<SessionDetail>> {
  const auth = await requireSession();
  try {
    const [[sessionRow], setsRows] = await Promise.all([
      db
        .select({
          id: workoutSessions.id,
          userId: workoutSessions.userId,
          programId: workoutSessions.programId,
          date: workoutSessions.date,
          startTime: workoutSessions.startTime,
          endTime: workoutSessions.endTime,
          notes: workoutSessions.notes,
          feeling: workoutSessions.feeling,
          isCompleted: workoutSessions.isCompleted,
          readiness: workoutSessions.readiness,
          intendedDate: workoutSessions.intendedDate,
          programName: programs.name,
        })
        .from(workoutSessions)
        .leftJoin(programs, eq(workoutSessions.programId, programs.id))
        .where(
          and(
            eq(workoutSessions.id, sessionId),
            eq(workoutSessions.userId, auth.user.id),
          ),
        ),
      db
        .select({ set: workoutSets, exerciseName: exercises.name, exerciseCategory: exercises.category, exerciseId: exercises.id })
        .from(workoutSets)
        .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
        .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
        .where(
          and(
            eq(workoutSets.sessionId, sessionId),
            eq(workoutSessions.userId, auth.user.id),
          ),
        )
        .orderBy(workoutSets.exerciseId, workoutSets.setNumber),
    ]);

    if (!sessionRow) {
      return { success: false, error: "Session not found" };
    }

    // Group by exercise id (to avoid collision on same-named exercises)
    const exerciseMap = new Map<
      number,
      { exerciseName: string; exerciseCategory: string; sets: WorkoutSet[] }
    >();
    for (const row of setsRows) {
      if (!exerciseMap.has(row.exerciseId)) {
        exerciseMap.set(row.exerciseId, {
          exerciseName: row.exerciseName,
          exerciseCategory: row.exerciseCategory ?? "strength",
          sets: [],
        });
      }
      exerciseMap.get(row.exerciseId)!.sets.push(row.set);
    }

    return {
      success: true,
      data: {
        ...sessionRow,
        programName: sessionRow.programName ?? null,
        setsByExercise: Array.from(exerciseMap.values()),
      },
    };
  } catch (error) {
    console.error("[getSessionDetail] failed", error);
    return { success: false, error: "Failed to fetch session detail" };
  }
}

/**
 * Attach (or replace) a free-text note on an already-logged workout set.
 * Used by SetEditView when the lifter taps a completed set to record an
 * observation ("shoulder twinge", "felt easy"). Resolves the workout_sets
 * row by (sessionId, plan slot, setNumber). If no row exists yet, returns
 * `success: true` without writing — the override carries the note forward
 * on the next `logWorkoutSet` call.
 */
export async function updateWorkoutSetNotes(
  data: {
    sessionId: number;
    exerciseId: number;
    setNumber: number;
    programSetId?: number;
    notes: string | null;
  },
): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  try {
    if (data.notes != null && data.notes.length > 500) {
      return { success: false, error: "Notes must be 500 characters or less" };
    }
    // Verify the session belongs to the user before touching anything
    const [session] = await db
      .select({ userId: workoutSessions.userId, programId: workoutSessions.programId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, data.sessionId))
      .limit(1);
    if (!session || session.userId !== auth.user.id) {
      return { success: false, error: "Unauthorized" };
    }
    const resolved = await resolvePlanSlot(
      session.programId,
      data.exerciseId,
      data.setNumber,
      data.programSetId,
    );
    if (resolved.error) {
      console.error("[updateWorkoutSetNotes] slot_program_mismatch", {
        sessionId: data.sessionId,
        programSetId: data.programSetId,
      });
      return { success: false, error: resolved.error };
    }
    await db
      .update(workoutSets)
      .set({ notes: data.notes })
      .where(
        and(
          eq(workoutSets.sessionId, data.sessionId),
          setRowKey(resolved.slot, data.exerciseId, data.setNumber),
        ),
      );
    revalidatePath(`/history`);
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[updateWorkoutSetNotes] failed", e);
    return { success: false, error: "Failed to save note" };
  }
}

/**
 * Calculate progressive overload suggestions for every set in a program.
 *
 * The window is the last CONSENSUS_WINDOW completed *sessions* per plan slot,
 * each carrying every working set logged in it. It used to be the last N rows
 * for one exercise + set number, which had two defects this query fixes:
 *
 *  - Each set of a 4x12 banked its own count, so the plan could ratchet to
 *    62.5 / 60 / 60 / 60 with no session ever having cleared. "Did the workout
 *    clear?" is a question about a session, and it was never asked.
 *  - A single global LIMIT across every set of every exercise starved the
 *    window on large programs: the sets of the most recent exercises consumed
 *    it and the rest got nothing. The DENSE_RANK partitions per slot, so each
 *    exercise gets its own five sessions regardless of how many there are.
 *
 * Two filters are load-bearing. **In-progress sessions are excluded**, which is
 * what makes an "easy" verdict affect the next workout rather than the current
 * one. **Tired sessions are no longer excluded here**: the blanket exclusion
 * froze progression and showed stale numbers for anyone who reported fatigue
 * honestly. The engine holds a Tired session's misses harmless instead, and
 * still counts its clears.
 */
export async function getProgressiveSuggestions(
  programId: number,
): Promise<ActionResult<Record<number, SetSuggestion>>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    // Ownership gate: never read a program's blueprint for a program the caller
    // doesn't own. Without this, any programId leaks another user's plan.
    const [owned] = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
      .limit(1);
    if (!owned) {
      return { success: true, data: {} };
    }

    // Step 1: get all program sets for this program with exercise metadata
    const programData = await db
      .select({
        programSetId: programSets.id,
        programExerciseId: programExercises.id,
        setNumber: programSets.setNumber,
        targetReps: programSets.targetReps,
        repRangeMin: programSets.repRangeMin,
        repRangeMax: programSets.repRangeMax,
        durationSeconds: programSets.durationSeconds,
        distanceMeters: programSets.distanceMeters,
        setType: programSets.setType,
        // The effort cap — axis 3. Selected at last: it has existed and been
        // rendered in set summaries for a year, and no progression code has
        // ever read it, so D-1's gate had nothing to gate on (B-22).
        targetRir: programSets.targetRir,
        peakDurationSeconds: programSets.peakDurationSeconds,
        peakDistanceMeters: programSets.peakDistanceMeters,
        exerciseId: programExercises.exerciseId,
        overloadIncrementKg: programExercises.overloadIncrementKg,
        overloadIncrementReps: programExercises.overloadIncrementReps,
        progressionScope: programExercises.progressionScope,
        progressionRequiredHits: programExercises.progressionRequiredHits,
        progressionAdvance: programExercises.progressionAdvance,
        progressionRegress: programExercises.progressionRegress,
        progressionBackoffPct: programExercises.progressionBackoffPct,
        progressionBackoffAfter: programExercises.progressionBackoffAfter,
        progressionReadiness: programExercises.progressionReadiness,
        progressionConfigAt: programExercises.progressionConfigAt,
        movementPattern: exercises.movementPattern,
        // The smallest step this equipment can load — an increment it cannot
        // make is a number the lifter has to round themselves (A3).
        equipment: exercises.equipment,
        // Resolve override ?? default in JS below (Drizzle returns both columns).
        exerciseTypeOverride: programExercises.exerciseType,
        exerciseTypeDefault: exercises.exerciseType,
        exerciseName: exercises.name,
      })
      .from(programSets)
      .innerJoin(
        programExercises,
        eq(programSets.programExerciseId, programExercises.id),
      )
      .innerJoin(exercises, eq(programExercises.exerciseId, exercises.id))
      .where(eq(programExercises.programId, programId));

    if (programData.length === 0) {
      return { success: true, data: {} };
    }

    // Step 2: fetch user profile and current session readiness in parallel
    const [userProfile, activeSession] = await Promise.all([
      db
        .select({ experienceLevel: users.experienceLevel, goals: users.goals })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({ readiness: workoutSessions.readiness })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.programId, programId),
            eq(workoutSessions.isCompleted, false),
          ),
        )
        .orderBy(desc(workoutSessions.startTime))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

    const readiness = activeSession?.readiness ?? null;
    // Today, as the plain date the sessions are stored in. The engine takes it
    // as an argument rather than reading the clock, so it stays a pure function
    // and a test fixture can sit three months after its own history.
    const today = new Date().toISOString().slice(0, 10);

    // buildSuggestion only special-cases an "endurance" goal (smaller increments);
    // derive it from the user's goals array (endurance wins, else the first goal).
    const userGoals = parseUserGoals(userProfile?.goals);
    const profile = userProfile
      ? {
          experienceLevel: userProfile.experienceLevel,
          goal: userGoals.includes("endurance") ? "endurance" : (userGoals[0] ?? null),
        }
      : null;

    // Step 3: rank each slot's completed sessions independently, then keep the
    // most recent CONSENSUS_WINDOW of them. DENSE_RANK over session start time
    // gives every session its own rank (session id breaks ties), so two
    // sessions on the same day consume two slots of the window — the window
    // counts sessions, not days.
    //
    // Warm-ups are excluded on the row's own snapshotted set_type rather than
    // by joining back to program_sets, because today's plan does not describe a
    // session from three weeks ago. Rows whose slot could not be resolved are
    // dropped by the inner join, as are rows logged against a slot whose
    // exercise has since been swapped — those belong to the previous exercise
    // and would otherwise be read as this one's history.
    const ranked = db
      .select({
        programExerciseId: workoutSets.programExerciseId,
        setNumber: workoutSets.setNumber,
        actualReps: workoutSets.actualReps,
        targetReps: workoutSets.targetReps,
        weightKg: workoutSets.weightKg,
        durationSeconds: workoutSets.durationSeconds,
        distanceMeters: workoutSets.distanceMeters,
        rpe: workoutSets.rpe,
        rir: workoutSets.rir,
        wasEasy: workoutSets.wasEasy,
        prescribedWorkingSets: workoutSets.prescribedWorkingSets,
        sessionId: workoutSessions.id,
        feeling: workoutSessions.feeling,
        date: workoutSessions.date,
        sessionRank: sql<number>`DENSE_RANK() OVER (
          PARTITION BY ${workoutSets.programExerciseId}
          ORDER BY ${workoutSessions.startTime} DESC, ${workoutSessions.id} DESC
        )`.as("session_rank"),
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .innerJoin(
        programExercises,
        eq(programExercises.id, workoutSets.programExerciseId),
      )
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.programId, programId),
          eq(workoutSessions.isCompleted, true),
          eq(programExercises.programId, programId),
          eq(programExercises.exerciseId, workoutSets.exerciseId),
          eq(workoutSets.setType, "working"),
        ),
      )
      .as("ranked");

    const history = await db
      .select()
      .from(ranked)
      .where(lte(ranked.sessionRank, CONSENSUS_WINDOW))
      .orderBy(ranked.sessionRank, ranked.setNumber);

    // Step 4: fold the rows into one window of sessions per slot. Rows arrive
    // in rank order and, within a session, in set order, so appending in place
    // keeps both orderings without a second sort.
    const windows = new Map<number, SessionHistory[]>();
    const openSessions = new Map<string, SessionHistory>();
    for (const row of history) {
      const slotId = row.programExerciseId;
      if (slotId == null) continue;
      const key = `${slotId}-${row.sessionId}`;
      let session = openSessions.get(key);
      if (!session) {
        session = {
          date: row.date,
          feeling: row.feeling,
          sets: [],
          prescribedWorkingSets: row.prescribedWorkingSets,
        };
        openSessions.set(key, session);
        const list = windows.get(slotId);
        if (list) list.push(session);
        else windows.set(slotId, [session]);
      }
      // Rows of one session normally agree. They disagree only when the plan
      // changed mid-session, and the larger count is the safe reading: it can
      // make a session unknown, which is inert, where the smaller could make a
      // short session read as a clear.
      if (
        row.prescribedWorkingSets != null &&
        (session.prescribedWorkingSets == null ||
          row.prescribedWorkingSets > session.prescribedWorkingSets)
      ) {
        session.prescribedWorkingSets = row.prescribedWorkingSets;
      }
      session.sets.push({
        setNumber: row.setNumber,
        actualReps: row.actualReps,
        targetReps: row.targetReps,
        weightKg: row.weightKg,
        durationSeconds: row.durationSeconds,
        distanceMeters: row.distanceMeters,
        rpe: row.rpe,
        rir: row.rir,
        wasEasy: row.wasEasy,
      });
    }

    // Step 5: build suggestion for each program set using the pure helper.
    // Every working set of a slot is judged against the same window and the
    // same scope, so under scope "all" one advance moves the whole exercise.
    const suggestions: Record<number, SetSuggestion> = {};

    // D-8: the set the scope names decides clearing *and* effort, so the cap
    // the engine judges against is that set's, not each set's own. Resolve it
    // once per slot from the slot's working sets, in set order.
    const workingBySlot = new Map<number, typeof programData>();
    for (const ps of programData) {
      if (ps.setType && ps.setType !== "working") continue;
      const list = workingBySlot.get(ps.programExerciseId);
      if (list) list.push(ps);
      else workingBySlot.set(ps.programExerciseId, [ps]);
    }
    for (const list of workingBySlot.values()) {
      list.sort((a, b) => a.setNumber - b.setNumber);
    }

    for (const ps of programData) {
      // Any set marked anything other than "working" is excluded from
      // progression entirely.
      if (ps.setType && ps.setType !== "working") continue;

      const sessions = windows.get(ps.programExerciseId) ?? [];

      const working = workingBySlot.get(ps.programExerciseId) ?? [];
      const scope = toScope(ps.progressionScope);
      const capSet =
        scope === "first"
          ? working[0]
          : scope === "set"
            ? ps
            : working[working.length - 1];

      const psData: ProgramSetData = {
        programSetId: ps.programSetId,
        setNumber: ps.setNumber,
        repRangeMin: ps.repRangeMin,
        repRangeMax: ps.repRangeMax,
        targetReps: ps.targetReps,
        durationSeconds: ps.durationSeconds,
        distanceMeters: ps.distanceMeters,
        setType: ps.setType,
        exerciseId: ps.exerciseId,
        overloadIncrementKg: ps.overloadIncrementKg,
        overloadIncrementReps: ps.overloadIncrementReps,
        scope: ps.progressionScope,
        requiredHits: ps.progressionRequiredHits,
        advance: ps.progressionAdvance,
        regress: ps.progressionRegress,
        backoffPct: ps.progressionBackoffPct,
        backoffAfter: ps.progressionBackoffAfter,
        readiness: ps.progressionReadiness,
        effortCap: capSet?.targetRir ?? null,
        // E-13. Compared against the session's own plain date, so the
        // granularity is a day: a session logged earlier on the day the setting
        // changed still counts. The engine holds anything older inert rather
        // than re-judging it under a rule that did not apply at the time.
        configChangedAt: ps.progressionConfigAt
          ? ps.progressionConfigAt.toISOString().slice(0, 10)
          : null,
        peakDurationSeconds: ps.peakDurationSeconds,
        peakDistanceMeters: ps.peakDistanceMeters,
        movementPattern: ps.movementPattern,
        exerciseType: ps.exerciseTypeOverride ?? ps.exerciseTypeDefault,
        equipment: ps.equipment,
        exerciseName: ps.exerciseName,
      };
      const suggestion = buildSuggestion(sessions, psData, profile, readiness, today);
      if (suggestion) {
        suggestions[ps.programSetId] = suggestion;
      }
    }

    return { success: true, data: suggestions };
  } catch (error) {
    console.error("[getProgressiveSuggestions] failed", error);
    return { success: false, error: "Failed to calculate suggestions" };
  }
}

// Re-export SetSuggestion so existing callers don't need to change their imports.
export type { SetSuggestion } from "@/types/workout";

// ─── Workout insight ──────────────────────────────────────────────────────────

export type ExerciseInsight = {
  exerciseName: string;
  status: "progressing" | "held" | "near_deload" | "deloading";
  sessionsUntilDeload?: number;
};

export type WorkoutInsight = {
  type:
    | "fatigued"
    | "stagnating"
    | "progressing"
    | "first_session"
    | "on_track"
    | "readiness_low"
    | "plateau_warning"
    | "pr_streak"
    | "deload_recommended";
  headline: string;
  detail?: string;
  cycleWeek?: number;
  cycleTotalWeeks?: number;
  sessionCount: number;
  exerciseInsights?: ExerciseInsight[];
};

/**
 * Compute a single pre-workout insight for the given program.
 *
 * Priority order:
 *   readiness_low → fatigued → plateau_warning → stagnating →
 *   progressing → pr_streak → first_session → on_track
 */
export async function getWorkoutInsight(
  programId: number,
  prefetchedCycleResult?: ActionResult<ActiveCycleInfo | null>,
): Promise<WorkoutInsight> {
  const auth = await requireSession();
  const userId = auth.user.id;
  const [
    sessionCountRow,
    cycleResult,
    suggestionsResult,
    currentSessionRow,
    recentSessions,
    recentPRsCount,
    cookedExerciseCount,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.programId, programId),
          eq(workoutSessions.isCompleted, true),
        ),
      )
      .then((r) => Number(r[0]?.count ?? 0)),
    prefetchedCycleResult ?? getActiveCycleForUser(),
    getProgressiveSuggestions(programId),
    // Fetch the current (incomplete) session to read readiness
    db
      .select({ readiness: workoutSessions.readiness })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.programId, programId),
          eq(workoutSessions.isCompleted, false),
        ),
      )
      .orderBy(desc(workoutSessions.startTime))
      .limit(1)
      .then((r) => r[0] ?? null),
    // Fetch last 3 completed sessions for fatigue check
    db
      .select({ feeling: workoutSessions.feeling })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.programId, programId),
          eq(workoutSessions.isCompleted, true),
          isNotNull(workoutSessions.feeling),
        ),
      )
      .orderBy(desc(workoutSessions.startTime))
      .limit(3),
    // Fetch recent PR count for this program
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(exercisePrs)
      .innerJoin(workoutSessions, eq(exercisePrs.sessionId, workoutSessions.id))
      .where(
        and(
          eq(exercisePrs.userId, userId),
          eq(workoutSessions.programId, programId),
          sql`${exercisePrs.achievedAt} >= NOW() - INTERVAL '7 days'`,
        ),
      )
      .then((r) => Number(r[0]?.count ?? 0)),
    // Count distinct exercises in the most recent completed session that
    // had at least one set logged at RPE ≥ 9 — the conservative "you got
    // cooked across multiple lifts" signal for mid-cycle deload nudges.
    //
    // Sets with no logged effort are excluded (null fails the comparison), so
    // the count is of exercises the lifter *said* were near-max. That is the
    // right reading for a nudge that tells someone to back off: silence is not
    // evidence of a hard session. The count is lower than it used to be, when
    // every tap wrote a 7 and only explicit RIR 0-1 could reach 9.
    db
      .select({
        cookedExerciseCount: sql<number>`COUNT(DISTINCT ${workoutSets.exerciseId})`,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.programId, programId),
          eq(workoutSessions.isCompleted, true),
          sql`${workoutSets.rpe} >= 9`,
          sql`${workoutSessions.id} = (
            SELECT id FROM workout_sessions
            WHERE user_id = ${userId} AND program_id = ${programId} AND is_completed = true
            ORDER BY start_time DESC LIMIT 1
          )`,
        ),
      )
      .then((r) => Number(r[0]?.cookedExerciseCount ?? 0)),
  ]);

  const sessionCount = sessionCountRow;
  const cycleWeek = cycleResult.success && cycleResult.data ? cycleResult.data.currentWeek : undefined;
  const cycleTotalWeeks = cycleResult.success && cycleResult.data
    ? cycleResult.data.cycle.durationWeeks
    : undefined;
  const cycleContext = { cycleWeek, cycleTotalWeeks };
  const readiness = currentSessionRow?.readiness ?? null;
  const suggestions = suggestionsResult.success ? Object.values(suggestionsResult.data) : [];

  // ── Build per-exercise insight pills ────────────────────────────────────────
  // Deduplicate by exercise name: take the worst status per exercise
  const exerciseStatusMap = new Map<string, ExerciseInsight>();
  for (const sug of suggestions) {
    if (!sug.exerciseName) continue;
    const prev = exerciseStatusMap.get(sug.exerciseName);
    let status: ExerciseInsight["status"];
    if (sug.reason === "deload") {
      status = "deloading";
    } else if (sug.reason === "re-approach") {
      // Not "deloading". The pill would report a plateau remedy for someone
      // who has simply been away, and "re-approach" means the opposite of a
      // stall — this is the first session back, not the fourth failed one.
      status = "held";
    } else if (sug.sessionsUntilDeload === 1) {
      status = "near_deload";
    } else if (sug.reason === "progressed" || sug.reason === "progressed-reps" || sug.reason === "reset" || sug.reason === "progressed-time" || sug.reason === "progressed-distance") {
      // "reset" is progress: the load went up. The reps dropping back to the
      // bottom of the range is the price of it, not a stall.
      status = "progressing";
    } else {
      // Every held* reason lands here deliberately: the load is being held,
      // which is what the pill reports. Why it is held — missing effort, no
      // increment to add, or the cycle owning the target — is the set row's
      // job to say, not four more pill states.
      status = "held";
    }
    // Keep worst status: deloading > near_deload > held > progressing
    const rank = { deloading: 4, near_deload: 3, held: 2, progressing: 1 };
    if (!prev || rank[status] > rank[prev.status]) {
      exerciseStatusMap.set(sug.exerciseName, {
        exerciseName: sug.exerciseName,
        status,
        sessionsUntilDeload: sug.sessionsUntilDeload ?? undefined,
      });
    }
  }
  const exerciseInsights = Array.from(exerciseStatusMap.values());

  // ── Priority 0: readiness_low — if energy is very low today ─────────────────
  if (readiness != null && readiness <= 2) {
    return {
      type: "readiness_low",
      headline: "Energy is low today. Targets adjusted — focus on technique.",
      detail: "Weights have been reduced to match your readiness. Quality over quantity.",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 1: fatigued — last 2+ sessions both "Tired" ───────────────────
  const lastTwoTired =
    recentSessions.length >= 2 &&
    recentSessions[0].feeling === "Tired" &&
    recentSessions[1].feeling === "Tired";

  if (lastTwoTired) {
    return {
      type: "fatigued",
      headline: "Your last 2 sessions felt tough.",
      detail: "Consider going slightly lighter today and focusing on form.",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 1.5: deload_recommended — last session cooked you across
  // 3+ different exercises (RPE ≥ 9). Conservative single-session signal —
  // few false positives but catches the "I got hammered" pattern that the
  // per-exercise deload detection alone won't surface mid-cycle.
  if (cookedExerciseCount >= 3) {
    return {
      type: "deload_recommended",
      headline: `${cookedExerciseCount} lifts hit RPE 9+ last session.`,
      detail: "A planned light week now usually beats a forced break later.",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 2: plateau_warning — any set is 1 miss from deload ────────────
  const nearDeloadExercise = exerciseInsights.find((e) => e.status === "near_deload");
  if (nearDeloadExercise) {
    return {
      type: "plateau_warning",
      headline: `${nearDeloadExercise.exerciseName} is 1 miss from a deload.`,
      detail: "Push through with good form, or adjust weights proactively.",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 3: stagnating — >50% sets held for 3+ sessions ────────────────
  // "held-anchored" joins "manual" outside the sample entirely: the training
  // cycle prescribes those targets weekly, so progression proposes nothing for
  // them and counting them would drag every endurance block toward "stagnating".
  const tracked = suggestions.filter(
    (s) =>
      s.reason !== "manual" &&
      s.reason !== "held-anchored" &&
      // A layoff is not a plateau. Counting a re-approach here would tell
      // someone coming back after three months to try drop sets.
      s.reason !== "re-approach",
  );
  // "held-unknown" and "held-no-increment" are deliberately not counted: the
  // remedy this insight offers (slow eccentrics, drop sets, a small deload) is
  // advice for a plateau, and an exercise waiting on an unanswered effort
  // prompt or on a missing increment has not shown one — it is waiting on a
  // setting, and the set row already says which.
  const heldCount = tracked.filter((s) => s.reason === "held" || s.reason === "held-readiness").length;
  const isStagnating = sessionCount >= 3 && tracked.length > 0 && heldCount / tracked.length > 0.5;

  if (isStagnating) {
    return {
      type: "stagnating",
      headline: "You've been holding the same weights for a few sessions.",
      detail: "Try a slow eccentric, drop sets, or a slight deload to break through.",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 4: progressing — >50% sets progressed ─────────────────────────
  const progressedCount = tracked.filter(
    (s) =>
      s.reason === "progressed" ||
      s.reason === "progressed-reps" ||
      s.reason === "reset" ||
      s.reason === "progressed-time" ||
      s.reason === "progressed-distance",
  ).length;
  const isProgressing = tracked.length > 0 && progressedCount / tracked.length > 0.5;

  if (isProgressing) {
    return {
      type: "progressing",
      headline: `You're progressing on ${progressedCount} exercise${progressedCount === 1 ? "" : "s"} — keep the momentum.`,
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 5: pr_streak — PRs logged in this program's sessions recently ──
  if (recentPRsCount > 0) {
    return {
      type: "pr_streak",
      headline: "You've hit personal records this week — great momentum!",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 6: first_session ───────────────────────────────────────────────
  if (sessionCount === 0) {
    return {
      type: "first_session",
      headline: "First time with this program.",
      detail: "Focus on technique and get a feel for the weights.",
      ...cycleContext,
      sessionCount,
      exerciseInsights,
    };
  }

  // ── Priority 7: on_track (fallback) ────────────────────────────────────────
  return {
    type: "on_track",
    headline: `Session ${sessionCount + 1} for this program. Stay consistent.`,
    ...cycleContext,
    sessionCount,
    exerciseInsights,
  };
}
