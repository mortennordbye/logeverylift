import { db } from "@/db";
import { planRevisions, programs, trainingCycleSlots, trainingCycles, workoutSessions, workoutSets } from "@/db/schema";
import { updateProgramSet } from "@/lib/actions/programs";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * The weekly load ramp on assistant writes (docs/plans/limits-strength-readiness.md,
 * 3.1), on the app's fitness series (D1): a user with two months of logged
 * rides at CTL about 40, a weekday cycle with an easy ride every day, and an
 * assistant edit that makes every ride 2:40 h. The clock is fixed at Mon
 * 2026-11-16 12:00 UTC.
 */

const TODAY = "2026-11-16";
const MIN = 60;
let me: string;
let bike: number;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

/** One logged ride a day for `days` days before today: 60 min at RPE 3 (load 39.6 a day). */
async function history(userId: string, days: number) {
  for (let i = days; i >= 1; i--) {
    const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    const [s] = await db.insert(workoutSessions).values({ userId, date, isCompleted: true, startTime: new Date(`${date}T07:00:00Z`) }).returning();
    await db.insert(workoutSets).values({ sessionId: s.id, exerciseId: bike, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 60 * MIN, rpe: 3 });
  }
}

/** A weekday cycle with the same zone 2 ride (60 min) every day, its sessions dated. */
async function dailyRides(userId: string) {
  const { program, slots } = await createProgram(userId, [{ exerciseId: bike, sets: [{ durationSeconds: 60 * MIN, targetHeartRateZone: 2, targetReps: null }] }]);
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Base", durationWeeks: 4, status: "active", startDate: TODAY }).returning();
  await db.insert(trainingCycleSlots).values([1, 2, 3, 4, 5, 6, 7].map((d) => ({ trainingCycleId: c.id, dayOfWeek: d, programId: program.id })));
  await mcpTools(registerPlannedSessionTools, userId)("list_planned_sessions", { from: TODAY, to: "2026-11-22" });
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, setId: slots[0].setIds[0] };
}

const longer = async (userId: string, p: Awaited<ReturnType<typeof dailyRides>>, extra: Record<string, unknown> = {}) => {
  const [row] = await db.select({ v: programs.version }).from(programs).where(eq(programs.id, p.programId));
  return mcpTools(registerProgramTools, userId)("edit_program_exercise", {
    operation: "update",
    programExerciseId: p.programExerciseId,
    sets: [{ id: p.setId, setNumber: 1, durationSeconds: 160 * MIN, targetHeartRateZone: 2 }],
    reason: "Longer rides",
    expectedVersion: row.v,
    ...extra,
  });
};

describe("weekly_load_ramp", () => {
  it("refuses a week that would raise endurance CTL past 6 at CTL 45 or less, then applies with an override", async () => {
    await history(me, 60);
    const p = await dailyRides(me);
    const refused = await longer(me, p);
    expect(refused.isError).toBe(true);
    const body = JSON.parse(refused.raw);
    expect(body.brokenLimits.map((b: { rule: string }) => b.rule)).toEqual(["weekly_load_ramp"]);
    expect(body.brokenLimits[0].message).toMatch(/^This week would raise fitness \(endurance CTL\) by \d+\.\d in 7 days, from 40 to \d+\. Limit 6 a week/);
    // Every week of the block at 2:40 h a day climbs: one result, each week's numbers.
    const [first, second] = body.brokenLimits[0].numbers.weeks;
    expect(first).toMatchObject({ week: TODAY, limit: 6, ctlStart: 39.6 });
    expect(first.ramp).toBeGreaterThan(6);
    expect(second).toMatchObject({ week: "2026-11-23", limit: 8 });

    const applied = await longer(me, p, { overrideLimits: ["weekly_load_ramp"], overrideReason: "A planned training camp week the athlete booked." });
    expect(applied.isError, applied.raw).toBe(false);
    const [rev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, p.programId)))
      .orderBy(desc(planRevisions.id))
      .limit(1);
    expect(rev.limitCheck).toMatchObject({ overridden: [expect.objectContaining({ rule: "weekly_load_ramp" })] });
  });

  it("passes a small change, and says it ran", async () => {
    await history(me, 60);
    const p = await dailyRides(me);
    const [row] = await db.select({ v: programs.version }).from(programs).where(eq(programs.id, p.programId));
    const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: p.programExerciseId,
      sets: [{ id: p.setId, setNumber: 1, durationSeconds: 70 * MIN, targetHeartRateZone: 2 }],
      reason: "A bit longer",
      expectedVersion: row.v,
    });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.limits.passed).toContain("weekly_load_ramp");
  });

  it("is not checked while fitness calibrates, nor with no history; a user's own edit is never checked", async () => {
    await history(me, 20);
    const p = await dailyRides(me);
    const r = await longer(me, p);
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.limits.notChecked).toContainEqual(expect.objectContaining({ rule: "weekly_load_ramp", why: expect.stringContaining("calibrating (21 of 42 days") }));

    const fresh = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    const q = await dailyRides(fresh);
    const none = await longer(fresh, q);
    expect(none.isError, none.raw).toBe(false);
    expect(none.data.limits.notChecked).toContainEqual(expect.objectContaining({ rule: "weekly_load_ramp", why: expect.stringContaining("no training load yet") }));

    const user = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    await history(user, 60);
    const u = await dailyRides(user);
    asUser(user);
    expect((await updateProgramSet({ id: u.setId, durationSeconds: 160 * MIN })).success).toBe(true);
  });
});
