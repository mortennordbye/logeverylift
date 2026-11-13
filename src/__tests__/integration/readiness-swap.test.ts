import { db } from "@/db";
import { garminConnections, garminDailyMetrics, planRevisions, plannedSessions, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { makeSessionEasy } from "@/lib/actions/readiness";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { readinessSwapFor } from "@/lib/readiness-swap";
import { buildDailyMetrics } from "@/lib/garmin/analytics/daily";
import { addDays } from "@/lib/garmin/dates";
import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * The readiness swap (D4) and the app-facing parts of D2/D3
 * (docs/plans/limits-strength-readiness.md, 4-6): the suggestion from Garmin
 * readings, the Server Action and the MCP operation that apply it, the
 * heavy-legs marks and the sync warnings over MCP. The clock is fixed at
 * Thu 2026-11-05 12:00 UTC; users are in UTC.
 */

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TODAY = "2026-11-05";
const MIN = 60;
let me: string;
let bike: number;
let run: number;
let squat: number;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
  await db.insert(garminConnections).values({ userId: me, encryptedKey: "x", lastSyncedAt: new Date() });
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  squat = (await createExercise({ name: `Squat ${Math.random()}`, bodyArea: "lower_body", movementPattern: "squat", equipment: "barbell" })).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  asUser(me);
});

afterEach(() => vi.useRealTimers());

async function readings(userId: string, flagged: boolean) {
  const metrics = (state: string, flag: boolean) => ({ hrv: { ms: 40, state, mean7: 48, bandLow: 52, bandHigh: 68 }, restingHr: { flag, mean7: 56, baseline: 50 } });
  await db.insert(garminDailyMetrics).values([
    { userId, day: "2026-11-04", modelVersion: 1, metrics: metrics("fatigued", flagged) },
    { userId, day: TODAY, modelVersion: 1, metrics: metrics(flagged ? "fatigued" : "balanced", flagged) },
  ]);
}

/** A weekday cycle with a hard bike session on Thursday (today), 50 minutes. */
async function hardToday(userId = me) {
  const { program } = await createProgram(userId, [
    { exerciseId: bike, sets: [{ durationSeconds: 40 * MIN, targetReps: null }, { durationSeconds: 10 * MIN, sessionRole: "work", targetReps: null }] },
  ]);
  program.name = "Threshold ride";
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
  await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 4, programId: program.id, label: "Threshold ride" });
  const list = await mcpTools(registerPlannedSessionTools, userId)("list_planned_sessions", { from: TODAY, to: TODAY });
  return { cycleId: c.id, programId: program.id, session: list.data.sessions[0] };
}

const sessionRow = async (id: number) => (await db.select().from(plannedSessions).where(eq(plannedSessions.id, id)))[0];

describe("the suggestion", () => {
  it("suggests an easy version of today's hard session on a low-readiness morning, and shows it over MCP", async () => {
    await readings(me, true);
    const { session } = await hardToday();
    const swap = await readinessSwapFor(me);
    expect(swap).toMatchObject({ sessionId: session.id, minutes: 50 });
    expect(swap!.text).toBe(
      'Low readiness today: HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50. Make "Threshold ride" an easy 50 min zone 2 session?',
    );
    const list = await mcpTools(registerPlannedSessionTools, me)("list_planned_sessions", { from: TODAY, to: TODAY });
    expect(list.data.sessions[0].readinessSwap).toMatchObject({ minutes: 50, becomes: { sport: "bike" } });
  });

  it("reads a flag from a real daily series, and get_garmin_status shows the same suggestion", async () => {
    // 60 nights: HRV steady near 60 ms and resting HR near 50, then six nights
    // of HRV 35 ms and resting HR 58: below the band two days and resting HR up.
    const days = Array.from({ length: 60 }, (_, i) => {
      const date = addDays(TODAY, i - 59);
      const late = i >= 54;
      return { date, hrvMs: late ? 35 : i % 2 ? 58 : 62, garminHrvLow: null, garminHrvHigh: null, restingHr: late ? 58 : i % 2 ? 50 : 51, sleep: null };
    });
    const series = buildDailyMetrics({ start: days[0].date, end: TODAY, activities: [], strengthSessions: [], days });
    await db.insert(garminDailyMetrics).values(series.map((m) => ({ userId: me, day: m.date, modelVersion: 1, metrics: m })));
    const { session } = await hardToday();
    const status = await mcpTools(registerGarminTools, me)("get_garmin_status");
    expect(status.isError, status.raw).toBe(false);
    expect(status.data.readinessSwap).toMatchObject({ plannedSessionId: session.id, minutes: 50, session: "Threshold ride" });
    expect(status.data.readinessSwap.text).toMatch(/^Low readiness today: HRV 7-day mean \d+ ms is below your band/);
  });

  it("suggests nothing on a normal morning, without Garmin, or with the switch off", async () => {
    await readings(me, false);
    await hardToday();
    expect(await readinessSwapFor(me)).toBeNull();

    const plain = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    await readings(plain, true);
    await hardToday(plain);
    expect(await readinessSwapFor(plain)).toBeNull();

    const lifter = (await createUser({ timeZone: "UTC", role: "admin" })).id;
    await db.insert(garminConnections).values({ userId: lifter, encryptedKey: "x", lastSyncedAt: new Date() });
    await readings(lifter, true);
    expect(await readinessSwapFor(lifter)).toBeNull();
  });
});

describe("makeSessionEasy (Server Action)", () => {
  it("makes today's hard session easy as writer apply, with a revision; the suggestion is then gone", async () => {
    await readings(me, true);
    const { session } = await hardToday();
    const r = await makeSessionEasy({ plannedSessionId: session.id });
    expect(r).toEqual({ success: true, data: { id: session.id } });
    const row = await sessionRow(session.id);
    expect(row.programId).toBeNull();
    expect(row.workout).toMatchObject({ sport: "bike", name: "Easy bike (readiness)", steps: [{ end: { type: "time", seconds: 50 * MIN } }] });
    const [rev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "planned_session"), eq(planRevisions.objectId, session.id)))
      .orderBy(desc(planRevisions.id))
      .limit(1);
    expect(rev.writer).toBe("apply");
    expect(rev.reason).toContain("Readiness: HRV 7-day mean 48 ms");
    expect(rev.limitCheck).toMatchObject({ warnings: [] });
    expect(await readinessSwapFor(me)).toBeNull();
  });

  it("refuses when the suggestion no longer holds, and another user's session", async () => {
    await readings(me, false);
    const { session } = await hardToday();
    const stale = await makeSessionEasy({ plannedSessionId: session.id });
    expect(stale).toEqual({ success: false, error: "Readiness changed: there is no swap to make for this session now." });
    expect((await sessionRow(session.id)).programId).not.toBeNull();

    const other = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
    await db.insert(garminConnections).values({ userId: other, encryptedKey: "x", lastSyncedAt: new Date() });
    await readings(other, true);
    const theirs = await hardToday(other);
    const refused = await makeSessionEasy({ plannedSessionId: theirs.session.id });
    expect(refused.success).toBe(false);
    expect((await sessionRow(theirs.session.id)).programId).not.toBeNull();
    expect((await makeSessionEasy({ plannedSessionId: "x" })).success).toBe(false);
  });
});

describe("apply_readiness_swap over MCP", () => {
  it("applies the suggestion as the assistant, and refuses a stale one", async () => {
    await readings(me, true);
    const { session } = await hardToday();
    const call = mcpTools(registerPlannedSessionTools, me);
    const r = await call("manage_planned_session", { operation: "apply_readiness_swap", id: session.id, expectedVersion: session.version, reason: "Athlete agreed to go easy" });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.limits.checked).toContain("hard_after_low_readiness");
    expect((await sessionRow(session.id)).workout).toMatchObject({ name: "Easy bike (readiness)" });
    const again = await call("manage_planned_session", { operation: "apply_readiness_swap", id: session.id, expectedVersion: r.data.version, reason: "Again" });
    expect(again).toMatchObject({ isError: true, raw: "Error: Readiness changed: there is no swap to make for this session now." });
  });
});

describe("heavy legs over MCP (D3)", () => {
  it("marks a leg day the day before a key run, and the key run", async () => {
    const legs = (await createProgram(me, [{ exerciseId: squat, sets: [{ targetReps: 5 }, { targetReps: 5 }, { targetReps: 5 }] }])).program.id;
    const longRun = (await createProgram(me, [{ exerciseId: run, sets: [{ durationSeconds: 100 * MIN, targetReps: null }] }])).program.id;
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: c.id, dayOfWeek: 5, programId: legs, label: "Leg day" },
      { trainingCycleId: c.id, dayOfWeek: 6, programId: longRun, label: "Long run" },
    ]);
    const list = await mcpTools(registerPlannedSessionTools, me)("list_planned_sessions", { from: "2026-11-06", to: "2026-11-07" });
    const [lift, key] = list.data.sessions;
    expect(lift.heavyLegsBeforeKey).toEqual([{ keySessionId: key.id, key: "Long run", keyDate: "2026-11-07", daysBefore: 1 }]);
    expect(key.heavyLegsBeforeKeyOf).toEqual([{ liftSessionId: lift.id, lift: "Leg day", liftDate: "2026-11-06", daysBefore: 1 }]);
  });
});

describe("sync warnings in get_training_cycle (T4)", () => {
  it("returns limitWarnings from this week's sync", async () => {
    const { program } = await createProgram(me, [{ exerciseId: run, sets: [{ durationSeconds: 30 * MIN, peakDurationSeconds: 120 * MIN, targetReps: null }] }]);
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: "2026-11-02", goal: "maintain" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 7, programId: program.id });
    await syncPeriodizedTargets(c.id, me, [{ programId: program.id }], 1, 8, "maintain", null);
    const got = await mcpTools(registerCycleTools, me)("get_training_cycle", { cycleId: c.id });
    expect(got.isError, got.raw).toBe(false);
    expect(got.data.limitWarnings).toEqual([expect.objectContaining({ rule: "long_run_cap" })]);
  });
});
