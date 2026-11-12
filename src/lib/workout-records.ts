/**
 * Personal records for logged sets: detecting new ones as a set is logged,
 * undoing a set's records, and rebuilding an exercise's records from a point
 * in time when history before it changes. Plain server code rather than
 * Server Actions (it takes a resolved userId and a transaction), so the app's
 * set logging and the MCP log_session tool share it. Moved unchanged from
 * src/lib/actions/workout-sets.ts.
 */

import { db } from "@/db";
import { exercisePrs, exercises, workoutSessions, workoutSets } from "@/db/schema";
import { matchingPaceBrackets, paceSecondsPerMeter, type Discipline } from "@/lib/utils/discipline";
import { HONEST_REPS_FROM } from "@/lib/utils/pr-provenance";
import { estimate1RM } from "@/lib/utils/progression";
import { rirFromRpe } from "@/lib/utils/rir";
import type { PRResult } from "@/types/workout";
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

/**
 * Undo the PR rows a single set produced: delete each, and make the record it
 * beat current again (followed through `supersededById`, so it is exactly the
 * displaced row, including the right load or pace bracket).
 */
export async function rollbackPRsForSet(tx: Tx, userId: string, setId: number): Promise<void> {
  const earned = await tx
    .select({ id: exercisePrs.id })
    .from(exercisePrs)
    .where(and(eq(exercisePrs.userId, userId), eq(exercisePrs.setId, setId)));

  for (const pr of earned) {
    // Before the delete: the FK would null the link.
    await tx
      .update(exercisePrs)
      .set({ supersededAt: null, supersededById: null })
      .where(and(eq(exercisePrs.userId, userId), eq(exercisePrs.supersededById, pr.id)));
    await tx.delete(exercisePrs).where(eq(exercisePrs.id, pr.id));
  }
}

/** The instant honest rep logging started, as isUnverifiedPr reads HONEST_REPS_FROM. */
export const HONEST_REPS_FROM_TIME = new Date(`${HONEST_REPS_FROM}T00:00:00Z`);

/**
 * Does anything come after this set for its exercise: a later set, or a
 * record (from a set since deleted) dated after it? Then its records are part
 * of a chain later history was built on.
 */
export async function hasLaterHistory(
  tx: Tx,
  userId: string,
  exerciseId: number,
  set: { id: number; createdAt: Date },
): Promise<boolean> {
  // As a UTC string: node-postgres sends a Date in local time, and a column
  // without a time zone drops the offset.
  const at = set.createdAt.toISOString();
  const { rows } = await tx.execute<{ later: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${workoutSets} ws
      JOIN ${workoutSessions} s ON s.id = ws.session_id
      WHERE s.user_id = ${userId} AND ws.exercise_id = ${exerciseId} AND ws.id <> ${set.id}
        AND ws.created_at > ${at}
    ) OR EXISTS (
      SELECT 1 FROM ${exercisePrs} p
      WHERE p.user_id = ${userId} AND p.exercise_id = ${exerciseId}
        AND p.set_id IS DISTINCT FROM ${set.id} AND p.achieved_at > ${at}
    ) AS later`);
  return rows[0]?.later === true;
}

export function earliest(a: Date, b: Date): Date {
  return a < b ? a : b;
}

/**
 * Rebuild one exercise's records from `from` onward, for an edit to a set or a
 * session that already has later history.
 *
 * rollbackPRsForSet only undoes a record while it is still current; once a
 * later set has beaten it, the chain after it was built on the old value. So
 * every record from the edit point on is dropped, the records they had beaten
 * are made current again, and every set from that point is replayed in order
 * under today's rules, dated by when the set happened.
 *
 * Never reaches back past HONEST_REPS_FROM: records from before honest rep
 * logging are frozen (D-10), so an edit to an older set saves the set and
 * leaves those records as they are. The record rules have not changed since
 * that date, so a replay reproduces every record it rewrites unless the edit
 * changed it.
 *
 * Call under lockRecords for this exercise, in the edit's transaction.
 */
export async function rebuildPRsFrom(tx: Tx, userId: string, exerciseId: number, from: Date): Promise<void> {
  const since = from > HONEST_REPS_FROM_TIME ? from : HONEST_REPS_FROM_TIME;
  const ofExercise = and(eq(exercisePrs.userId, userId), eq(exercisePrs.exerciseId, exerciseId));

  // Dropped: records of the sets the replay below covers, chosen by the set's
  // time rather than the record's, since a re-log once dated its record when
  // it landed. A record whose set is gone goes by its own date.
  const replayedSets = tx
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(and(eq(workoutSets.exerciseId, exerciseId), gte(workoutSets.createdAt, since)));
  const isDropped = and(
    ofExercise,
    or(
      inArray(exercisePrs.setId, replayedSets),
      and(isNull(exercisePrs.setId), gte(exercisePrs.achievedAt, since)),
    ),
  );
  const dropped = tx.select({ id: exercisePrs.id }).from(exercisePrs).where(isDropped);
  // Before the delete: the FK would null the link. A record beaten before
  // superseded_by_id existed may have no link (migration 0059 could not fill
  // every one); beaten at or after `since`, its beater is being dropped too.
  await tx
    .update(exercisePrs)
    .set({ supersededAt: null, supersededById: null })
    .where(
      and(
        ofExercise,
        or(
          inArray(exercisePrs.supersededById, dropped),
          and(isNull(exercisePrs.supersededById), gte(exercisePrs.supersededAt, since)),
        ),
      ),
    );
  await tx.delete(exercisePrs).where(isDropped);

  const replay = await tx
    .select({ set: workoutSets })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSets.exerciseId, exerciseId),
        eq(workoutSets.isCompleted, true),
        gte(workoutSets.createdAt, since),
      ),
    )
    .orderBy(asc(workoutSets.createdAt), asc(workoutSets.id));

  for (const { set } of replay) {
    const weightKg = Number(set.weightKg);
    const at = set.createdAt;
    // The same conditions logWorkoutSet applies when the set is logged.
    if (set.actualReps > 0 && weightKg > 0) {
      await detectAndRecordPRs(tx, {
        userId,
        exerciseId,
        sessionId: set.sessionId,
        setId: set.id,
        weightKg,
        actualReps: set.actualReps,
        rir: set.rir ?? (set.rpe != null ? rirFromRpe(set.rpe) : null),
        at,
      });
    }
    if (set.distanceMeters != null && set.distanceMeters > 0) {
      await detectAndRecordEndurancePRs(tx, {
        userId,
        exerciseId,
        sessionId: set.sessionId,
        setId: set.id,
        distanceMeters: set.distanceMeters,
        durationSeconds: set.durationSeconds ?? 0,
        at,
      });
    }
  }
}

/**
 * Run PR detection in a savepoint. Records are non-critical: if detection
 * fails, the set is still logged. In a transaction a failed statement aborts
 * everything after it, so a plain try/catch would let the error take the set
 * write down with it; rolling back to the savepoint keeps the set.
 */
export async function detectNonCritical(
  tx: Tx,
  tag: string,
  detect: (sp: Tx) => Promise<PRResult[]>,
): Promise<PRResult[]> {
  try {
    return await tx.transaction(detect);
  } catch (err) {
    console.error(`[logWorkoutSet] ${tag}`, err);
    return [];
  }
}

/**
 * Serialise everything that reads and rewrites one user's records for one
 * exercise, until the transaction ends.
 *
 * Detection is read-the-current-record, then insert-and-supersede. Two logs
 * for the same exercise at once (catching up earlier sets fires them in
 * parallel, and so does ticking a whole exercise) both read the same current
 * record and both inserted a new one, leaving several "current" records.
 */
export async function lockRecords(tx: Tx, userId: string, exerciseId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), ${exerciseId})`);
}

// ─── PR Detection ─────────────────────────────────────────────────────────────

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert a new record and mark the one it beat (if any) as superseded by it.
 * The link is what un-logging or correcting the set follows to put the old
 * record back (rollbackPRsForSet).
 *
 * `at` is when the set happened. Omitted for a set logged now; a rebuild
 * (rebuildPRsFrom) passes the set's own time so the chain dates from history.
 */
export async function recordPR(
  tx: Tx,
  beaten: { id: number } | undefined,
  values: typeof exercisePrs.$inferInsert,
  at?: Date,
): Promise<void> {
  const [inserted] = await tx
    .insert(exercisePrs)
    .values(at ? { ...values, achievedAt: at } : values)
    .returning({ id: exercisePrs.id });
  if (beaten) {
    await tx
      .update(exercisePrs)
      .set({ supersededAt: at ?? new Date(), supersededById: inserted.id })
      .where(and(eq(exercisePrs.id, beaten.id), isNull(exercisePrs.supersededAt)));
  }
}

export async function detectAndRecordPRs(tx: Tx, {
  userId,
  exerciseId,
  sessionId,
  setId,
  weightKg,
  actualReps,
  rir,
  at,
}: {
  userId: string;
  exerciseId: number;
  sessionId: number;
  setId: number;
  weightKg: number;
  actualReps: number;
  /** Logged reps in reserve, or null when the lifter reported nothing. */
  rir: number | null;
  /** When the set happened, for a replay. Omitted means now. */
  at?: Date;
}): Promise<PRResult[]> {
  const newPRs: PRResult[] = [];

  // Bodyweight / timed sets have no meaningful weight PR — skip entirely
  if (weightKg <= 0) return newPRs;

  // 1. Weight PR — heaviest single set ever
    const [currentWeightPR] = await tx
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
      await recordPR(tx, currentWeightPR, {
        userId,
        exerciseId,
        prType: "weight",
        value: weightKg.toFixed(2),
        sessionId,
        setId,
      }, at);
      newPRs.push({
        type: "weight",
        value: weightKg,
        previousValue: currentWeightPR ? Number(currentWeightPR.value) : undefined,
      });
    }

    // 2. Estimated 1RM PR — Epley formula, valid for 2–12 reps *on a near-max
    //    set*. A11: Epley on a set the lifter stopped four reps short of
    //    failure is not a 1RM estimate, it is arithmetic on a submaximal
    //    number, and this is the figure people screenshot. The displayed
    //    estimate gained this guard in phase 5; the stored record is the half
    //    that stayed ungated, and a record set from a sandbagged set is one
    //    honest logging may never beat.
    //
    //    Silence does not qualify. Under D-2 an unreported effort is unknown,
    //    not a moderate one, so a set with no RIR sets no 1RM record.
    if (actualReps >= 2 && actualReps <= 12 && rir != null && rir <= 3) {
      const new1RM = estimate1RM(weightKg, actualReps);
      const [current1RMPR] = await tx
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
        await recordPR(tx, current1RMPR, {
          userId,
          exerciseId,
          prType: "estimated_1rm",
          value: new1RM.toFixed(2),
          weightKg: weightKg.toFixed(2),
          sessionId,
          setId,
        }, at);
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
      const [currentRepsAtWeightPR] = await tx
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
        await recordPR(tx, currentRepsAtWeightPR, {
          userId,
          exerciseId,
          prType: "reps_at_weight",
          value: actualReps.toString(),
          weightKg: weightKg.toFixed(2),
          sessionId,
          setId,
        }, at);
        newPRs.push({
          type: "reps_at_weight",
          value: actualReps,
          previousValue: currentRepsAtWeightPR
            ? Number(currentRepsAtWeightPR.value)
            : undefined,
        });
      }
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
export async function detectAndRecordEndurancePRs(tx: Tx, {
  userId,
  exerciseId,
  sessionId,
  setId,
  distanceMeters,
  durationSeconds,
  at,
}: {
  userId: string;
  exerciseId: number;
  sessionId: number;
  setId: number;
  distanceMeters: number;
  durationSeconds: number;
  /** When the set happened, for a replay. Omitted means now. */
  at?: Date;
}): Promise<PRResult[]> {
  const newPRs: PRResult[] = [];
  if (distanceMeters <= 0) return newPRs;

  // Only swim/bike/run exercises carry endurance PRs.
    const [exercise] = await tx
      .select({ discipline: exercises.discipline })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1);
    const discipline = exercise?.discipline as Discipline | null | undefined;
    if (!discipline) return newPRs;

    // 1. Distance PR — longest single endurance set ever.
    const [currentDistancePR] = await tx
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
      await recordPR(tx, currentDistancePR, {
        userId,
        exerciseId,
        prType: "distance",
        value: distanceMeters.toFixed(2),
        distanceMeters,
        sessionId,
        setId,
      }, at);
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
        const [currentPacePR] = await tx
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
          await recordPR(tx, currentPacePR, {
            userId,
            exerciseId,
            prType: "pace",
            value: durationSeconds.toFixed(2),
            distanceMeters,
            bracket: bracket.label,
            sessionId,
            setId,
          }, at);
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
  return newPRs;
}
