import { db } from "@/db";
import { planRevisions, plannedSessions, trainingCycleSlots, trainingCycles, workoutSessions } from "@/db/schema";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { scheduleCycle } from "@/lib/plan-revisions";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * The dated session tools over MCP (docs/plans/sessions.md, 6): list, move
 * with a version, the limits on a move into a full week, rotation overrides,
 * and confirm_session and log_session by planned session. The clock is fixed
 * at Thu 2026-11-05 12:00 UTC; the user's zone is UTC.
 */

let me: string;
let other: string;
let easy: number;
let bike: number;
const TODAY = "2026-11-05";

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  other = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
  const lift = await createExercise();
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  easy = (await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

const hard = async () => (await createProgram(me, [{ exerciseId: bike, sets: [{ durationSeconds: 300, sessionRole: "work", targetReps: null }] }])).program.id;

async function weekdayCycle(slots: { day: number; programId: number; daySlot?: number }[]) {
  const [c] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" })
    .returning();
  await db.insert(trainingCycleSlots).values(slots.map((s) => ({ trainingCycleId: c.id, dayOfWeek: s.day, programId: s.programId, daySlot: s.daySlot ?? 1 })));
  return c.id;
}

const call = (userId = me) => mcpTools(registerPlannedSessionTools, userId);

describe("list_planned_sessions and manage_planned_session", () => {
  it("lists the range and moves a session with its version", async () => {
    await weekdayCycle([{ day: 1, programId: easy }, { day: 4, programId: easy }]);
    const list = await call()("list_planned_sessions", { from: "2026-11-02", to: "2026-11-12" });
    expect(list.data.sessions.map((s: { date: string; status: string }) => [s.date, s.status])).toEqual([
      ["2026-11-02", "missed"],
      [TODAY, "planned"],
      ["2026-11-09", "planned"],
      ["2026-11-12", "planned"],
    ]);
    const next = list.data.sessions[2];
    const moved = await call()("manage_planned_session", { operation: "move", id: next.id, date: "2026-11-10", reason: "Travel on Monday", expectedVersion: next.version });
    expect(moved.isError, moved.raw).toBe(false);
    expect(moved.data.session.date).toBe("2026-11-10");
    expect(moved.data.version).toBe(2);
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "planned_session"), eq(planRevisions.action, "update")));
    expect(rev).toMatchObject({ writer: "assistant", reason: "Travel on Monday" });

    const stale = await call()("manage_planned_session", { operation: "skip", id: next.id, reason: "Again", expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.raw).toContain("Conflict");
  });

  it("does not reach another user's sessions", async () => {
    await weekdayCycle([{ day: 4, programId: easy }]);
    const mine = (await call()("list_planned_sessions", { from: TODAY, to: TODAY })).data.sessions[0];
    expect((await call(other)("list_planned_sessions", { from: TODAY, to: TODAY })).data.sessions).toEqual([]);
    const refused = await call(other)("manage_planned_session", { operation: "skip", id: mine.id, reason: "x", expectedVersion: 1 });
    expect(refused).toMatchObject({ isError: true, raw: "Error: Planned session not found" });
    const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, mine.id));
    expect(row.status).toBe("planned");
  });

  it("refuses a move that puts a fourth hard session in a week, and applies it with an override", async () => {
    // Week 2 (9-15 Nov): hard on Mon, Tue, Wed. Week 3 holds the Friday one.
    const h = await hard();
    await weekdayCycle([{ day: 1, programId: h }, { day: 2, programId: h }, { day: 3, programId: h }, { day: 5, programId: h }]);
    const list = (await call()("list_planned_sessions", { from: "2026-11-16", to: "2026-11-22" })).data.sessions;
    const friday = list.find((s: { date: string }) => s.date === "2026-11-20");
    const args = { operation: "move", id: friday.id, date: "2026-11-15", reason: "Move it forward", expectedVersion: friday.version };
    // Week 2 already has 4 (Mon, Tue, Wed, Fri): moving another in makes 5.
    const refused = await call()("manage_planned_session", args);
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.raw).brokenLimits[0]).toMatchObject({ rule: "hard_sessions_per_week", numbers: { hardSessions: 5, limit: 3 } });
    const [still] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, friday.id));
    expect(still.date).toBe("2026-11-20");
    const applied = await call()("manage_planned_session", { ...args, overrideLimits: ["hard_sessions_per_week"], overrideReason: "Race simulation the athlete asked for." });
    expect(applied.isError, applied.raw).toBe(false);
    expect(applied.data.limits.overridden).toEqual([expect.objectContaining({ rule: "hard_sessions_per_week" })]);
  });

  it("skips and changes a rotation session by its position", async () => {
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Rotation", durationWeeks: 4, status: "active", startDate: "2026-11-02", scheduleType: "rotation" })
      .returning();
    const second = (await createProgram(me, [{ exerciseId: bike, sets: [{}] }])).program.id;
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: c.id, orderIndex: 1, programId: easy },
      { trainingCycleId: c.id, orderIndex: 2, programId: second },
    ]);
    const list = (await call()("list_planned_sessions", { from: TODAY, to: "2026-11-07" })).data.sessions;
    // Nothing logged: position 0 waits; today is still position 0.
    expect(list[0]).toMatchObject({ date: TODAY, rotationPosition: 0, programId: easy, id: null });
    const skip = await call()("manage_planned_session", { operation: "skip", cycleId: c.id, rotationPosition: 0, reason: "Sick" });
    expect(skip.isError, skip.raw).toBe(false);
    const r = await getActiveCycleForUser();
    // Skipped today: the walk takes 2 Nov as used, so 3 Nov is position 1.
    expect(r.success && r.data?.todaySlot?.programId).toBe(second);
  });
});

describe("confirm_session and log_session by planned session", () => {
  it("confirms a planned session by id, linked to it", async () => {
    await weekdayCycle([{ day: 1, programId: easy }]);
    const monday = (await call()("list_planned_sessions", { from: "2026-11-02", to: "2026-11-02" })).data.sessions[0];
    const res = await mcpTools(registerSessionTools, me)("confirm_session", { plannedSessionId: monday.id });
    expect(res.isError, res.raw).toBe(false);
    const [auto] = await db.select().from(workoutSessions).where(eq(workoutSessions.source, "auto"));
    expect(auto).toMatchObject({ date: "2026-11-02", programId: easy, plannedSessionId: monday.id });
    const after = (await call()("list_planned_sessions", { from: "2026-11-02", to: "2026-11-02" })).data.sessions[0];
    expect(after.status).toBe("done");
  });

  it("logs a session for a planned one and links it", async () => {
    await weekdayCycle([{ day: 1, programId: easy }]);
    const monday = (await call()("list_planned_sessions", { from: "2026-11-02", to: "2026-11-02" })).data.sessions[0];
    const exerciseId = (await createExercise()).id;
    const res = await mcpTools(registerSessionTools, me)("log_session", {
      date: "2026-11-02",
      plannedSessionId: monday.id,
      sets: [{ exerciseId, setNumber: 1, reps: 5, weightKg: 60 }],
    });
    expect(res.isError, res.raw).toBe(false);
    const [logged] = await db.select().from(workoutSessions).where(eq(workoutSessions.source, "assistant"));
    expect(logged).toMatchObject({ programId: easy, plannedSessionId: monday.id });
  });
});

describe("a scheduled draft", () => {
  it("gets its sessions from the scheduled day, and loses them when unscheduled", async () => {
    const [draft] = await db.insert(trainingCycles).values({ userId: me, name: "Next", durationWeeks: 1, status: "draft" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: draft.id, dayOfWeek: 2, programId: easy });
    await scheduleCycle({ userId: me, writer: "user" }, draft.id, "2026-11-09");
    const rows = () =>
      db
        .select({ date: plannedSessions.date })
        .from(plannedSessions)
        .where(and(eq(plannedSessions.cycleId, draft.id), isNull(plannedSessions.deletedAt)))
        .orderBy(asc(plannedSessions.date));
    expect(await rows()).toEqual([{ date: "2026-11-10" }]);
    await scheduleCycle({ userId: me, writer: "user" }, draft.id, null);
    expect(await rows()).toEqual([]);
  });
});
