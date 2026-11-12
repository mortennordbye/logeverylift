/**
 * Ghost sessions: workouts marked completed that hold no logged sets. Before
 * the stale-session sweeps were fixed (closeStaleSessions in
 * src/lib/actions/workout-sessions.ts), every workout screen opened and left
 * became one, closed as "completed" with an 11-24 hour duration. The sweeps
 * still close empty sessions (with no duration) and never delete them, since
 * an empty session's sets may still be in the phone's offline queue. Decision
 * D23 in docs/triathlon-coach-audit.md removes the old ones with the
 * owner-run scripts/cleanup-ghost-sessions.ts; this is its logic, kept here so
 * the integration suite can run it against the test database.
 *
 * A ghost is a completed `app` session with no sets, no notes and no feeling,
 * that started more than GHOST_MIN_AGE_DAYS ago: long past any offline queue.
 * `auto` sessions have no sets by design. A session the user finished with a
 * note or a feeling is kept: they meant it.
 */

import { db } from "@/db";
import { workoutSessions, workoutSets } from "@/db/schema";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

export const GHOST_MIN_AGE_DAYS = 7;

const noSets = sql`NOT EXISTS (SELECT 1 FROM ${workoutSets} WHERE ${workoutSets.sessionId} = ${workoutSessions.id})`;

function isGhost(now: Date) {
  return and(
    eq(workoutSessions.isCompleted, true),
    eq(workoutSessions.source, "app"),
    isNull(workoutSessions.feeling),
    sql`COALESCE(TRIM(${workoutSessions.notes}), '') = ''`,
    lt(workoutSessions.startTime, new Date(now.getTime() - GHOST_MIN_AGE_DAYS * 86_400_000)),
    noSets,
  );
}

export type GhostSession = {
  id: number;
  userId: string;
  date: string;
  /** End minus start, in hours; null when the session has no end time. */
  hours: number | null;
};

export async function findGhostSessions(now: Date = new Date()): Promise<GhostSession[]> {
  const rows = await db
    .select({
      id: workoutSessions.id,
      userId: workoutSessions.userId,
      date: workoutSessions.date,
      startTime: workoutSessions.startTime,
      endTime: workoutSessions.endTime,
    })
    .from(workoutSessions)
    .where(isGhost(now))
    .orderBy(asc(workoutSessions.userId), asc(workoutSessions.startTime));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    date: r.date,
    hours: r.endTime ? Math.round(((r.endTime.getTime() - r.startTime.getTime()) / 3_600_000) * 10) / 10 : null,
  }));
}

/**
 * Delete every ghost and return the ids deleted.
 *
 * A single DELETE ... WHERE NOT EXISTS is not safe under READ COMMITTED: its
 * subquery reads a snapshot from before a set committed at the same moment,
 * and the delete then cascades that set away with its session. So, in one
 * transaction, the candidates are locked first (FOR UPDATE, which an insert
 * into workout_sets has to wait for, since its foreign key takes a share lock
 * on the session row), and the DELETE, a new statement with a new snapshot,
 * checks "no sets" again. A set committed before the lock is seen and keeps
 * its session; one that comes after waits until the delete is done.
 */
export async function deleteGhostSessions(now: Date = new Date()): Promise<number[]> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(isGhost(now))
      .for("update");
    if (locked.length === 0) return [];
    const deleted = await tx
      .delete(workoutSessions)
      .where(and(inArray(workoutSessions.id, locked.map((l) => l.id)), noSets))
      .returning({ id: workoutSessions.id });
    return deleted.map((d) => d.id);
  });
}
