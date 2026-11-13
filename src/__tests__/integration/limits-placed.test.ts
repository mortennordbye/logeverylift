import { db } from "@/db";
import {
  athleteProfiles,
  garminActivities,
  garminConnections,
  garminDailyMetrics,
  planRevisions,
  programSets,
  programs,
  seasons,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { upsertCycleSlot } from "@/lib/actions/training-cycles";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerSeasonTools } from "@/lib/mcp/tools/seasons";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { startDueScheduledCycle } from "@/lib/plan-revisions";
import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * Training limits part 2 (docs/plans/limits-strength-readiness.md): the
 * placed-session rules on assistant writes (heavy legs before a key session,
 * strength per week by phase, no hard session after a low-readiness day), the
 * long-run cap from runs logged in the app, and the warnings (T4) on the
 * app's own writes, a change-set undo and a season resume. The clock is fixed
 * at Thu 2026-11-05 12:00 UTC; users are in UTC.
 */

// Garmin is on only with the key set (src/lib/garmin/access.ts).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TODAY = "2026-11-05";
const MIN = 60;
let me: string;
let run: number;
let bike: number;
let squat: number;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  squat = (await createExercise({ name: `Squat ${Math.random()}`, bodyArea: "lower_body", movementPattern: "squat", equipment: "barbell" })).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

const legDay = async (userId = me) => (await createProgram(userId, [{ exerciseId: squat, sets: [{ targetReps: 5 }, { targetReps: 5 }, { targetReps: 5 }, { targetReps: 5 }] }])).program.id;
const longRun = async (userId = me, minutes = 100) =>
  (await createProgram(userId, [{ exerciseId: run, sets: [{ durationSeconds: minutes * MIN, targetReps: null }] }])).program.id;
const hardBike = async (userId = me) => (await createProgram(userId, [{ exerciseId: bike, sets: [{ durationSeconds: 300, sessionRole: "work", targetReps: null }] }])).program.id;

async function cycle(userId: string, slots: { day: number; programId: number }[], values: Partial<typeof trainingCycles.$inferInsert> = {}) {
  const [c] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02", ...values })
    .returning();
  if (slots.length) await db.insert(trainingCycleSlots).values(slots.map((s) => ({ trainingCycleId: c.id, dayOfWeek: s.day, programId: s.programId })));
  return c.id;
}

const slot = (cycleId: number, dayOfWeek: number, programId: number, extra: Record<string, unknown> = {}) =>
  mcpTools(registerCycleTools, me)("edit_cycle_slot", { operation: "upsert", trainingCycleId: cycleId, dayOfWeek, programId, reason: "Plan the week", expectedVersion: 1, ...extra });

const slotsOf = async (cycleId: number) => db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, cycleId));
const lastRevision = async (type: "cycle" | "program" | "planned_session", id: number) =>
  (await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, type), eq(planRevisions.objectId, id))).orderBy(desc(planRevisions.id)).limit(1))[0];

describe("heavy_legs_before_key", () => {
  it("refuses heavy legs the day before a key run, changes nothing, then applies with an override", async () => {
    const cycleId = await cycle(me, [{ day: 2, programId: await longRun() }]);
    const legs = await legDay();

    const refused = await slot(cycleId, 1, legs);
    expect(refused.isError).toBe(true);
    const body = JSON.parse(refused.raw);
    expect(body.brokenLimits).toHaveLength(1);
    expect(body.brokenLimits[0]).toMatchObject({ rule: "heavy_legs_before_key", numbers: { conflicts: [{ heavyLegSets: 4, daysBefore: 1 }] } });
    expect(body.brokenLimits[0].message).toContain("(4 heavy leg sets) is 1 day before the key session");
    expect(await slotsOf(cycleId)).toHaveLength(1);

    const applied = await slot(cycleId, 1, legs, { overrideLimits: ["heavy_legs_before_key"], overrideReason: "Only a light squat day this week, the athlete asked." });
    expect(applied.isError, applied.raw).toBe(false);
    expect(await slotsOf(cycleId)).toHaveLength(2);
    expect((await lastRevision("cycle", cycleId)).limitCheck).toMatchObject({
      overridden: [expect.objectContaining({ rule: "heavy_legs_before_key" })],
      overrideReason: "Only a light squat day this week, the athlete asked.",
    });
  });

  it("passes heavy legs three days before, or after the key run", async () => {
    const cycleId = await cycle(me, [{ day: 4, programId: await longRun() }]);
    const ok1 = await slot(cycleId, 1, await legDay());
    expect(ok1.isError, ok1.raw).toBe(false);
    expect(ok1.data.limits.passed).toContain("heavy_legs_before_key");
    const ok2 = await slot(cycleId, 5, await legDay(), { expectedVersion: 2 });
    expect(ok2.isError, ok2.raw).toBe(false);
  });

  it("does not check the user's own slot change (D4)", async () => {
    const cycleId = await cycle(me, [{ day: 2, programId: await longRun() }]);
    asUser(me);
    const r = await upsertCycleSlot({ trainingCycleId: cycleId, dayOfWeek: 1, programId: await legDay() });
    expect(r.success).toBe(true);
    expect(await slotsOf(cycleId)).toHaveLength(2);
  });

  it("checks nothing for a lifter", async () => {
    const lifter = (await createUser({ timeZone: "UTC" })).id;
    const cycleId = await cycle(lifter, [{ day: 2, programId: await longRun(lifter) }]);
    const r = await mcpTools(registerCycleTools, lifter)("edit_cycle_slot", { operation: "upsert", trainingCycleId: cycleId, dayOfWeek: 1, programId: await legDay(lifter), reason: "Legs", expectedVersion: 1 });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.limits.checked).toEqual([]);
  });
});

describe("strength_per_week (D21)", () => {
  it("refuses a second strength day in build for 'stronger', and applies with a reason", async () => {
    await db.insert(athleteProfiles).values({ userId: me, strengthGoal: "stronger" });
    const cycleId = await cycle(me, [{ day: 1, programId: await legDay() }], { phaseType: "build", name: "Build 1" });
    const refused = await slot(cycleId, 4, await legDay());
    expect(refused.isError).toBe(true);
    const body = JSON.parse(refused.raw);
    expect(body.brokenLimits.map((b: { rule: string }) => b.rule)).toEqual(["strength_per_week"]);
    expect(body.brokenLimits[0].message).toContain('Build phase "Build 1" would hold 2 strength sessions a week (Mon, Thu). The default for "Get stronger" in build is 1.');

    const applied = await slot(cycleId, 4, await legDay(), { overrideLimits: ["strength_per_week"], overrideReason: "Keeps 2 a week to hold muscle mass, as agreed." });
    expect(applied.isError, applied.raw).toBe(false);
  });

  it("says why it did not check with no strength goal, or no phase type", async () => {
    const cycleId = await cycle(me, [{ day: 1, programId: await legDay() }], { phaseType: "build" });
    const noGoal = await slot(cycleId, 4, await legDay());
    expect(noGoal.isError, noGoal.raw).toBe(false);
    expect(noGoal.data.limits.notChecked).toContainEqual(expect.objectContaining({ rule: "strength_per_week", why: expect.stringContaining("no strength goal") }));

    await db.insert(athleteProfiles).values({ userId: me, strengthGoal: "stronger" });
    const plain = await cycle(me, [{ day: 1, programId: await legDay() }]);
    const noPhase = await slot(plain, 4, await legDay());
    expect(noPhase.isError, noPhase.raw).toBe(false);
    expect(noPhase.data.limits.notChecked).toContainEqual(expect.objectContaining({ rule: "strength_per_week", why: expect.stringContaining("no phase type") }));
  });
});

describe("hard_after_low_readiness", () => {
  async function garminUser(flagged: boolean) {
    const id = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
    await db.insert(garminConnections).values({ userId: id, encryptedKey: "x", lastSyncedAt: new Date() });
    const metrics = (state: string, flag: boolean) => ({ hrv: { ms: 40, state, mean7: 48, bandLow: 52, bandHigh: 68 }, restingHr: { flag, mean7: 56, baseline: 50 } });
    await db.insert(garminDailyMetrics).values([
      { userId: id, day: "2026-11-04", modelVersion: 1, metrics: metrics("fatigued", flagged) },
      { userId: id, day: TODAY, modelVersion: 1, metrics: metrics(flagged ? "fatigued" : "balanced", flagged) },
    ]);
    return id;
  }

  it("refuses a hard session added today on a low-readiness day, with the readings", async () => {
    const id = await garminUser(true);
    const cycleId = await cycle(id, [{ day: 1, programId: await longRun(id, 40) }]);
    const sessions = mcpTools(registerPlannedSessionTools, id);
    await sessions("list_planned_sessions", { from: "2026-11-02", to: "2026-11-08" });
    const add = { operation: "add", cycleId, date: TODAY, programId: await hardBike(id), reason: "Intervals today" };
    const refused = await sessions("manage_planned_session", add);
    expect(refused.isError).toBe(true);
    const body = JSON.parse(refused.raw);
    expect(body.brokenLimits.map((b: { rule: string }) => b.rule)).toEqual(["hard_after_low_readiness"]);
    expect(body.brokenLimits[0].message).toContain("Today (2026-11-05) is a low-readiness day: HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50.");

    const applied = await sessions("manage_planned_session", { ...add, overrideLimits: ["hard_after_low_readiness"], overrideReason: "The athlete feels fresh and slept well." });
    expect(applied.isError, applied.raw).toBe(false);
  });

  it("passes with normal readings, and is not checked without Garmin", async () => {
    const id = await garminUser(false);
    const cycleId = await cycle(id, [{ day: 1, programId: await longRun(id, 40) }]);
    const sessions = mcpTools(registerPlannedSessionTools, id);
    await sessions("list_planned_sessions", { from: "2026-11-02", to: "2026-11-08" });
    const fine = await sessions("manage_planned_session", { operation: "add", cycleId, date: TODAY, programId: await hardBike(id), reason: "Intervals today" });
    expect(fine.isError, fine.raw).toBe(false);
    expect(fine.data.limits.passed).toContain("hard_after_low_readiness");

    const plainCycle = await cycle(me, [{ day: 1, programId: await longRun(me, 40) }]);
    const mine = mcpTools(registerPlannedSessionTools, me);
    await mine("list_planned_sessions", { from: "2026-11-02", to: "2026-11-08" });
    const none = await mine("manage_planned_session", { operation: "add", cycleId: plainCycle, date: TODAY, programId: await hardBike(), reason: "Intervals today" });
    expect(none.isError, none.raw).toBe(false);
    expect(none.data.limits.notChecked).toContainEqual(expect.objectContaining({ rule: "hard_after_low_readiness", why: expect.stringContaining("needs Garmin") }));
  });
});

describe("long_run_cap from runs logged in the app", () => {
  it("checks a user without Garmin against their logged runs", async () => {
    const [s] = await db.insert(workoutSessions).values({ userId: me, date: "2026-10-26", isCompleted: true, startTime: new Date("2026-10-26T07:00:00Z") }).returning();
    await db.insert(workoutSets).values({ sessionId: s.id, exerciseId: run, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 60 * MIN, distanceMeters: 10_000 });
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: [{ durationSeconds: 60 * MIN, targetReps: null }] }]);
    const [p] = await db.select({ v: programs.version }).from(programs).where(eq(programs.id, program.id));
    const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      sets: [{ id: slots[0].setIds[0], setNumber: 1, durationSeconds: 80 * MIN }],
      reason: "Longer long run",
      expectedVersion: p.v,
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].message).toContain("1:20 h is 1.33x your longest run in the last 30 days (1:00 h on 2026-10-26)");
  });
});

describe("warnings on the app's own writes (T4)", () => {
  it("stores warnings on the weekly sync's revisions and never blocks it; a lifter's sync stores none", async () => {
    const admin = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
    await db.insert(garminConnections).values({ userId: admin, encryptedKey: "x", lastSyncedAt: new Date() });
    await db.insert(garminActivities).values({ userId: admin, garminActivityId: 99, startTimeLocal: new Date("2026-10-30T07:00:00Z"), activityType: "running", data: { duration: 40 * MIN, distance: 8000 } });
    const peak = 120 * MIN;
    const { program, slots } = await createProgram(admin, [{ exerciseId: run, sets: [{ durationSeconds: 30 * MIN, peakDurationSeconds: peak, targetReps: null }] }]);
    const cycleId = await cycle(admin, [{ day: 7, programId: program.id }], { durationWeeks: 8, goal: "maintain" });
    await syncPeriodizedTargets(cycleId, admin, [{ programId: program.id }], 2, 8, "maintain", null);
    const [set] = await db.select().from(programSets).where(eq(programSets.id, slots[0].setIds[0]));
    expect(set.durationSeconds).toBeGreaterThan(44 * MIN);
    const rev = await lastRevision("program", program.id);
    expect(rev.writer).toBe("sync");
    expect(rev.limitCheck).toMatchObject({ warnings: [expect.objectContaining({ rule: "long_run_cap" })] });

    const lifter = (await createUser({ timeZone: "UTC" })).id;
    const lp = await createProgram(lifter, [{ exerciseId: run, sets: [{ durationSeconds: 30 * MIN, peakDurationSeconds: peak, targetReps: null }] }]);
    const lc = await cycle(lifter, [{ day: 7, programId: lp.program.id }], { durationWeeks: 8, goal: "maintain" });
    await syncPeriodizedTargets(lc, lifter, [{ programId: lp.program.id }], 2, 8, "maintain", null);
    expect((await lastRevision("program", lp.program.id)).limitCheck).toBeNull();
    expect((await lastRevision("cycle", lc)).limitCheck).toBeNull();
  });

  it("warns on a scheduled start that breaks a limit, and starts it anyway", async () => {
    const ids = [await hardBike(), await hardBike(), await hardBike(), await hardBike()];
    const cycleId = await cycle(me, ids.map((programId, i) => ({ day: i + 1, programId })), { status: "draft", startDate: null, scheduledStartDate: TODAY });
    await startDueScheduledCycle(me);
    const [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
    expect(row.status).toBe("active");
    const rev = await lastRevision("cycle", cycleId);
    expect(rev.writer).toBe("sync");
    expect(rev.limitCheck).toMatchObject({ warnings: [expect.objectContaining({ rule: "hard_sessions_per_week" })] });
  });

  it("warns on a change-set undo over MCP that brings back a long run", async () => {
    const admin = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
    await db.insert(garminConnections).values({ userId: admin, encryptedKey: "x", lastSyncedAt: new Date() });
    await db.insert(garminActivities).values({ userId: admin, garminActivityId: 98, startTimeLocal: new Date("2026-10-30T07:00:00Z"), activityType: "running", data: { duration: 80 * MIN, distance: 14_000 } });
    const { program, slots } = await createProgram(admin, [{ exerciseId: run, sets: [{ durationSeconds: 150 * MIN, targetReps: null }] }]);
    const tools = mcpTools(registerProgramTools, admin);
    const short = await tools("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      sets: [{ id: slots[0].setIds[0], setNumber: 1, durationSeconds: 60 * MIN }],
      reason: "Shorter",
      expectedVersion: 1,
    });
    expect(short.isError, short.raw).toBe(false);
    const changeSetId = (await lastRevision("program", program.id)).changeSetId!;
    const undo = await tools("restore_revision", { changeSetId, reason: "Undo the review" });
    expect(undo.isError, undo.raw).toBe(false);
    expect(undo.data.limits.warnings).toEqual([expect.objectContaining({ rule: "long_run_cap" })]);
    const [set] = await db.select().from(programSets).where(eq(programSets.id, slots[0].setIds[0]));
    expect(set.durationSeconds).toBe(150 * MIN);
    expect((await lastRevision("program", program.id)).limitCheck).toMatchObject({ warnings: [expect.objectContaining({ rule: "long_run_cap" })] });
  });

  it("checks a season resume over MCP like a start: refused, then applied with an override", async () => {
    const [season] = await db.insert(seasons).values({ userId: me, name: "2027", startDate: TODAY, endDate: "2027-09-01" }).returning();
    const ids = [await hardBike(), await hardBike(), await hardBike(), await hardBike()];
    const phase = await cycle(me, ids.map((programId, i) => ({ day: i + 1, programId })), { status: "draft", startDate: null, seasonId: season.id, phaseOrder: 1, name: "Base" });
    const call = mcpTools(registerSeasonTools, me);
    const args = { operation: "resume", seasonId: season.id, reason: "Start the season", expectedVersion: season.version };
    const refused = await call("manage_season", args);
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, phase)))[0].status).toBe("draft");

    const applied = await call("manage_season", { ...args, overrideLimits: ["hard_sessions_per_week"], overrideReason: "A planned overload week, agreed with the athlete." });
    expect(applied.isError, applied.raw).toBe(false);
    expect(applied.data.limits.overridden).toEqual([expect.objectContaining({ rule: "hard_sessions_per_week" })]);
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, phase)))[0].status).toBe("active");
  });
});
