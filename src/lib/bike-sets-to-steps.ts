/**
 * The one-time move of plain bike sets to steps (docs/plans/bike-ride-logger.md,
 * D3, step 1). For each user with endurance features on, every program with a
 * bike exercise that still holds plain sets gets them as steps, zones kept as
 * zone targets so the weekly sync still moves them. One revision per program,
 * writer `sync`, so the user can restore the old sets.
 *
 * Runs at server start (src/instrumentation.ts) and when an admin turns the
 * endurance features on. Idempotent: a program with no plain bike sets is not
 * read again, and a program this move already wrote is never moved twice, so a
 * restore of its old sets stays. A program with a workout in progress waits
 * for the next run.
 */

import { db } from "@/db";
import { exercises, planRevisions, programExercises, programSets, programs, users } from "@/db/schema";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { openWorkoutOn, planWrite } from "@/lib/plan-revisions";
import { bikeSetsToSteps } from "@/lib/program-steps-db";
import { and, eq, isNull, notExists } from "drizzle-orm";

export const BIKE_STEPS_REASON = "Bike sets became steps";

export async function migrateBikeSetsToSteps(opts: { userId?: string } = {}): Promise<{ moved: number; waiting: number; failed: number }> {
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
        eq(exercises.discipline, "bike"),
        isNull(programSets.stepKind),
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
                eq(planRevisions.reason, BIKE_STEPS_REASON),
              ),
            ),
        ),
      ),
    )
    .orderBy(programs.id);

  const counts = { moved: 0, waiting: 0, failed: 0 };
  for (const { programId, userId } of candidates) {
    try {
      const { result } = await planWrite({ userId, writer: "sync", reason: BIKE_STEPS_REASON }, async (w) => {
        if (await openWorkoutOn(w.tx, userId, [programId])) return false;
        await w.touch({ type: "program", id: programId });
        const slots = await w.tx
          .select({ id: programExercises.id })
          .from(programExercises)
          .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
          .where(and(eq(programExercises.programId, programId), liveProgramExercises, eq(exercises.discipline, "bike")));
        for (const s of slots) await bikeSetsToSteps(w.tx, s.id);
        return true;
      });
      counts[result ? "moved" : "waiting"]++;
    } catch (err) {
      counts.failed++;
      console.error("[migrateBikeSetsToSteps] program failed", { programId, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  if (candidates.length) console.log("[migrateBikeSetsToSteps] done", counts);
  return counts;
}
