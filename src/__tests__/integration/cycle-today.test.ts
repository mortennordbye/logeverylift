import { db } from "@/db";
import { dismissedMakeups, trainingCycleSlots, trainingCycles, users, workoutSessions } from "@/db/schema";
import {
  dismissMissedWorkout,
  getActiveCycleForUser,
  skipAutoCompletedDay,
} from "@/lib/actions/training-cycles";
import { completeWorkoutSession, createWorkoutSession } from "@/lib/actions/workout-sessions";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Characterization tests for package C2 (docs/plans/sessions.md, 8.1, C3-C8):
 * what `getActiveCycleForUser` gives a lifter today, against a real database.
 * They pass on main before the session model changes. Their assertions must
 * not change after it; only setup may grow.
 *
 * The clock is fixed at Thu 2026-11-05 12:00 UTC and the user's zone is UTC.
 */

let me: string;
let progA: number; // Monday
let progB: number; // Wednesday
let progC: number; // Thursday
let other: number; // in no cycle

const TODAY = "2026-11-05"; // Thursday

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
  const lift = await createExercise();
  const make = async () => (await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
  progA = await make();
  progB = await make();
  progC = await make();
  other = await make();
  at(`${TODAY}T12:00:00Z`);
});

afterEach(() => {
  vi.useRealTimers();
});

/** An active weekday cycle: Mon A, Wed B, Thu C, Sat rest. */
async function weekdayCycle(startDate = "2026-10-26", auto: { mon?: boolean; thu?: boolean } = {}) {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: 1, programId: progA, autoComplete: auto.mon ?? false },
    { trainingCycleId: cycle.id, dayOfWeek: 3, programId: progB },
    { trainingCycleId: cycle.id, dayOfWeek: 4, programId: progC, autoComplete: auto.thu ?? false },
    { trainingCycleId: cycle.id, dayOfWeek: 6, programId: null, label: "Rest" },
  ]);
  return cycle.id;
}

/** An active rotation cycle from Mon 2026-11-02: A, B, rest. */
async function rotationCycle(autoA = false) {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Rotation", durationWeeks: 4, status: "active", startDate: "2026-11-02", scheduleType: "rotation" })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, orderIndex: 1, programId: progA, autoComplete: autoA },
    { trainingCycleId: cycle.id, orderIndex: 2, programId: progB },
    { trainingCycleId: cycle.id, orderIndex: 3, programId: null },
  ]);
  return cycle.id;
}

/** A completed session on a date, with no sets unless the test adds them. */
const done = (programId: number | null, date: string, extra: Partial<typeof workoutSessions.$inferInsert> = {}) =>
  createSession(me, programId, { date, startTime: new Date(`${date}T08:00:00Z`), isCompleted: true, ...extra });

async function active() {
  const result = await getActiveCycleForUser();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const missedOf = async () => (await active())!.missedSlots.map((m) => [m.date, m.slot.programId]);

const autoRows = () =>
  db
    .select({ id: workoutSessions.id, date: workoutSessions.date, programId: workoutSessions.programId })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, me), eq(workoutSessions.source, "auto")))
    .orderBy(asc(workoutSessions.date), asc(workoutSessions.programId));

describe("C3: today's slot on a weekday cycle", () => {
  it("is the slot of today's weekday", async () => {
    await weekdayCycle();
    const info = await active();
    expect(info!.todaySlot?.programId).toBe(progC);
    expect(info!.currentWeek).toBe(2);
  });

  it("is a slot with no program on a rest day", async () => {
    await weekdayCycle();
    at("2026-11-07T12:00:00Z"); // Saturday
    const info = await active();
    expect(info!.todaySlot).not.toBeNull();
    expect(info!.todaySlot!.programId).toBeNull();
  });

  it("is null on a day with no slot", async () => {
    await weekdayCycle();
    at("2026-11-08T12:00:00Z"); // Sunday
    expect((await active())!.todaySlot).toBeNull();
  });
});

describe("C4: missed workouts on a weekday cycle", () => {
  it("lists the last 7 days' program days with no session, oldest first", async () => {
    await weekdayCycle();
    // Window Thu 29 Oct to Wed 4 Nov: Thu C, Mon A, Wed B. Sat is rest.
    expect(await missedOf()).toEqual([
      ["2026-10-29", progC],
      ["2026-11-02", progA],
      ["2026-11-04", progB],
    ]);
  });

  it("never looks before the cycle start", async () => {
    await weekdayCycle("2026-11-02");
    expect(await missedOf()).toEqual([
      ["2026-11-02", progA],
      ["2026-11-04", progB],
    ]);
  });

  it("is cleared by a completed session of any program, an empty one, or the assistant's", async () => {
    await weekdayCycle();
    await done(other, "2026-10-29"); // another program, no sets
    await done(null, "2026-11-02"); // no program, no sets (a swept ghost)
    await done(progA, "2026-11-04", { source: "assistant" }); // the wrong program, by the assistant
    expect(await missedOf()).toEqual([]);
  });

  it("is not cleared by a session that is still open", async () => {
    await weekdayCycle();
    await createSession(me, progA, { date: "2026-11-02", startTime: new Date("2026-11-02T08:00:00Z") });
    expect((await missedOf()).map(([date]) => date)).toContain("2026-11-02");
  });

  it("is cleared by a make-up on the day it makes up and on the day it was done", async () => {
    await weekdayCycle();
    await done(progA, "2026-11-04", { intendedDate: "2026-11-02" });
    expect(await missedOf()).toEqual([["2026-10-29", progC]]);
  });

  it("leaves out a declined day", async () => {
    await weekdayCycle();
    await db.insert(dismissedMakeups).values({ userId: me, date: "2026-11-02" });
    expect((await missedOf()).map(([date]) => date)).toEqual(["2026-10-29", "2026-11-04"]);
  });

  it("is empty with missed workouts switched off", async () => {
    await weekdayCycle();
    await db.update(users).set({ missedWorkoutsEnabled: false }).where(eq(users.id, me));
    const info = await active();
    expect(info!.missedSlots).toEqual([]);
    expect(info!.todaySlot?.programId).toBe(progC);
  });
});

describe("C5: auto days", () => {
  it("writes a completed auto row for today and the past 7 days, once", async () => {
    await weekdayCycle("2026-10-26", { mon: true, thu: true });
    await active();
    await active();
    expect((await autoRows()).map((r) => [r.date, r.programId])).toEqual([
      ["2026-10-29", progC],
      ["2026-11-02", progA],
      ["2026-11-05", progC],
    ]);
    // Auto days count as done: only Wednesday is missed.
    expect(await missedOf()).toEqual([["2026-11-04", progB]]);
  });

  it("skips a day logged for the same program, not one logged for another program", async () => {
    await weekdayCycle("2026-10-26", { mon: true });
    await done(progA, "2026-10-26"); // outside the window anyway
    await done(other, "2026-11-02");
    await active();
    expect((await autoRows()).map((r) => r.date)).toEqual(["2026-11-02"]);

    await db.delete(workoutSessions).where(eq(workoutSessions.source, "auto"));
    await done(progA, "2026-11-02");
    await active();
    expect(await autoRows()).toEqual([]);
  });

  it("is still written with missed workouts switched off", async () => {
    await weekdayCycle("2026-10-26", { thu: true });
    await db.update(users).set({ missedWorkoutsEnabled: false }).where(eq(users.id, me));
    await active();
    expect((await autoRows()).map((r) => r.date)).toEqual(["2026-10-29", "2026-11-05"]);
  });

  it("'I skipped it' deletes the row; it is not written again and not missed", async () => {
    await weekdayCycle("2026-10-26", { mon: true });
    await active();
    const monday = (await autoRows()).find((r) => r.date === "2026-11-02")!;
    expect(await skipAutoCompletedDay({ sessionId: monday.id })).toEqual({ success: true, data: null });
    await active();
    expect(await autoRows()).toEqual([]);
    expect((await missedOf()).map(([date]) => date)).not.toContain("2026-11-02");
  });

  it("is replaced when a real session of that program and day is finished", async () => {
    await weekdayCycle("2026-10-26", { mon: true });
    await active();
    const real = await createSession(me, progA, { date: "2026-11-02", startTime: new Date("2026-11-02T08:00:00Z") });
    expect((await completeWorkoutSession({ sessionId: real.id })).success).toBe(true);
    expect(await autoRows()).toEqual([]);
  });

  it("writes one row per day when reads race", async () => {
    await weekdayCycle("2026-10-26", { thu: true });
    await Promise.all([active(), active(), active()]);
    expect((await autoRows()).map((r) => r.date)).toEqual(["2026-10-29", "2026-11-05"]);
  });
});

describe("C6: rotation cycles", () => {
  it("waits on a missed slot and reports the days it was missed", async () => {
    await rotationCycle();
    const info = await active();
    expect(info!.todaySlot?.programId).toBe(progA);
    expect(info!.missedSlots.map((m) => [m.date, m.slot.programId])).toEqual([
      ["2026-11-02", progA],
      ["2026-11-03", progA],
      ["2026-11-04", progA],
    ]);
  });

  it("advances on any completed session, one per day, and on rest days by itself", async () => {
    await rotationCycle();
    await done(other, "2026-11-02");
    await done(other, "2026-11-03");
    // 02 A, 03 B, 04 rest; today is A again.
    const info = await active();
    expect(info!.todaySlot?.programId).toBe(progA);
    expect(info!.missedSlots).toEqual([]);
  });

  it("uses one session of a day with two, and ignores a make-up's intended date", async () => {
    await rotationCycle();
    await done(progA, "2026-11-02");
    await done(progB, "2026-11-02");
    await done(progB, "2026-11-05", { intendedDate: "2026-11-03" });
    const info = await active();
    expect(info!.todaySlot?.programId).toBe(progB);
    expect(info!.missedSlots.map((m) => m.date)).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("writes an auto row for today's slot only", async () => {
    await rotationCycle(true);
    await active();
    expect((await autoRows()).map((r) => [r.date, r.programId])).toEqual([[TODAY, progA]]);
  });

  it("hides the overdue days with missed workouts switched off", async () => {
    await rotationCycle();
    await db.update(users).set({ missedWorkoutsEnabled: false }).where(eq(users.id, me));
    const info = await active();
    expect(info!.todaySlot?.programId).toBe(progA);
    expect(info!.missedSlots).toEqual([]);
  });
});

describe("C7: block end and scheduled start", () => {
  it("completes a block that is over and returns no cycle", async () => {
    const id = await weekdayCycle("2026-10-01"); // 4 weeks: over on 29 Oct
    expect(await active()).toBeNull();
    const [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, id));
    expect(row.status).toBe("completed");
  });

  it("starts a cycle scheduled for today and completes the old one", async () => {
    const old = await weekdayCycle();
    const [draft] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Next", durationWeeks: 4, status: "draft", scheduledStartDate: TODAY })
      .returning();
    const info = await active();
    expect(info!.cycle.id).toBe(draft.id);
    expect(info!.cycle.startDate).toBe(TODAY);
    const [oldRow] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, old));
    expect(oldRow.status).toBe("completed");
  });
});

describe("C8: make up and decline", () => {
  it("a make-up started with the missed day stores it, and finishing it clears that day", async () => {
    await weekdayCycle();
    const created = await createWorkoutSession({ date: TODAY, startTime: `${TODAY}T12:00:00Z`, programId: progA, intendedDate: "2026-11-02" });
    if (!created.success) throw new Error(created.error);
    expect(created.data.intendedDate).toBe("2026-11-02");
    expect((await missedOf()).map(([date]) => date)).toContain("2026-11-02");
    expect((await completeWorkoutSession({ sessionId: created.data.id })).success).toBe(true);
    expect((await missedOf()).map(([date]) => date)).toEqual(["2026-10-29", "2026-11-04"]);
  });

  it("declining writes one row per date, and the day leaves the list", async () => {
    await weekdayCycle();
    expect(await dismissMissedWorkout({ date: "2026-11-04" })).toEqual({ success: true, data: null });
    expect(await dismissMissedWorkout({ date: "2026-11-04" })).toEqual({ success: true, data: null });
    const rows = await db.select().from(dismissedMakeups).where(eq(dismissedMakeups.userId, me));
    expect(rows.map((r) => r.date)).toEqual(["2026-11-04"]);
    expect((await missedOf()).map(([date]) => date)).toEqual(["2026-10-29", "2026-11-02"]);
  });

  it("another user's decline does not touch mine", async () => {
    await weekdayCycle();
    asUser((await createUser()).id);
    await dismissMissedWorkout({ date: "2026-11-04" });
    asUser(me);
    expect((await missedOf()).map(([date]) => date)).toEqual(["2026-10-29", "2026-11-02", "2026-11-04"]);
  });
});
