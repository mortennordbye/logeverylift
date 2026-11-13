import { db } from "@/db";
import { writeLoggedSession } from "@/lib/logged-sessions";
import { lockRecords } from "@/lib/workout-records";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createExercise, createUser } from "./factories";

/**
 * A logged session (log_session, "Did you do it?", step results) takes the
 * per-exercise records lock before it writes any row, as a set write does,
 * so it and the e2e reset (which takes the same locks first) wait on each
 * other in one order instead of deadlocking (review item 6).
 */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("writeLoggedSession lock order", () => {
  it("waits for the records lock before it inserts the session", async () => {
    const me = (await createUser()).id;
    const run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holder = 0;
    // Another transaction holds the records lock for the exercise.
    const blocker = db.transaction(async (tx) => {
      await lockRecords(tx, me, run);
      holder = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      await held;
    });
    while (!holder) await pause(10);

    const write = writeLoggedSession(me, {
      date: "2026-11-10",
      start: new Date("2026-11-10T07:00:00Z"),
      programId: null,
      plannedSessionId: null,
      source: "assistant",
      sets: [{ exerciseId: run, setNumber: 1, durationSeconds: 1800 }],
    });
    // The write is now waiting on the lock.
    let waiter: number | null = null;
    for (let i = 0; i < 200 && waiter == null; i++) {
      const r = await db.execute<{ pid: number }>(sql`SELECT pid FROM pg_stat_activity WHERE ${holder} = ANY(pg_blocking_pids(pid))`);
      waiter = r.rows[0]?.pid ?? null;
      if (waiter == null) await pause(10);
    }
    expect(waiter).not.toBeNull();
    // ...and holds no row lock on workout_sessions yet: nothing for a reset to wait on.
    const locks = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE l.pid = ${waiter} AND c.relname = 'workout_sessions' AND l.mode = 'RowExclusiveLock'`);
    expect(locks.rows[0].n).toBe(0);

    release();
    await blocker;
    const row = await write;
    expect(row.userId).toBe(me);
  });
});
