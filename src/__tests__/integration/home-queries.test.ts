import { db, pool } from "@/db";
import { plannedSessions, trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import Home from "@/app/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * T2 in docs/home-widgets-audit.md: the number of statements one home render
 * sends to the database, per user type. The counts were recorded against the
 * page before the widget system (commit 1 of that build), with this same
 * harness. They must not change: the default layout adds no query. One
 * exception, by owner decision A (2026-11-14): on a day with one program,
 * Today reads that program's exercises and sets in one more statement
 * (`readTodayPlan` in src/lib/home/core.ts). It shows here as +2, the
 * query and the pool checkout it makes. A second, by the owner (2026-11-14,
 * "it should still show I have a season and the cycle which are coming up"):
 * with no active cycle, Today reads the block scheduled to start next
 * (`upcomingCycle` in src/lib/home/core.ts), +2 the same way.
 *
 * A statement is a `pool.query` call or a `pool.connect` (a transaction). The
 * page runs twice per user: the first render writes the cycle's sessions, the
 * second is the steady state a returning user sees.
 *
 * Under Vitest React's `cache()` does not dedupe, so a read that is shared in
 * production counts once per call here. The counts are for comparison, not
 * the production number.
 *
 * The clock is fixed at Thu 2026-11-05 12:00 UTC and the user's zone is UTC.
 */

let me: string;
let progA: number;
let progB: number;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  const now = new Date();
  me = (
    await createUser({ timeZone: "UTC", termsVersion: LEGAL_VERSION, policySeenVersion: LEGAL_VERSION, termsAcceptedAt: now })
  ).id;
  asUser(me);
  const lift = await createExercise();
  progA = (await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
  progB = (await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Statements sent while rendering the home once. */
async function countHome(): Promise<number> {
  const query = vi.spyOn(pool, "query");
  const connect = vi.spyOn(pool, "connect");
  await Home();
  const n = query.mock.calls.length + connect.mock.calls.length;
  query.mockRestore();
  connect.mockRestore();
  return n;
}

async function weekdayCycle() {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: 2, programId: progB },
    { trainingCycleId: cycle.id, dayOfWeek: 4, programId: progA },
  ]);
  return cycle.id;
}

describe("statements per home render (T2)", () => {
  it("lifter, weekday cycle with a missed day", async () => {
    await weekdayCycle();
    const first = await countHome();
    const steady = await countHome();
    expect({ first, steady }).toEqual({ first: 78, steady: 70 });
  });

  it("lifter, rotation cycle", async () => {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Rot", durationWeeks: 4, status: "active", startDate: "2026-11-05", scheduleType: "rotation" })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: cycle.id, orderIndex: 1, programId: progA },
      { trainingCycleId: cycle.id, orderIndex: 2, programId: progB },
    ]);
    const first = await countHome();
    const steady = await countHome();
    expect({ first, steady }).toEqual({ first: 61, steady: 54 });
  });

  it("no cycle", async () => {
    const first = await countHome();
    const steady = await countHome();
    expect({ first, steady }).toEqual({ first: 26, steady: 26 });
  });

  it("endurance, weekday cycle with a session today and one to confirm", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, me));
    const cycleId = await weekdayCycle();
    const run = { v: 1, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 1800 } }] };
    await db.insert(plannedSessions).values([
      { userId: me, cycleId, date: "2026-11-05", label: "Tempo", workout: run },
      { userId: me, cycleId, date: "2026-11-04", label: "Easy", workout: run },
    ]);
    const first = await countHome();
    const steady = await countHome();
    expect({ first, steady }).toEqual({ first: 152, steady: 118 });
  });
});
