import { db } from "@/db";
import { plannedSessions, trainingCycleSlots, trainingCycles, workoutSessions } from "@/db/schema";
import { ensureCycleSessions, skipAutoDay } from "@/lib/planned-sessions";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";

/**
 * "I skipped it" on an auto day (skipAutoDay) locks the session's cycle
 * before it touches the planned session or deletes the auto row. Plan writes
 * lock cycles first, and the e2e reset locks the account's cycles before it
 * deletes its sessions; without the cycle lock the skip could hold the
 * planned session, wait on the auto row the reset deleted, while the reset
 * waited on the planned session through the cycle's cascade (review item 2).
 * The clock is fixed at Thu 2026-11-05 12:00 UTC.
 */

const TODAY = "2026-11-05";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe("skipAutoDay lock order", () => {
  it("waits for the cycle's lock before it changes anything", async () => {
    const me = (await createUser({ timeZone: "UTC" })).id;
    const lift = await createExercise();
    const { program } = await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }]);
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 3, programId: program.id, autoComplete: true });
    await ensureCycleSessions(me, c.id);
    const [p] = await db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, c.id), eq(plannedSessions.date, "2026-11-04")));
    const [auto] = await db
      .insert(workoutSessions)
      .values({ userId: me, date: "2026-11-04", isCompleted: true, source: "auto", programId: program.id, plannedSessionId: p.id, startTime: new Date("2026-11-04T12:00:00Z") })
      .returning();

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holder = 0;
    // The reset (or a plan write) holds the cycle.
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM training_cycles WHERE id = ${c.id} FOR UPDATE`);
      holder = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      await held;
    });
    while (!holder) await pause(10);

    let finished = false;
    const skip = skipAutoDay({ userId: me, writer: "user" }, { id: auto.id, plannedSessionId: p.id, programId: program.id, date: "2026-11-04" }).then(() => (finished = true));
    let waiting = false;
    for (let i = 0; i < 100 && !waiting && !finished; i++) {
      const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${holder} = ANY(pg_blocking_pids(pid))`);
      waiting = r.rows[0].n > 0;
      if (!waiting) await pause(20);
    }
    expect(finished).toBe(false);
    expect(waiting).toBe(true);
    // It holds nothing the reset deletes next: the auto row is free to lock.
    const free = await db.transaction(async (tx) => {
      try {
        await tx.execute(sql`SELECT id FROM workout_sessions WHERE id = ${auto.id} FOR UPDATE NOWAIT`);
        return true;
      } catch {
        return false;
      }
    });
    expect(free).toBe(true);

    release();
    await blocker;
    await skip;
    expect((await db.select().from(plannedSessions).where(eq(plannedSessions.id, p.id)))[0].status).toBe("skipped");
    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.id, auto.id))).toHaveLength(0);
  });
});
