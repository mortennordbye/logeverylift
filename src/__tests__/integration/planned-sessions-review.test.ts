import { db } from "@/db";
import {
  planRevisions,
  plannedSessions,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
} from "@/db/schema";
import { dismissMissedWorkout, getActiveCycleForUser, skipAutoCompletedDay, upsertCycleSlot } from "@/lib/actions/training-cycles";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import { createWorkoutSession } from "@/lib/actions/workout-sessions";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerRevisionTools } from "@/lib/mcp/revisions";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { purgePlanRevisions } from "@/lib/plan-revisions";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * The review fixes of C2 (docs/plans/sessions.md, section 20), each a case
 * that failed on the branch before its fix. The first four started as the
 * lifter reviewer's probes: they pass on main and pin what a lifter sees.
 * The clock is fixed at Thu 2026-11-05 12:00 UTC; the user's zone is UTC.
 */

let me: string;
let progA: number; // Monday
let progB: number; // Wednesday
let progC: number; // Thursday
let other: number; // in no cycle
let bike: number;
const TODAY = "2026-11-05"; // Thursday

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
  const lift = await createExercise();
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  const make = async () => (await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
  progA = await make();
  progB = await make();
  progC = await make();
  other = await make();
  at(`${TODAY}T12:00:00Z`);
});

afterEach(() => vi.useRealTimers());

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

const rows = (cycleId: number) =>
  db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt)))
    .orderBy(asc(plannedSessions.date), asc(plannedSessions.position), asc(plannedSessions.id));

const rowOn = async (cycleId: number, date: string) => (await rows(cycleId)).find((r) => r.date === date)!;

describe("lifter flows, as on main", () => {
  it("1. today's slot stays after 'I skipped it' on today's auto row", async () => {
    await weekdayCycle("2026-10-26", { thu: true });
    await active();
    const thu = (await autoRows()).find((r) => r.date === TODAY)!;
    expect((await skipAutoCompletedDay({ sessionId: thu.id })).success).toBe(true);
    const a = await active();
    expect(a!.todaySlot?.programId).toBe(progC);
    expect(a!.missedSlots.map((m) => m.date)).not.toContain(TODAY);
  });

  it("2. turning on auto mid-week writes this week's past Monday", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    expect((await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, programId: progA, autoComplete: true })).success).toBe(true);
    await active();
    expect((await autoRows()).map((r) => r.date)).toContain("2026-11-02");
  });

  it("3. a program changed mid-week: the missed Wednesday names the new program", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    expect((await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 3, programId: other })).success).toBe(true);
    expect(await missedOf()).toContainEqual(["2026-11-04", other]);
  });

  it("4. a rest day turned into a program day mid-week shows as missed", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    expect((await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 2, programId: other })).success).toBe(true);
    expect(await missedOf()).toContainEqual(["2026-11-03", other]);
  });

  it("2-4. a template edit leaves done, changed and last week's sessions as they were", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    // Last Thursday (last week), this Monday done, this Wednesday moved to Friday.
    await createSession(me, progA, { date: "2026-11-02", startTime: new Date("2026-11-02T08:00:00Z"), isCompleted: true });
    const wed = await rowOn(id, "2026-11-04");
    expect((await updatePlannedSession({ op: "move", id: wed.id, date: "2026-11-06" })).success).toBe(true);
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, programId: other });
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 3, programId: other });
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 4, programId: other });
    const all = await rows(id);
    expect(all.find((r) => r.date === "2026-10-29")?.programId).toBe(progC); // last week
    expect(all.find((r) => r.date === "2026-11-02")?.programId).toBe(progA); // done
    expect(all.find((r) => r.id === wed.id)).toMatchObject({ date: "2026-11-06", programId: progB }); // moved
    expect(all.find((r) => r.date === TODAY)?.programId).toBe(other); // today, untouched
  });

  it("6. 'I skipped it' changes nothing when the skip fails", async () => {
    await weekdayCycle("2026-10-26", { thu: true });
    await active();
    const thu = (await autoRows()).find((r) => r.date === TODAY)!;
    await db.execute(sql`CREATE OR REPLACE FUNCTION c2_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER c2_refuse BEFORE INSERT ON dismissed_makeups FOR EACH ROW EXECUTE FUNCTION c2_refuse()`);
    try {
      const r = await skipAutoCompletedDay({ sessionId: thu.id });
      expect(r.success).toBe(false);
      expect((await autoRows()).map((x) => x.id)).toContain(thu.id);
      const [row] = await db.select().from(plannedSessions).where(and(eq(plannedSessions.date, TODAY), isNull(plannedSessions.deletedAt)));
      expect(row.status).toBe("planned");
    } finally {
      await db.execute(sql`DROP TRIGGER c2_refuse ON dismissed_makeups`);
    }
  });

  it("8. a day declined before a cycle was made stays declined in it", async () => {
    await dismissMissedWorkout({ date: "2026-11-02" });
    const id = await weekdayCycle("2026-10-26");
    await active();
    expect((await rowOn(id, "2026-11-02")).status).toBe("skipped");
    // A cycle made later, with sessions that day, by the app's own generation.
    const [c2] = await db.insert(trainingCycles).values({ userId: me, name: "Second", durationWeeks: 4, status: "draft" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c2.id, dayOfWeek: 1, programId: other });
    const { activateCycle } = await import("@/lib/plan-revisions");
    await activateCycle({ userId: me, writer: "user" }, c2.id, undefined, "2026-10-26");
    expect((await rowOn(c2.id, "2026-11-02")).status).toBe("skipped");
  });

  it("9. a workout links to its planned session only on that session's day", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const monday = await rowOn(id, "2026-11-02");
    const s = await createWorkoutSession({ date: TODAY, programId: progA, plannedSessionId: monday.id });
    expect(s.success && s.data.plannedSessionId).toBeNull();
    const today = await rowOn(id, TODAY);
    const t = await createWorkoutSession({ date: TODAY, programId: progC, plannedSessionId: today.id });
    expect(t.success && t.data.plannedSessionId).toBe(today.id);
  });
});

describe("generation and data", () => {
  it("10, 16. a restore cannot put a session in the past or plan a past one again", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const next = await rowOn(id, "2026-11-09");
    // Move it, then the clock passes the old day: the first version is in the past.
    await updatePlannedSession({ op: "move", id: next.id, date: "2026-11-16" });
    at("2026-11-12T12:00:00Z");
    const revs = await db.select().from(planRevisions).where(eq(planRevisions.objectId, next.id)).orderBy(asc(planRevisions.id));
    const r = await restorePlanRevision({ revisionId: revs[0].id });
    expect(r).toMatchObject({ success: false });
    expect((await db.select().from(plannedSessions).where(eq(plannedSessions.id, next.id)))[0].date).toBe("2026-11-16");
    // A past skipped session.
    const wed = await rowOn(id, "2026-11-11");
    at("2026-11-05T12:00:00Z");
    await updatePlannedSession({ op: "skip", id: wed.id });
    at("2026-11-12T12:00:00Z");
    const wedRevs = await db.select().from(planRevisions).where(eq(planRevisions.objectId, wed.id)).orderBy(asc(planRevisions.id));
    expect(await restorePlanRevision({ revisionId: wedRevs[0].id })).toMatchObject({ success: false });
  });

  it("11. a restore refuses a done session, and one whose template day is taken again", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const thu = await rowOn(id, TODAY);
    await updatePlannedSession({ op: "move", id: thu.id, date: "2026-11-06" });
    // A workout of its program on its new day: done by the matcher, not by a link.
    await createSession(me, progC, { date: "2026-11-06", isCompleted: true });
    at("2026-11-06T12:00:00Z");
    const revs = await db.select().from(planRevisions).where(eq(planRevisions.objectId, thu.id)).orderBy(asc(planRevisions.id));
    expect(await restorePlanRevision({ revisionId: revs[0].id })).toMatchObject({ success: false });
    // Removed by hand-added... an added session removed, while the cycle lost its dates.
    at(`${TODAY}T12:00:00Z`);
    const added = await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-10", programId: other });
    if (!added.success) throw new Error(added.error);
    await updatePlannedSession({ op: "remove", id: added.data.id });
    await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.id, id));
    const addRevs = await db.select().from(planRevisions).where(eq(planRevisions.objectId, added.data.id)).orderBy(asc(planRevisions.id));
    expect(await restorePlanRevision({ revisionId: addRevs[0].id })).toMatchObject({ success: false });
  });

  it("12. a restarted rotation drops its old overrides", async () => {
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Rotation", durationWeeks: 4, status: "active", startDate: "2026-11-02", scheduleType: "rotation" })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: c.id, orderIndex: 1, programId: progA },
      { trainingCycleId: c.id, orderIndex: 2, programId: progB },
    ]);
    const call = mcpTools(registerPlannedSessionTools, me);
    expect((await call("manage_planned_session", { operation: "skip", cycleId: c.id, rotationPosition: 4, reason: "Away" })).isError).toBe(false);
    const { activateCycle } = await import("@/lib/plan-revisions");
    await activateCycle({ userId: me, writer: "user" }, c.id);
    const left = await db
      .select()
      .from(plannedSessions)
      .where(and(eq(plannedSessions.cycleId, c.id), isNull(plannedSessions.deletedAt)));
    expect(left).toEqual([]);
  });

  it("13. a session moved and then left out of a shorter block does not come back on its template day", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    // Thursday 12 Nov moved to Friday 20 Nov.
    const thu = await rowOn(id, "2026-11-12");
    await updatePlannedSession({ op: "move", id: thu.id, date: "2026-11-20" });
    // Three weeks: the block now ends on 15 Nov, so the moved session goes.
    const { planWrite } = await import("@/lib/plan-revisions");
    await planWrite({ userId: me, writer: "user" }, async (w) => {
      await w.touch({ type: "cycle", id });
      await w.tx.update(trainingCycles).set({ durationWeeks: 3 }).where(eq(trainingCycles.id, id));
    });
    const left = await rows(id);
    expect(left.some((r) => r.id === thu.id)).toBe(false);
    // It does not come back on 12 Nov: the user moved it away from that day.
    expect(left.filter((r) => r.date === "2026-11-12")).toEqual([]);
  });

  it("14. reset refuses when the slot moved to another weekday", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const next = await rowOn(id, "2026-11-09");
    await updatePlannedSession({ op: "move", id: next.id, date: "2026-11-10" });
    await db.update(trainingCycleSlots).set({ dayOfWeek: 2 }).where(eq(trainingCycleSlots.id, next.slotId!));
    expect(await updatePlannedSession({ op: "reset", id: next.id })).toMatchObject({ success: false });
  });

  it("15. regeneration keeps a day at three sessions; skipped ones and other cycles do not count", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    for (let i = 0; i < 2; i++) {
      expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-09", programId: other })).success).toBe(true);
    }
    // Monday now holds three; a second template session that day is not stacked on.
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, daySlot: 2, programId: progB });
    expect((await rows(id)).filter((r) => r.date === "2026-11-09")).toHaveLength(3);
    // A skipped session frees its place.
    const wed = await rowOn(id, "2026-11-11");
    await updatePlannedSession({ op: "skip", id: wed.id });
    expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-11", programId: other })).success).toBe(true);
    expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-11", programId: other })).success).toBe(true);
    expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-11", programId: other })).success).toBe(true);
  });

  it("17. purging a cycle takes its sessions' revisions with it", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const next = await rowOn(id, "2026-11-09");
    await updatePlannedSession({ op: "skip", id: next.id });
    await db.update(trainingCycles).set({ deletedAt: new Date("2026-07-01T00:00:00Z") }).where(eq(trainingCycles.id, id));
    await purgePlanRevisions(new Date(`${TODAY}T12:00:00Z`));
    expect(await db.select().from(planRevisions).where(eq(planRevisions.objectType, "planned_session"))).toEqual([]);
  });

  it("19. a session a workout was started for is never removed by the template", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const thu = await rowOn(id, TODAY);
    await createWorkoutSession({ date: TODAY, programId: progC, plannedSessionId: thu.id });
    await db.delete(trainingCycleSlots).where(eq(trainingCycleSlots.programId, progC));
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 5, programId: other });
    expect((await rows(id)).some((r) => r.id === thu.id)).toBe(true);
  });
});

const hard = async () => (await createProgram(me, [{ exerciseId: bike, sets: [{ durationSeconds: 300, sessionRole: "work", targetReps: null }] }])).program.id;

describe("MCP, limits and safety", () => {
  it("20. reset runs the hard-sessions limit", async () => {
    const h = await hard();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Hard", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values([1, 2, 3, 5].map((d) => ({ trainingCycleId: c.id, dayOfWeek: d, programId: h })));
    await active();
    // Move week 2's Friday out to week 3, then fill week 2 back to three.
    const fri = await rowOn(c.id, "2026-11-13");
    await updatePlannedSession({ op: "move", id: fri.id, date: "2026-11-17" });
    await updatePlannedSession({ op: "add", cycleId: c.id, date: "2026-11-14", programId: h });
    const v = (await db.select().from(plannedSessions).where(eq(plannedSessions.id, fri.id)))[0].version;
    const r = await mcpTools(registerPlannedSessionTools, me)("manage_planned_session", { operation: "reset", id: fri.id, reason: "Back", expectedVersion: v });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
  });

  it("21. a slot added to a week whose dated sessions already hold three hard ones is refused", async () => {
    const h = await hard();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Hard", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values([1, 3].map((d) => ({ trainingCycleId: c.id, dayOfWeek: d, programId: h })));
    await active();
    // A third hard session this week, added by hand: the template still says two.
    await updatePlannedSession({ op: "add", cycleId: c.id, date: "2026-11-06", programId: h });
    const r = await mcpTools(registerCycleTools, me)("edit_cycle_slot", {
      operation: "upsert",
      trainingCycleId: c.id,
      dayOfWeek: 7,
      programId: h,
      reason: "Add intervals",
      expectedVersion: (await db.select().from(trainingCycles).where(eq(trainingCycles.id, c.id)))[0].version,
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
  });

  it("22. rotation overrides: no past day, a version once stored, and only positions in the block", async () => {
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Rotation", durationWeeks: 1, status: "active", startDate: "2026-11-02", scheduleType: "rotation" })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: c.id, orderIndex: 1, programId: progA },
      { trainingCycleId: c.id, orderIndex: 2, programId: progB },
    ]);
    // Nothing logged: position 0 waits until today, then 1, 2, 3 follow.
    await db.insert(workoutSessions).values({ userId: me, programId: progA, date: "2026-11-02", isCompleted: true });
    const call = mcpTools(registerPlannedSessionTools, me);
    expect((await call("manage_planned_session", { operation: "skip", cycleId: c.id, rotationPosition: 0, reason: "x" })).isError).toBe(true);
    expect((await call("manage_planned_session", { operation: "skip", cycleId: c.id, rotationPosition: 40, reason: "x" })).isError).toBe(true);
    expect((await call("manage_planned_session", { operation: "skip", cycleId: c.id, rotationPosition: 2, reason: "x" })).isError).toBe(false);
    const again = await call("manage_planned_session", { operation: "change", cycleId: c.id, rotationPosition: 2, programId: other, reason: "x" });
    expect(again.isError).toBe(true);
    expect(again.raw).toContain("expectedVersion");
  });

  it("23. log_session refuses a planned session of another day", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const monday = await rowOn(id, "2026-11-02");
    const res = await mcpTools(registerSessionTools, me)("log_session", {
      date: "2026-11-03",
      plannedSessionId: monday.id,
      sets: [{ exerciseId: bike, setNumber: 1, durationSeconds: 600 }],
    });
    expect(res.isError).toBe(true);
    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.source, "assistant"))).toEqual([]);
  });

  it("24. restore_revision of a session warns when the restored week breaks a limit", async () => {
    const h = await hard();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Hard", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values([1, 2, 3, 5].map((d) => ({ trainingCycleId: c.id, dayOfWeek: d, programId: h })));
    await active();
    const fri = await rowOn(c.id, "2026-11-13");
    await updatePlannedSession({ op: "move", id: fri.id, date: "2026-11-17" });
    const [first] = await db.select().from(planRevisions).where(eq(planRevisions.objectId, fri.id)).orderBy(asc(planRevisions.id));
    const r = await mcpTools(registerRevisionTools, me)("restore_revision", { revisionId: first.id, reason: "Undo" });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.limits.warnings).toEqual([expect.objectContaining({ rule: "hard_sessions_per_week" })]);
  });

  it("25. confirm_session by id works for an added session and on a day with the program twice", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    const added = await updatePlannedSession({ op: "add", cycleId: id, date: TODAY, programId: progC });
    if (!added.success) throw new Error(added.error);
    const extra = await updatePlannedSession({ op: "add", cycleId: id, date: TODAY, programId: other });
    if (!extra.success) throw new Error(extra.error);
    await createSession(me, progC, { date: TODAY, isCompleted: true, plannedSessionId: (await rowOn(id, TODAY)).id });
    const tools = mcpTools(registerSessionTools, me);
    const second = await tools("confirm_session", { plannedSessionId: added.data.id });
    expect(second.isError, second.raw).toBe(false);
    expect(second.data).toMatchObject({ already: false });
    const outside = await tools("confirm_session", { plannedSessionId: extra.data.id });
    expect(outside.isError, outside.raw).toBe(false);
  });

  it("25. change refuses a taken position and a past session", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-09", programId: other });
    const monday = await rowOn(id, "2026-11-09");
    expect(await updatePlannedSession({ op: "change", id: monday.id, position: 2 })).toMatchObject({ success: false });
    const past = await rowOn(id, "2026-11-02");
    expect(await updatePlannedSession({ op: "change", id: past.id, programId: other })).toMatchObject({ success: false });
  });

  it("25. upsertCycleSlot does not send an internal error to the client", async () => {
    const id = await weekdayCycle("2026-10-26");
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("connection string secret"));
    const r = await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 2, programId: other });
    spy.mockRestore();
    expect(r).toEqual({ success: false, error: "Failed to save the slot" });
  });

  it("25. get_training_cycle counts changed future sessions; edit_cycle_slot says how many were rewritten", async () => {
    const id = await weekdayCycle("2026-10-26");
    await active();
    await updatePlannedSession({ op: "skip", id: (await rowOn(id, "2026-11-09")).id });
    const tools = mcpTools(registerCycleTools, me);
    const got = await tools("get_training_cycle", { cycleId: id });
    expect(got.data.touchedFutureSessions).toBe(1);
    const edited = await tools("edit_cycle_slot", { operation: "upsert", trainingCycleId: id, dayOfWeek: 3, programId: other, reason: "Swap", expectedVersion: got.data.version });
    expect(edited.isError, edited.raw).toBe(false);
    // Wednesdays 11, 18 Nov and this week's missed 4 Nov follow the template.
    expect(edited.data.sessionsRegenerated).toBe(3);
  });
});
