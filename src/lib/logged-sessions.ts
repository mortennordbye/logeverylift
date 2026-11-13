/**
 * Write one completed workout done outside the app, with its sets: the MCP
 * `log_session` tool and the app's "Yes, I did it" answer
 * (docs/plans/workouts-and-compliance.md, 6.5) share this, so the per-day
 * lock, the duplicate check, the auto-row delete and the PR rebuild are the
 * same in both. Callers validate the input and resolve the user first.
 */

import { db } from "@/db";
import { workoutSessions, workoutSets } from "@/db/schema";
import type { Tx } from "@/lib/plan-revisions";
import { rpeFromRir } from "@/lib/utils/rir";
import { lockRecords, rebuildPRsFrom } from "@/lib/workout-records";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

export type LoggedSet = {
  exerciseId: number;
  setNumber: number;
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  heartRateZone?: number;
  rir?: number;
  rpe?: number;
  notes?: string;
  setType?: "working" | "warmup";
};

export type LoggedSessionInput = {
  date: string;
  start: Date;
  programId: number | null;
  plannedSessionId: number | null;
  durationMinutes?: number;
  feeling?: (typeof workoutSessions.$inferInsert)["feeling"];
  notes?: string | null;
  source: "app" | "assistant";
  sets: LoggedSet[];
};

/** The new log repeats a session the user already has. */
export class DuplicateSession extends Error {
  constructor(readonly sessionId: number) {
    super(`The user already logged this on that day (session ${sessionId}). Read recent_workouts.`);
  }
}

/**
 * A completed session the new log would repeat: one linked to the same
 * planned session; the same program on the same day; or, with no program, an
 * assistant-logged session that day with the same exercises.
 */
async function findDuplicate(tx: Tx, userId: string, input: LoggedSessionInput, exerciseIds: number[]) {
  const done = and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true), ne(workoutSessions.source, "auto"));
  if (input.plannedSessionId != null) {
    const [dup] = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(done, eq(workoutSessions.plannedSessionId, input.plannedSessionId)))
      .limit(1);
    if (dup) return dup.id;
  }
  const sameDay = and(done, eq(workoutSessions.date, input.date));
  if (input.programId != null) {
    const [dup] = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(sameDay, eq(workoutSessions.programId, input.programId)))
      .limit(1);
    return dup?.id ?? null;
  }
  const rows = await tx
    .select({ id: workoutSessions.id, exerciseId: workoutSets.exerciseId })
    .from(workoutSessions)
    .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(and(sameDay, isNull(workoutSessions.programId), eq(workoutSessions.source, "assistant")));
  const want = [...exerciseIds].sort((a, b) => a - b).join(",");
  const bySession = new Map<number, Set<number>>();
  for (const r of rows) bySession.set(r.id, (bySession.get(r.id) ?? new Set()).add(r.exerciseId));
  for (const [id, ids] of bySession) if ([...ids].sort((a, b) => a - b).join(",") === want) return id;
  return null;
}

/**
 * Write the session and its sets in one transaction. Throws DuplicateSession
 * when it repeats one. `after` runs in the same transaction, for rows that
 * belong to the new session (the step results, docs/plans/endurance-app.md 5.2).
 */
export async function writeLoggedSession(userId: string, input: LoggedSessionInput, after?: (tx: Tx, sessionId: number) => Promise<void>) {
  const exerciseIds = [...new Set(input.sets.map((s) => s.exerciseId))];
  return db.transaction(async (tx) => {
    // One log per user and day at a time, so a retried call cannot
    // write the same session twice.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`log_session:${userId}:${input.date}`}))`);
    const dup = await findDuplicate(tx, userId, input, exerciseIds);
    if (dup) throw new DuplicateSession(dup);
    const start = input.start;
    const [row] = await tx
      .insert(workoutSessions)
      .values({
        userId,
        programId: input.programId,
        plannedSessionId: input.plannedSessionId,
        date: input.date,
        startTime: start,
        endTime: input.durationMinutes ? new Date(start.getTime() + input.durationMinutes * 60_000) : null,
        feeling: input.feeling ?? null,
        notes: input.notes ?? null,
        isCompleted: true,
        source: input.source,
      })
      .returning();
    // Dated by when they happened: the records replay orders and dates
    // sets by createdAt. One second apart keeps the input's order.
    await tx.insert(workoutSets).values(
      input.sets.map((s, i) => ({
        sessionId: row.id,
        exerciseId: s.exerciseId,
        setNumber: s.setNumber,
        setType: s.setType ?? "working",
        actualReps: s.reps ?? 0,
        weightKg: String(s.weightKg ?? 0),
        durationSeconds: s.durationSeconds ?? null,
        distanceMeters: s.distanceMeters ?? null,
        heartRateZone: s.heartRateZone ?? null,
        rir: s.rir ?? null,
        rpe: s.rir != null ? rpeFromRir(s.rir) : (s.rpe ?? null),
        restTimeSeconds: 0,
        notes: s.notes ?? null,
        createdAt: new Date(start.getTime() + i * 1000),
      })),
    );
    // As completeWorkoutSession: a logged day replaces its auto row.
    if (input.plannedSessionId != null) {
      await tx
        .delete(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.plannedSessionId, input.plannedSessionId), eq(workoutSessions.source, "auto")));
    }
    if (input.programId != null) {
      await tx
        .delete(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.programId, input.programId),
            eq(workoutSessions.date, input.date),
            eq(workoutSessions.source, "auto"),
          ),
        );
    }
    for (const exerciseId of exerciseIds.sort((a, b) => a - b)) {
      await lockRecords(tx, userId, exerciseId);
      await rebuildPRsFrom(tx, userId, exerciseId, start);
    }
    if (after) await after(tx, row.id);
    return row;
  });
}
