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
    workoutHistoryQuerySchema,
} from "@/lib/validators/workout";
import {
    buildSuggestion,
    CONSENSUS_WINDOW,
    estimate1RM,
} from "@/lib/utils/progression";
import type { HistoryRow, ProgramSetData } from "@/lib/utils/progression";
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
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Resolve the program_set.id values for every completed workout_set in the
 * given active session. Used on workout-page mount to rehydrate the in-memory
 * `completedSetIds` set — necessary because that state lives only in React and
 * is lost when iOS evicts the PWA's JS context after backgrounding.
 */
export async function getActiveSessionCompletedProgramSetIds(
  sessionId: number,
): Promise<ActionResult<number[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select({ id: programSets.id })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .innerJoin(
        programExercises,
        and(
          eq(programExercises.programId, workoutSessions.programId),
          eq(programExercises.exerciseId, workoutSets.exerciseId),
        ),
      )
      .innerJoin(
        programSets,
        and(
          eq(programSets.programExerciseId, programExercises.id),
          eq(programSets.setNumber, workoutSets.setNumber),
        ),
      )
      .where(
        and(
          eq(workoutSets.sessionId, sessionId),
          eq(workoutSessions.userId, auth.user.id),
          eq(workoutSets.isCompleted, true),
        ),
      );
    return { success: true, data: rows.map((r) => r.id) };
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
    } = validation.data;

    // RIR is the primary effort input; derive RPE from it so all downstream
    // RPE-based progression/adaptation keeps working. Fall back to the supplied
    // RPE for callers that don't report RIR yet (e.g. logged runs).
    const effectiveRpe = rir != null ? rpeFromRir(rir) : rpe;

    // Verify the session belongs to the authenticated user
    const [session] = await db
      .select({ userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1);
    if (!session || session.userId !== auth.user.id) {
      return { success: false, error: "Unauthorized" };
    }

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

    // Insert set into database
    const [set] = await db
      .insert(workoutSets)
      .values({
        sessionId,
        exerciseId,
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

    revalidatePath(`/workout/${sessionId}`);
    revalidatePath("/history");

    return {
      success: true,
      data: { set, newPRs },
    };
  } catch (error) {
    // Unique-violation on (session_id, exercise_id, set_number) means the row
    // already exists — typically a retry replay after a flaky network. Treat
    // as success and return the existing row so client-side retry queues stop
    // looping. Without this, a single failed-then-succeeded request becomes
    // an infinite retry storm.
    if (isUniqueViolation(error)) {
      try {
        const parsedAgain = logWorkoutSetSchema.safeParse(data);
        if (parsedAgain.success) {
          const { sessionId, exerciseId, setNumber } = parsedAgain.data;
          const [existing] = await db
            .select()
            .from(workoutSets)
            .where(
              and(
                eq(workoutSets.sessionId, sessionId),
                eq(workoutSets.exerciseId, exerciseId),
                eq(workoutSets.setNumber, setNumber),
              ),
            )
            .limit(1);
          if (existing) {
            return { success: true, data: { set: existing, newPRs: [] } };
          }
        }
      } catch (lookupErr) {
        console.error("[logWorkoutSet] dupe lookup failed", lookupErr);
      }
    }
    console.error("[logWorkoutSet] failed", error);
    return {
      success: false,
      error: "Failed to log workout set. Please try again.",
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  if (e.code === "23505") return true;
  if (e.cause && typeof e.cause === "object" && e.cause.code === "23505") return true;
  return false;
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
 * row by (sessionId, exerciseId, setNumber). If no row exists yet, returns
 * `success: true` without writing — the override carries the note forward
 * on the next `logWorkoutSet` call.
 */
export async function updateWorkoutSetNotes(
  data: {
    sessionId: number;
    exerciseId: number;
    setNumber: number;
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
      .select({ userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, data.sessionId))
      .limit(1);
    if (!session || session.userId !== auth.user.id) {
      return { success: false, error: "Unauthorized" };
    }
    await db
      .update(workoutSets)
      .set({ notes: data.notes })
      .where(
        and(
          eq(workoutSets.sessionId, data.sessionId),
          eq(workoutSets.exerciseId, data.exerciseId),
          eq(workoutSets.setNumber, data.setNumber),
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
 * For each program_set, we examine recent completed sessions (excluding "Tired"
 * sessions) and apply multi-session consensus logic:
 * - Requires REQUIRED_HITS confident hits within the last CONSENSUS_WINDOW sessions
 *   to trigger a progression (prevents single-fluke advances).
 * - RPE gates confidence: RPE 9-10 sets are not counted as confident hits.
 * - 3+ consecutive failures trigger a 10% deload suggestion.
 * - If no history exists for a set, it is omitted (caller uses the program default).
 *
 * NULL feeling (old sessions recorded before the column existed) is treated
 * as valid — only explicit "Tired" entries are excluded.
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
        setNumber: programSets.setNumber,
        targetReps: programSets.targetReps,
        durationSeconds: programSets.durationSeconds,
        distanceMeters: programSets.distanceMeters,
        setType: programSets.setType,
        exerciseId: programExercises.exerciseId,
        overloadIncrementKg: programExercises.overloadIncrementKg,
        overloadIncrementReps: programExercises.overloadIncrementReps,
        progressionMode: programExercises.progressionMode,
        movementPattern: exercises.movementPattern,
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

    const exerciseIds = [...new Set(programData.map((r) => r.exerciseId))];

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

    // buildSuggestion only special-cases an "endurance" goal (smaller increments);
    // derive it from the user's goals array (endurance wins, else the first goal).
    const userGoals = parseUserGoals(userProfile?.goals);
    const profile = userProfile
      ? {
          experienceLevel: userProfile.experienceLevel,
          goal: userGoals.includes("endurance") ? "endurance" : (userGoals[0] ?? null),
        }
      : null;

    // Step 3: fetch history, excluding Tired sessions
    // NULL feeling (pre-feature sessions) is kept via IS DISTINCT FROM.
    // Limit to CONSENSUS_WINDOW rows per exercise+setNumber to avoid full scans
    // on accounts with hundreds of sessions.
    const history = await db
      .select({
        exerciseId: workoutSets.exerciseId,
        setNumber: workoutSets.setNumber,
        actualReps: workoutSets.actualReps,
        targetReps: workoutSets.targetReps,
        weightKg: workoutSets.weightKg,
        durationSeconds: workoutSets.durationSeconds,
        distanceMeters: workoutSets.distanceMeters,
        rpe: workoutSets.rpe,
        feeling: workoutSessions.feeling,
        date: workoutSessions.date,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.programId, programId),
          eq(workoutSessions.isCompleted, true),
          sql`${workoutSessions.feeling} IS DISTINCT FROM 'Tired'`,
          inArray(workoutSets.exerciseId, exerciseIds),
        ),
      )
      .orderBy(desc(workoutSessions.startTime), desc(workoutSets.id))
      .limit(programData.length * CONSENSUS_WINDOW);

    // Step 4: group history rows per exerciseId+setNumber (most-recent-first)
    const historyPerKey = new Map<string, HistoryRow[]>();
    for (const row of history) {
      const key = `${row.exerciseId}-${row.setNumber}`;
      if (!historyPerKey.has(key)) historyPerKey.set(key, []);
      const list = historyPerKey.get(key)!;
      if (list.length < CONSENSUS_WINDOW) list.push(row as HistoryRow);
    }

    // Step 5: build suggestion for each program set using the pure helper
    const suggestions: Record<number, SetSuggestion> = {};

    for (const ps of programData) {
      const key = `${ps.exerciseId}-${ps.setNumber}`;
      const rows = historyPerKey.get(key) ?? [];

      // Any set marked anything other than "working" is excluded from
      // progression entirely.
      if (ps.setType && ps.setType !== "working") continue;

      const psData: ProgramSetData = {
        programSetId: ps.programSetId,
        setNumber: ps.setNumber,
        targetReps: ps.targetReps,
        durationSeconds: ps.durationSeconds,
        distanceMeters: ps.distanceMeters,
        setType: ps.setType,
        exerciseId: ps.exerciseId,
        overloadIncrementKg: ps.overloadIncrementKg,
        overloadIncrementReps: ps.overloadIncrementReps,
        progressionMode: ps.progressionMode,
        movementPattern: ps.movementPattern,
        exerciseType: ps.exerciseTypeOverride ?? ps.exerciseTypeDefault,
        exerciseName: ps.exerciseName,
      };
      const suggestion = buildSuggestion(rows, psData, profile, readiness);
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
    } else if (sug.sessionsUntilDeload === 1) {
      status = "near_deload";
    } else if (sug.reason === "progressed" || sug.reason === "progressed-reps" || sug.reason === "progressed-time" || sug.reason === "progressed-distance") {
      status = "progressing";
    } else {
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
  const tracked = suggestions.filter((s) => s.reason !== "manual");
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
