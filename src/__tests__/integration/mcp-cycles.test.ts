import { db } from "@/db";
import { planRevisions, programSets, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { getActiveCycleForUser, startTrainingCycle } from "@/lib/actions/training-cycles";
import { startDueScheduledCycle } from "@/lib/plan-revisions";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { periodizedLoad, deloadCadenceForLevel, scaledDuration } from "@/lib/utils/periodization";
import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/** manage_training_cycle: the endurance fields, a scheduled start and set_volume (docs/plans/ai-coach.md, 2.3). */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
});

const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];

async function draft(userId: string, extra: Partial<typeof trainingCycles.$inferInsert> = {}) {
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 12, ...extra }).returning();
  return c.id;
}

describe("endurance fields", () => {
  it("sets race, goal and level on create and update", async () => {
    const call = mcpTools(registerCycleTools, me);
    const created = await call("manage_training_cycle", {
      operation: "create",
      name: "Half build",
      durationWeeks: 16,
      raceDate: "2027-08-22",
      raceDistance: "half",
      goal: "build",
      athleteLevel: "novice",
      reason: "Plan for the half",
    });
    expect(created.isError, created.raw).toBe(false);
    expect(await cycleRow(created.data.id)).toMatchObject({ raceDate: "2027-08-22", raceDistance: "half", athleteLevel: "novice" });

    const updated = await call("manage_training_cycle", {
      operation: "update",
      cycleId: created.data.id,
      raceDate: null,
      raceDistance: null,
      athleteLevel: "intermediate",
      reason: "Race not booked yet",
      expectedVersion: 1,
    });
    expect(updated.isError, updated.raw).toBe(false);
    expect(await cycleRow(created.data.id)).toMatchObject({ raceDate: null, raceDistance: null, athleteLevel: "intermediate", version: 2 });
  });

  it("re-derives this week's targets after a new goal or level", async () => {
    const id = await draft(me, { lastSyncedWeek: 3, goal: "build" });
    await mcpTools(registerCycleTools, me)("manage_training_cycle", { operation: "update", cycleId: id, goal: "maintain", reason: "Hold volume", expectedVersion: 1 });
    expect((await cycleRow(id)).lastSyncedWeek).toBeNull();
  });

  it("refuses them without the endurance switch and changes nothing", async () => {
    const lifter = (await createUser()).id;
    const id = await draft(lifter);
    const result = await mcpTools(registerCycleTools, lifter)("manage_training_cycle", {
      operation: "update",
      cycleId: id,
      raceDate: "2027-08-22",
      reason: "Add race",
      expectedVersion: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.raw).toContain("endurance features");
    expect((await cycleRow(id)).raceDate).toBeNull();
  });
});

describe("start with a later date", () => {
  it("schedules a draft without ending the active block, then starts it on its day", async () => {
    const current = await draft(me, { status: "active", startDate: day(-20) });
    const next = await draft(me);
    const call = mcpTools(registerCycleTools, me);

    const result = await call("manage_training_cycle", { operation: "start", cycleId: next, startDate: day(5), reason: "Base starts Monday", expectedVersion: 1 });
    expect(result.isError, result.raw).toBe(false);
    expect(result.data).toMatchObject({ scheduled: true, startsOn: day(5) });
    expect(await cycleRow(next)).toMatchObject({ status: "draft", scheduledStartDate: day(5) });
    expect((await cycleRow(current)).status).toBe("active");

    // Its day comes (moved here to today): the next read of the active cycle starts it.
    await db.update(trainingCycles).set({ scheduledStartDate: day(-1) }).where(eq(trainingCycles.id, next));
    asUser(me);
    const active = await getActiveCycleForUser();
    expect(active.success && active.data?.cycle.id).toBe(next);
    expect(await cycleRow(next)).toMatchObject({ status: "active", startDate: day(-1), scheduledStartDate: null });
    expect((await cycleRow(current)).status).toBe("completed");
  });

  it("keeps one scheduled cycle, and can cancel it", async () => {
    const a = await draft(me);
    const b = await draft(me);
    const call = mcpTools(registerCycleTools, me);
    await call("manage_training_cycle", { operation: "start", cycleId: a, startDate: day(3), reason: "Plan A", expectedVersion: 1 });
    await call("manage_training_cycle", { operation: "start", cycleId: b, startDate: day(4), reason: "Plan B instead", expectedVersion: 1 });
    expect((await cycleRow(a)).scheduledStartDate).toBeNull();
    expect((await cycleRow(b)).scheduledStartDate).toBe(day(4));

    const cancel = await call("manage_training_cycle", { operation: "update", cycleId: b, scheduledStartDate: null, reason: "Not yet", expectedVersion: 2 });
    expect(cancel.isError, cancel.raw).toBe(false);
    expect((await cycleRow(b)).scheduledStartDate).toBeNull();
  });

  it("refuses a past day, a day too far ahead, and another user's cycle", async () => {
    const id = await draft(me);
    const call = mcpTools(registerCycleTools, me);
    expect((await call("manage_training_cycle", { operation: "start", cycleId: id, startDate: day(-1), reason: "x", expectedVersion: 1 })).raw).toContain("past");
    expect((await call("manage_training_cycle", { operation: "start", cycleId: id, startDate: day(121), reason: "x", expectedVersion: 1 })).raw).toContain("120 days");
    const theirs = await mcpTools(registerCycleTools, other)("manage_training_cycle", { operation: "start", cycleId: id, startDate: day(2), reason: "x", expectedVersion: 1 });
    expect(theirs.raw).toContain("not found");
    expect(await cycleRow(id)).toMatchObject({ status: "draft", scheduledStartDate: null });
  });
});

describe("set_volume", () => {
  it("rewrites this week's periodized targets at the percent, as the assistant", async () => {
    const run = (await createExercise({ name: "Easy Run", category: "cardio", discipline: "run" })).id;
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: [{ durationSeconds: 3600, peakDurationSeconds: 3600, targetReps: null }] }]);
    const id = await draft(me, { status: "active", startDate: day(-14), athleteLevel: "intermediate", goal: "build" });
    await db.insert(trainingCycleSlots).values({ trainingCycleId: id, dayOfWeek: 7, programId: program.id });

    const result = await mcpTools(registerCycleTools, me)("manage_training_cycle", {
      operation: "set_volume",
      cycleId: id,
      pct: 80,
      reason: "Busy week at work",
      expectedVersion: 1,
    });
    expect(result.isError, result.raw).toBe(false);
    expect(result.data).toMatchObject({ week: 3, adaptationPct: 80 });

    const { multiplier } = periodizedLoad(3, 12, "build", deloadCadenceForLevel("intermediate"));
    const [set] = await db.select().from(programSets).where(eq(programSets.id, slots[0].setIds[0]));
    expect(set.durationSeconds).toBe(scaledDuration(3600, multiplier * 0.8));
    const [rev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, id)))
      .orderBy(desc(planRevisions.id))
      .limit(1);
    expect(rev).toMatchObject({ writer: "assistant", reason: "Busy week at work" });
  });

  it("works on the active cycle only, and refuses a stale version", async () => {
    const call = mcpTools(registerCycleTools, me);
    const d = await draft(me);
    expect((await call("manage_training_cycle", { operation: "set_volume", cycleId: d, pct: 90, reason: "x", expectedVersion: 1 })).raw).toContain("active cycle only");
    const a = await draft(me, { status: "active", startDate: day(-3), version: 4 });
    const stale = await call("manage_training_cycle", { operation: "set_volume", cycleId: a, pct: 90, reason: "x", expectedVersion: 2 });
    expect(stale.raw).toContain("Conflict");
    expect((await cycleRow(a)).adaptationPct).toBe(100);
    expect((await call("manage_training_cycle", { operation: "set_volume", cycleId: a, pct: 120, reason: "x", expectedVersion: 4 })).isError).toBe(true);
  });
});

describe("scheduled starts, review fixes", () => {
  it("clears a scheduled start when the user starts another cycle in the app", async () => {
    const b = await draft(me);
    const c = await draft(me);
    await mcpTools(registerCycleTools, me)("manage_training_cycle", { operation: "start", cycleId: b, startDate: day(3), reason: "Next block", expectedVersion: 1 });
    asUser(me);
    expect((await startTrainingCycle(c)).success).toBe(true);
    expect((await cycleRow(b)).scheduledStartDate).toBeNull();

    // Its day would have come: nothing starts, and C stays active.
    expect(await startDueScheduledCycle(me)).toBe(false);
    expect((await cycleRow(c)).status).toBe("active");
  });

  it("refuses to schedule a completed cycle", async () => {
    const done = await draft(me, { status: "completed", startDate: day(-100) });
    const result = await mcpTools(registerCycleTools, me)("manage_training_cycle", { operation: "start", cycleId: done, startDate: day(3), reason: "Again", expectedVersion: 1 });
    expect(result.isError).toBe(true);
    expect(result.raw).toContain("draft");
    expect((await cycleRow(done)).scheduledStartDate).toBeNull();
  });

  it("starts a due scheduled cycle when the assistant lists cycles", async () => {
    const next = await draft(me, { scheduledStartDate: day(0) });
    await mcpTools(registerCycleTools, me)("list_training_cycles");
    expect(await cycleRow(next)).toMatchObject({ status: "active", startDate: day(0), scheduledStartDate: null });
  });

  it("starts a due scheduled cycle once when several reads race", async () => {
    const old = await draft(me, { status: "active", startDate: day(-20) });
    const next = await draft(me, { scheduledStartDate: day(-1) });
    await Promise.all([startDueScheduledCycle(me), startDueScheduledCycle(me), startDueScheduledCycle(me)]);
    expect(await cycleRow(next)).toMatchObject({ status: "active", startDate: day(-1) });
    expect((await cycleRow(old)).status).toBe("completed");
    const starts = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, next), eq(planRevisions.reason, "Scheduled start")));
    expect(starts).toHaveLength(1);
  });
});

