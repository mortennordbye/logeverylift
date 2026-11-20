/**
 * The one-time moves of plain bike sets (docs/plans/bike-ride-logger.md, D3,
 * step 1) and plain run sets (docs/plans/run-logger.md, step 1) to steps. For
 * each user with endurance features on, every program with an exercise of the
 * sport that still holds plain sets gets them as steps, zones kept as zone
 * targets so the weekly sync still moves them. One revision per program and
 * sport, writer `sync`, each with its own reason, so a program with a ride and
 * a run moves both and the user can restore the old sets.
 *
 * Runs at server start (src/instrumentation.ts) and when an admin turns the
 * endurance features on. Idempotent: a program with no plain sets of the sport is not
 * read again, and a program this move already wrote is never moved twice, so a
 * restore of its old sets stays. A program with a workout in progress waits
 * for the next run; one left open over 10 hours is abandoned and does not
 * hold it back. Sets no step can hold stay plain, with a log line.
 */

import { db } from "@/db";
import { exercises, planRevisions, programExercises, programSets, programs, users } from "@/db/schema";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { planWrite } from "@/lib/plan-revisions";
import { recentOpenWorkoutOn, settleStepRows } from "@/lib/program-steps-db";
import { and, eq, gt, isNull, notExists, or } from "drizzle-orm";

export const BIKE_STEPS_REASON = "Bike sets became steps";
export const RUN_STEPS_REASON = "Run sets became steps";

type MoveCounts = { moved: number; waiting: number; failed: number };

export const migrateBikeSetsToSteps = (opts: { userId?: string } = {}) => migrateSetsToSteps("bike", opts);
export const migrateRunSetsToSteps = (opts: { userId?: string } = {}) => migrateSetsToSteps("run", opts);

async function migrateSetsToSteps(sport: "bike" | "run", opts: { userId?: string }): Promise<MoveCounts> {
  const reason = sport === "bike" ? BIKE_STEPS_REASON : RUN_STEPS_REASON;
  const tag = sport === "bike" ? "[migrateBikeSetsToSteps]" : "[migrateRunSetsToSteps]";
  const candidates = await db
    .selectDistinct({ programId: programs.id, userId: programs.userId })
    .from(programs)
    .innerJoin(users, eq(users.id, programs.userId))
    .innerJoin(programExercises, and(eq(programExercises.programId, programs.id), liveProgramExercises))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .innerJoin(programSets, and(eq(programSets.programExerciseId, programExercises.id), liveProgramSets))
    .where(
      and(
        livePrograms,
        eq(users.enduranceEnabled, true),
        opts.userId ? eq(users.id, opts.userId) : undefined,
        eq(exercises.discipline, sport),
        // A run also moves the rest on a row of a slot that already held steps
        // (run-logger, step 1), so the weekly sync finds its rest step.
        sport === "run" ? or(isNull(programSets.stepKind), gt(programSets.restTimeSeconds, 0)) : isNull(programSets.stepKind),
        notExists(
          db
            .select({ id: planRevisions.id })
            .from(planRevisions)
            .where(
              and(
                eq(planRevisions.userId, programs.userId),
                eq(planRevisions.objectType, "program"),
                eq(planRevisions.objectId, programs.id),
                eq(planRevisions.writer, "sync"),
                eq(planRevisions.reason, reason),
              ),
            ),
        ),
      ),
    )
    .orderBy(programs.id);

  const counts = { moved: 0, waiting: 0, failed: 0 };
  for (const { programId, userId } of candidates) {
    try {
      const { result } = await planWrite({ userId, writer: "sync", reason }, async (w) => {
        if (await recentOpenWorkoutOn(w.tx, userId, programId)) return false;
        await w.touch({ type: "program", id: programId });
        const slots = await w.tx
          .select({ id: programExercises.id })
          .from(programExercises)
          .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
          .where(and(eq(programExercises.programId, programId), liveProgramExercises, eq(exercises.discipline, sport)));
        let changed = false;
        for (const s of slots) changed = (await settleStepRows(w.tx, s.id)) || changed;
        return changed ? "moved" : "left";
      });
      // A program whose slots no step can hold is left plain: not moved, and read again next boot.
      if (result !== "left") counts[result ? "moved" : "waiting"]++;
    } catch (err) {
      counts.failed++;
      console.error(`${tag} program failed`, { programId, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  if (candidates.length) console.log(`${tag} done`, counts);
  return counts;
}
