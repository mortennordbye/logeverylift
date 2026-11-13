import { db } from "@/db";
import { plannedSessions, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { getActiveCycleForUser, removeCycleSlot, upsertCycleSlot } from "@/lib/actions/training-cycles";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { planWrite } from "@/lib/plan-revisions";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * The third review round of C2 (docs/plans/sessions.md, section 20), each a
 * case that failed before its fix. The clock is fixed at Thu 2026-11-05
 * 12:00 UTC; the user's zone is UTC.
 */

let me: string;
let progA: number; // Monday
let progB: number;
let progC: number; // Thursday
let other: number;
let bike: number;
const TODAY = "2026-11-05";

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

/** An active weekday cycle from Mon 26 Oct, 4 weeks: Mon A, Wed B, Thu C. */
async function weekdayCycle() {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-10-26" })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: 1, programId: progA },
    { trainingCycleId: cycle.id, dayOfWeek: 3, programId: progB },
    { trainingCycleId: cycle.id, dayOfWeek: 4, programId: progC },
  ]);
  return cycle.id;
}

const rows = (cycleId: number) =>
  db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt)))
    .orderBy(asc(plannedSessions.date), asc(plannedSessions.position), asc(plannedSessions.id));

const read = async () => {
  const r = await getActiveCycleForUser();
  if (!r.success) throw new Error(r.error);
};

const version = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0].version;

describe("review round 3", () => {
  it("1. a slot change is refused when a later dated week would get a fourth hard session", async () => {
    const h = (await createProgram(me, [{ exerciseId: bike, sets: [{ durationSeconds: 300, sessionRole: "work", targetReps: null }] }])).program.id;
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Hard", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values([1, 3].map((d) => ({ trainingCycleId: c.id, dayOfWeek: d, programId: h })));
    await read();
    // The week of 16 Nov gets a third hard session by hand; this week stays at two.
    expect((await updatePlannedSession({ op: "add", cycleId: c.id, date: "2026-11-20", programId: h })).success).toBe(true);
    const r = await mcpTools(registerCycleTools, me)("edit_cycle_slot", {
      operation: "upsert",
      trainingCycleId: c.id,
      dayOfWeek: 7,
      programId: h,
      reason: "Add intervals",
      expectedVersion: await version(c.id),
    });
    expect(r.isError).toBe(true);
    const broken = JSON.parse(r.raw).brokenLimits[0];
    expect(broken.rule).toBe("hard_sessions_per_week");
    expect(broken.message).toContain("The week of 2026-11-16");
    const sunday = await db.select().from(trainingCycleSlots).where(and(eq(trainingCycleSlots.trainingCycleId, c.id), eq(trainingCycleSlots.dayOfWeek, 7)));
    expect(sunday).toEqual([]);
  });

  it("2. add on a cycle not yet backfilled counts its template sessions", async () => {
    const id = await weekdayCycle(); // never read: no dated sessions yet
    expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-12", programId: other })).success).toBe(true);
    expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-12", programId: other })).success).toBe(true);
    // Thursday already holds the template's session: a third add would make four.
    expect(await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-12", programId: other })).toEqual({
      success: false,
      error: "A day holds at most 3 sessions.",
    });
    await read();
    expect((await rows(id)).filter((r) => r.date === "2026-11-12")).toHaveLength(3);
  });

  it("3. a session moved out of the block stays away from its template day after a later edit", async () => {
    const id = await weekdayCycle();
    await read();
    const thu = (await rows(id)).find((r) => r.date === "2026-11-12")!;
    expect((await updatePlannedSession({ op: "move", id: thu.id, date: "2026-11-20" })).success).toBe(true);
    // Three weeks: the block ends on 15 Nov, so the moved session goes (first run).
    await planWrite({ userId: me, writer: "user" }, async (w) => {
      await w.touch({ type: "cycle", id });
      await w.tx.update(trainingCycles).set({ durationWeeks: 3 }).where(eq(trainingCycles.id, id));
    });
    // A second template edit, in a later write (second run).
    expect((await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, programId: other })).success).toBe(true);
    expect((await rows(id)).filter((r) => r.date === "2026-11-12")).toEqual([]);
  });

  it("nit. removeCycleSlot does not send an internal error to the client", async () => {
    const id = await weekdayCycle();
    const [slot] = await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, id));
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("connection string secret"));
    const r = await removeCycleSlot(slot.id, id);
    spy.mockRestore();
    expect(r).toEqual({ success: false, error: "Failed to remove the slot" });
  });

  it("nit. a template session the cap of three keeps out is reported", async () => {
    const id = await weekdayCycle();
    await read();
    for (let i = 0; i < 2; i++) {
      expect((await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-09", programId: other })).success).toBe(true);
    }
    const r = await mcpTools(registerCycleTools, me)("edit_cycle_slot", {
      operation: "upsert",
      trainingCycleId: id,
      dayOfWeek: 1,
      daySlot: 2,
      programId: progB,
      reason: "Second Monday session",
      expectedVersion: await version(id),
    });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.sessionsKeptOutByCap).toEqual(["2026-11-09"]);
  });
});
