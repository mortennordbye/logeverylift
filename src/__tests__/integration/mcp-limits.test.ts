import { db } from "@/db";
import {
  garminActivities,
  garminConnections,
  planRevisions,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
} from "@/db/schema";
import { updateProgramSet } from "@/lib/actions/programs";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { deloadCadenceForLevel, periodizedLoad, scaledDuration } from "@/lib/utils/periodization";
import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * Training limits on assistant writes (docs/plans/ai-coach.md, 2.4; D3, D4,
 * T4), with real queries: a write that breaks a limit is not applied; a resend
 * with an override applies and the revision stores it; user edits and
 * accounts without the data are not checked.
 */

// Garmin is on only with the key set (src/lib/garmin/access.ts).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const MIN = 60;
let me: string;
let run: number;
let bike: number;

/** A Garmin run `daysAgo` days back. */
async function garminRun(userId: string, daysAgo: number, durationS: number, distanceM: number, id = Math.floor(Math.random() * 1e9)) {
  await db.insert(garminActivities).values({
    userId,
    garminActivityId: id,
    startTimeLocal: new Date(Date.now() - daysAgo * 86_400_000),
    activityType: "running",
    data: { duration: durationS, distance: distanceM },
  });
}

/** A program with one run set of this many minutes. */
async function runProgram(userId: string, minutes: number) {
  const { program, slots } = await createProgram(userId, [{ exerciseId: run, sets: [{ durationSeconds: minutes * MIN, targetReps: null }] }]);
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, setId: slots[0].setIds[0] };
}

/** A program with an interval (hard) bike session. */
async function hardProgram(userId: string) {
  const { program } = await createProgram(userId, [{ exerciseId: bike, sets: [{ durationSeconds: 300, sessionRole: "work", targetReps: null }] }]);
  return program.id;
}

async function activeCycle(userId: string, slots: { day: number; programId: number }[], scheduleType: "day_of_week" | "rotation" = "day_of_week") {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Block", durationWeeks: 8, status: "active", startDate: toDateStr(new Date()), scheduleType })
    .returning();
  if (slots.length) {
    await db.insert(trainingCycleSlots).values(
      slots.map((s, i) =>
        scheduleType === "day_of_week"
          ? { trainingCycleId: cycle.id, dayOfWeek: s.day, programId: s.programId }
          : { trainingCycleId: cycle.id, orderIndex: i + 1, programId: s.programId },
      ),
    );
  }
  return cycle.id;
}

const versionOf = async (programId: number) =>
  (await db.select({ v: programs.version }).from(programs).where(eq(programs.id, programId)))[0].v;
const durationOf = async (setId: number) =>
  (await db.select({ d: programSets.durationSeconds }).from(programSets).where(eq(programSets.id, setId)))[0].d;
const revisionCount = async () => (await db.select({ id: planRevisions.id }).from(planRevisions)).length;

/** Set the run set of a program to this many minutes, as the assistant. */
function setRun(p: { programId: number; programExerciseId: number; setId: number }, minutes: number, extra: Record<string, unknown> = {}) {
  return async (userId: string) =>
    mcpTools(registerProgramTools, userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId: p.programExerciseId,
      sets: [{ id: p.setId, setNumber: 1, durationSeconds: minutes * MIN }],
      reason: "Longer long run",
      expectedVersion: await versionOf(p.programId),
      ...extra,
    });
}

beforeEach(async () => {
  me = (await createUser({ role: "admin", enduranceEnabled: true })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(garminConnections).values({ userId: me, encryptedKey: "x", lastSyncedAt: new Date() });
  await garminRun(me, 10, 80 * MIN, 14_000);
  await garminRun(me, 45, 150 * MIN, 25_000); // outside the 30 days
});

describe("long-run cap", () => {
  it("refuses a run over 1.10x the longest in 30 days, with the numbers, and changes nothing", async () => {
    const p = await runProgram(me, 60);
    const revisionsBefore = await revisionCount();
    const result = await setRun(p, 105)(me);

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.raw);
    expect(body.applied).toBe(false);
    expect(body.brokenLimits).toHaveLength(1);
    expect(body.brokenLimits[0]).toMatchObject({ rule: "long_run_cap", evidence: "Study (large cohort)" });
    expect(body.brokenLimits[0].message).toContain("1:45 h is 1.31x your longest run in the last 30 days (1:20 h on");
    expect(body.brokenLimits[0].message).toContain("at most 1:28 h");
    expect(await durationOf(p.setId)).toBe(60 * MIN);
    expect(await revisionCount()).toBe(revisionsBefore);
  });

  it("applies a resend with an override and stores it on the revision", async () => {
    const p = await runProgram(me, 60);
    const result = await setRun(p, 105, {
      overrideLimits: ["long_run_cap"],
      overrideReason: "The athlete ran 1:40 h on trails last Sunday without the watch.",
    })(me);

    expect(result.isError, result.raw).toBe(false);
    expect(result.data.limits.overridden).toEqual([expect.objectContaining({ rule: "long_run_cap" })]);
    expect(await durationOf(p.setId)).toBe(105 * MIN);
    const [rev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, p.programId)))
      .orderBy(desc(planRevisions.id))
      .limit(1);
    expect(rev.writer).toBe("assistant");
    expect(rev.limitCheck).toMatchObject({
      checked: expect.arrayContaining(["long_run_cap"]),
      overridden: [expect.objectContaining({ rule: "long_run_cap", evidence: "Study (large cohort)" })],
      overrideReason: "The athlete ran 1:40 h on trails last Sunday without the watch.",
    });
  });

  it("passes a run within the cap, and says which limits ran", async () => {
    const p = await runProgram(me, 60);
    const result = await setRun(p, 85)(me);
    expect(result.isError, result.raw).toBe(false);
    expect(result.data.limits.passed).toContain("long_run_cap");
    expect(await durationOf(p.setId)).toBe(85 * MIN);
  });

  it("does not block a run that was already long and did not grow", async () => {
    const p = await runProgram(me, 120);
    const result = await setRun(p, 110)(me);
    expect(result.isError, result.raw).toBe(false);
  });

  it("needs a reason with an override, and reports an override that matched nothing", async () => {
    const p = await runProgram(me, 60);
    expect((await setRun(p, 105, { overrideLimits: ["long_run_cap"] })(me)).raw).toContain("overrideReason is required");
    const unused = await setRun(p, 70, { overrideLimits: ["hard_sessions_per_week"], overrideReason: "Not needed at all here." })(me);
    expect(unused.data.limits.ignoredOverrides).toEqual(["hard_sessions_per_week was not broken, so the override did nothing"]);
  });

  it("does not check the user's own edit in the app (D4)", async () => {
    const p = await runProgram(me, 60);
    asUser(me);
    const result = await updateProgramSet({ id: p.setId, durationSeconds: 200 * MIN });
    expect(result.success).toBe(true);
    expect(await durationOf(p.setId)).toBe(200 * MIN);
  });

  it("says plainly that it did not check without Garmin data", async () => {
    const lifter = (await createUser({ enduranceEnabled: true })).id;
    const p = await runProgram(lifter, 60);
    const result = await setRun(p, 200)(lifter);
    expect(result.isError, result.raw).toBe(false);
    expect(result.data.limits.notChecked).toEqual([
      expect.objectContaining({ rule: "long_run_cap", why: expect.stringContaining("no Garmin data") }),
      expect.objectContaining({ rule: "hard_sessions_per_week" }),
    ]);
  });

  it("checks nothing with the endurance features off", async () => {
    const lifter = (await createUser({ role: "admin" })).id;
    const p = await runProgram(lifter, 60);
    const result = await setRun(p, 200)(lifter);
    expect(result.isError, result.raw).toBe(false);
    expect(result.data.limits.checked).toEqual([]);
    expect(result.data.limits.notChecked.map((n: { why: string }) => n.why)[0]).toContain("endurance features are off");
  });
});

describe("hard sessions per week", () => {
  it("refuses a fourth hard session in the week and creates no slot, then applies with an override", async () => {
    const cycleId = await activeCycle(me, [
      { day: 2, programId: await hardProgram(me) },
      { day: 4, programId: await hardProgram(me) },
      { day: 6, programId: await hardProgram(me) },
    ]);
    const fourth = await hardProgram(me);
    const call = mcpTools(registerCycleTools, me);
    const args = { operation: "upsert", trainingCycleId: cycleId, dayOfWeek: 7, programId: fourth, reason: "Add intervals", expectedVersion: 1 };

    const refused = await call("edit_cycle_slot", args);
    expect(refused.isError).toBe(true);
    const body = JSON.parse(refused.raw);
    expect(body.brokenLimits[0]).toMatchObject({ rule: "hard_sessions_per_week", numbers: { hardSessions: 4, limit: 3 } });
    expect(body.brokenLimits[0].message).toBe("This week would hold 4 hard sessions (Tue, Thu, Sat, Sun). Limit 3.");
    expect(await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, cycleId))).toHaveLength(3);

    const applied = await call("edit_cycle_slot", { ...args, overrideLimits: ["hard_sessions_per_week"], overrideReason: "Race week simulation the athlete asked for." });
    expect(applied.isError, applied.raw).toBe(false);
    expect(await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, cycleId))).toHaveLength(4);
  });

  it("counts a program made hard by a set edit, in the active cycle that holds it", async () => {
    const easy = await runProgram(me, 40);
    await activeCycle(me, [
      { day: 1, programId: await hardProgram(me) },
      { day: 3, programId: await hardProgram(me) },
      { day: 5, programId: await hardProgram(me) },
      { day: 7, programId: easy.programId },
    ]);
    const result = await mcpTools(registerProgramTools, me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: easy.programExerciseId,
      sets: [{ id: easy.setId, setNumber: 1, durationSeconds: 40 * MIN, targetHeartRateZone: 4 }],
      reason: "Make it a tempo run",
      expectedVersion: await versionOf(easy.programId),
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
  });

  it("is not counted on a rotation cycle, and says so", async () => {
    const cycleId = await activeCycle(me, [], "rotation");
    const result = await mcpTools(registerCycleTools, me)("edit_cycle_slot", {
      operation: "upsert",
      trainingCycleId: cycleId,
      orderIndex: 1,
      programId: await hardProgram(me),
      reason: "Add intervals",
      expectedVersion: 1,
    });
    expect(result.isError, result.raw).toBe(false);
    expect(result.data.limits.notChecked).toEqual([
      expect.objectContaining({ rule: "hard_sessions_per_week", why: expect.stringContaining("Rotation") }),
    ]);
  });

  // Characterization test for package C2 (docs/plans/sessions.md, 8.1, C10).
  it("counts one hard program on two days as two sessions, by weekday", async () => {
    const twice = await hardProgram(me);
    const cycleId = await activeCycle(me, [
      { day: 1, programId: twice },
      { day: 3, programId: twice },
      { day: 5, programId: await hardProgram(me) },
    ]);
    const result = await mcpTools(registerCycleTools, me)("edit_cycle_slot", {
      operation: "upsert",
      trainingCycleId: cycleId,
      dayOfWeek: 7,
      programId: twice,
      reason: "Third day of the same intervals",
      expectedVersion: 1,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].message).toBe("This week would hold 4 hard sessions (Mon, Wed, Fri, Sun). Limit 3.");
  });
});

describe("start", () => {
  it("refuses to start a block whose week holds four hard sessions, and leaves it a draft", async () => {
    const ids = [await hardProgram(me), await hardProgram(me), await hardProgram(me), await hardProgram(me)];
    const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Next", durationWeeks: 8 }).returning();
    await db.insert(trainingCycleSlots).values(ids.map((programId, i) => ({ trainingCycleId: cycle.id, dayOfWeek: i + 1, programId })));
    const result = await mcpTools(registerCycleTools, me)("manage_training_cycle", {
      operation: "start",
      cycleId: cycle.id,
      reason: "Start the block",
      expectedVersion: 1,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
    const [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycle.id));
    expect(row.status).toBe("draft");
  });
});

describe("restore", () => {
  it("restores past a limit, with a warning in the result and on the revision (T4)", async () => {
    const p = await runProgram(me, 60);
    // The user made it long in the app; the assistant then restores that version.
    asUser(me);
    await updateProgramSet({ id: p.setId, durationSeconds: 150 * MIN });
    await updateProgramSet({ id: p.setId, durationSeconds: 60 * MIN });
    const revs = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, p.programId)))
      .orderBy(desc(planRevisions.id));
    const longOne = revs[1].id;

    const result = await mcpTools(registerProgramTools, me)("restore_revision", { revisionId: longOne, reason: "Back to the long run" });
    expect(result.isError, result.raw).toBe(false);
    expect(result.data.limits.warnings).toEqual([expect.objectContaining({ rule: "long_run_cap" })]);
    expect(await durationOf(p.setId)).toBe(150 * MIN);
    const [restore] = await db.select().from(planRevisions).where(eq(planRevisions.action, "restore")).orderBy(desc(planRevisions.id)).limit(1);
    expect(restore.limitCheck).toMatchObject({ warnings: [expect.objectContaining({ rule: "long_run_cap" })] });
  });
});

describe("review fixes", () => {
  it("counts the week of a scheduled draft that holds the program", async () => {
    const easy = await runProgram(me, 40);
    const [draft] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Next", durationWeeks: 8, scheduledStartDate: toDateStr(addDays(new Date(), 3)) })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: draft.id, dayOfWeek: 1, programId: await hardProgram(me) },
      { trainingCycleId: draft.id, dayOfWeek: 3, programId: await hardProgram(me) },
      { trainingCycleId: draft.id, dayOfWeek: 5, programId: await hardProgram(me) },
      { trainingCycleId: draft.id, dayOfWeek: 7, programId: easy.programId },
    ]);
    const result = await mcpTools(registerProgramTools, me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: easy.programExerciseId,
      sets: [{ id: easy.setId, setNumber: 1, durationSeconds: 40 * MIN, sessionRole: "work" }],
      reason: "Intervals on Sunday",
      expectedVersion: await versionOf(easy.programId),
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
    expect((await db.select().from(programSets).where(eq(programSets.id, easy.setId)))[0].sessionRole).toBeNull();
  });

  it("checks a shorter block, which makes this week's runs longer", async () => {
    const before = periodizedLoad(2, 16, "build", deloadCadenceForLevel("intermediate")).multiplier;
    const peak = Math.round((80 * MIN) / before);
    const { program, slots } = await createProgram(me, [
      { exerciseId: run, sets: [{ durationSeconds: scaledDuration(peak, before), peakDurationSeconds: peak, targetReps: null }] },
    ]);
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Long block", durationWeeks: 16, status: "active", startDate: toDateStr(addDays(new Date(), -8)), athleteLevel: "intermediate", lastSyncedWeek: 2 })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, dayOfWeek: 7, programId: program.id });

    const result = await mcpTools(registerCycleTools, me)("manage_training_cycle", {
      operation: "update",
      cycleId: cycle.id,
      durationWeeks: 4,
      reason: "Shorter block",
      expectedVersion: 1,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].rule).toBe("long_run_cap");
    const [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycle.id));
    expect(row).toMatchObject({ durationWeeks: 16, lastSyncedWeek: 2, version: 1 });
    expect(await durationOf(slots[0].setIds[0])).toBe(scaledDuration(peak, before));
  });

  it("refuses set_volume over the cap and changes nothing", async () => {
    const week = periodizedLoad(2, 8, "build", deloadCadenceForLevel(null)).multiplier;
    const peak = Math.round((86 * MIN) / week);
    const { program, slots } = await createProgram(me, [
      { exerciseId: run, sets: [{ durationSeconds: scaledDuration(peak, week), peakDurationSeconds: peak, targetReps: null }] },
    ]);
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: toDateStr(addDays(new Date(), -8)), lastSyncedWeek: 2 })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, dayOfWeek: 7, programId: program.id });
    const revisionsBefore = await revisionCount();

    const result = await mcpTools(registerCycleTools, me)("manage_training_cycle", {
      operation: "set_volume",
      cycleId: cycle.id,
      pct: 110,
      reason: "More volume",
      expectedVersion: 1,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].rule).toBe("long_run_cap");
    expect(await durationOf(slots[0].setIds[0])).toBe(scaledDuration(peak, week));
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycle.id)))[0].adaptationPct).toBe(100);
    expect(await revisionCount()).toBe(revisionsBefore);
  });

  it("looks back 30 days, not 31", async () => {
    // Only a run 30 days ago is longer than the planned one; it is outside the window.
    await garminRun(me, 30, 150 * MIN, 25_000);
    const p = await runProgram(me, 60);
    const result = await setRun(p, 100)(me);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].message).toContain("(1:20 h on");
  });

  it("names the long-run rule when Garmin data is missing", async () => {
    const lifter = (await createUser({ enduranceEnabled: true })).id;
    const p = await runProgram(lifter, 60);
    const result = await setRun(p, 70)(lifter);
    expect(result.data.limits.notChecked[0].why).toMatch(/^Long-run cap not checked: no Garmin data for this account\./);
  });
});

describe("a scheduled draft's settings", () => {
  it("checks a goal change on a scheduled draft against its first week", async () => {
    const week1 = periodizedLoad(1, 8, "build", deloadCadenceForLevel(null)).multiplier;
    // Week 1 of a build block is well under the cap; at "maintain" (1.0) it is over.
    const peak = 120 * MIN;
    expect(scaledDuration(peak, week1)).toBeLessThan(88 * MIN);
    const { program } = await createProgram(me, [{ exerciseId: run, sets: [{ durationSeconds: peak, peakDurationSeconds: peak, targetReps: null }] }]);
    const [draft] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Next", durationWeeks: 8, goal: "build", scheduledStartDate: toDateStr(addDays(new Date(), 3)) })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: draft.id, dayOfWeek: 7, programId: program.id });

    const result = await mcpTools(registerCycleTools, me)("manage_training_cycle", {
      operation: "update",
      cycleId: draft.id,
      goal: "maintain",
      reason: "Hold volume",
      expectedVersion: 1,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.raw).brokenLimits[0].rule).toBe("long_run_cap");
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, draft.id)))[0].goal).toBe("build");
  });
});

