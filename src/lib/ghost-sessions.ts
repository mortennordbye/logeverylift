/**
 * Ghost sessions: workouts marked completed that hold no logged sets. Before
 * the stale-session sweeps were fixed (closeStaleSessions in
 * src/lib/actions/workout-sessions.ts), every workout screen opened and left
 * became one, closed as "completed" with an 11-24 hour duration. Decision D23
 * in docs/triathlon-coach-audit.md removes the old ones with
 * scripts/cleanup-ghost-sessions.ts; this is its logic, kept here so the
 * integration suite can run it against the test database.
 *
 * A ghost is a completed `app` session with no sets, no notes and no feeling.
 * `auto` sessions have no sets by design. A session the user finished with a
 * note or a feeling is kept: they meant it.
 */

import { db } from "@/db";
import { workoutSessions, workoutSets } from "@/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

const isGhost = and(
  eq(workoutSessions.isCompleted, true),
  eq(workoutSessions.source, "app"),
  isNull(workoutSessions.feeling),
  sql`COALESCE(TRIM(${workoutSessions.notes}), '') = ''`,
  sql`NOT EXISTS (SELECT 1 FROM ${workoutSets} WHERE ${workoutSets.sessionId} = ${workoutSessions.id})`,
);

export type GhostSession = {
  id: number;
  userId: string;
  date: string;
  /** End minus start, in hours; null when the session has no end time. */
  hours: number | null;
};

export async function findGhostSessions(): Promise<GhostSession[]> {
  const rows = await db
    .select({
      id: workoutSessions.id,
      userId: workoutSessions.userId,
      date: workoutSessions.date,
      startTime: workoutSessions.startTime,
      endTime: workoutSessions.endTime,
    })
    .from(workoutSessions)
    .where(isGhost)
    .orderBy(asc(workoutSessions.userId), asc(workoutSessions.startTime));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    date: r.date,
    hours: r.endTime ? Math.round(((r.endTime.getTime() - r.startTime.getTime()) / 3_600_000) * 10) / 10 : null,
  }));
}

/**
 * Delete every ghost. The rule is checked again in the DELETE itself, so a set
 * logged between the dry run and this call keeps its session. Returns the ids
 * deleted.
 */
export async function deleteGhostSessions(): Promise<number[]> {
  const deleted = await db.delete(workoutSessions).where(isGhost).returning({ id: workoutSessions.id });
  return deleted.map((d) => d.id);
}
