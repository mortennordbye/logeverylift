/**
 * What a run's frozen plan reads from the runner's own runs
 * (docs/plans/run-logger.md, 4.2 and 4.3): the belts of done treadmill steps
 * with a Garmin average heart rate (a heart rate step's belt), and the speed
 * of done easy outdoor steps (an outdoor distance step's time). Both from the
 * last 6 weeks, from the steps the run results store (step 4).
 *
 * Plain server code: callers resolve the user.
 */

import { db } from "@/db";
import { rides, workoutSessions, workoutSets } from "@/db/schema";
import { recentEasySpeed, type BeltHistoryStep, type EasyHistoryStep } from "@/lib/utils/run-plan";
import { and, eq, gt, isNotNull, isNull, ne, or } from "drizzle-orm";

/** The plan looks back this far (4.2, 4.3). */
export const RUN_HISTORY_DAYS = 42;

export type RunPlanHistory = { history: BeltHistoryStep[]; easySpeed: number | null };

/** The belt history and recent easy speed of the user's runs, for `buildRunPlan`. */
export async function runPlanHistory(userId: string, lthr: number | null | undefined): Promise<RunPlanHistory> {
  const since = new Date(Date.now() - RUN_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  // One row per step: a step logs to the session and program exercise of its run.
  const rows = await db
    .selectDistinct({
      id: workoutSets.id,
      mode: rides.mode,
      surface: rides.surface,
      avgSpeed: workoutSets.avgSpeed,
      avgHr: workoutSets.avgHr,
      seconds: workoutSets.durationSeconds,
      meters: workoutSets.distanceMeters,
      sources: workoutSets.sources,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, and(eq(workoutSessions.id, workoutSets.sessionId), eq(workoutSessions.userId, userId)))
    .innerJoin(
      rides,
      and(eq(rides.userId, userId), eq(rides.sport, "run"), eq(rides.sessionId, workoutSets.sessionId), eq(rides.programExerciseId, workoutSets.programExerciseId)),
    )
    .where(
      and(
        eq(workoutSets.stepStatus, "done"),
        gt(workoutSessions.startTime, since),
        isNotNull(workoutSets.avgHr),
        isNotNull(workoutSets.durationSeconds),
        or(isNull(rides.surface), ne(rides.surface, "trail")),
      ),
    );
  const history: BeltHistoryStep[] = [];
  const easy: EasyHistoryStep[] = [];
  for (const r of rows) {
    const seconds = r.seconds ?? 0;
    // A belt the runner ran (from the belt or typed in the results), with the heart rate Garmin measured.
    const belt = r.sources?.avgSpeed === "belt" || r.sources?.avgSpeed === "typed";
    if (r.mode === "indoor" && belt && r.avgSpeed && r.sources?.avgHr === "garmin") history.push({ beltKmh: r.avgSpeed * 3.6, avgHr: r.avgHr!, seconds });
    if (r.mode === "outdoor" && r.meters && seconds > 0) easy.push({ meters: r.meters, seconds, avgHr: r.avgHr! });
  }
  return { history, easySpeed: recentEasySpeed(easy, lthr) };
}
