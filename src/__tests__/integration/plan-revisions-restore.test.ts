import { db } from "@/db";
import {
  planRevisions,
  programExercises,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
  users,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import {
  applyRejectedChange,
  getAssistantChanges,
  getDeletedPlans,
  getPlanHistory,
  restorePlanRevision,
  undoPlanChangeSet,
} from "@/lib/actions/plan-revisions";
import {
  applyProgressionToPlan,
  deleteManyPrograms,
  getProgramWithExercises,
  getPrograms,
  removeExerciseFromProgram,
  setProgramExerciseApplyToPlan,
  updateProgram,
  updateProgramSet,
} from "@/lib/actions/programs";
import { deleteTrainingCycle, getActiveCycleForUser, getTrainingCycles } from "@/lib/actions/training-cycles";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { collectUserData } from "@/lib/account-data";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { purgePlanRevisions } from "@/lib/plan-revisions";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The revision layer end to end (docs/plans/revisions.md): who each writer is,
 * restore, versions and conflicts, soft delete, retention.
 */

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function mcp(userId: string, clientId = "client-a") {
  const tools = new Map<string, { schema: z.ZodTypeAny; handler: Handler }>();
  registerProgramTools(
    {
      registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: Handler) =>
        tools.set(name, { schema: z.object(config.inputSchema), handler }),
    } as unknown as McpServer,
    userId,
    clientId,
  );
  return async (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name)!;
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) return { isError: true, raw: parsed.error.message };
    const result = await tool.handler(parsed.data as Record<string, unknown>);
    return { ...result, raw: result.content[0].text };
  };
}

let userId: string;
let exerciseId: number;
let programId: number;
let programExerciseId: number;
let setIds: number[];

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Bench Press" })).id;
  const { program, slots } = await createProgram(userId, [
    { exerciseId, sets: [{ weightKg: "80" }, { weightKg: "82.5" }, { weightKg: "85" }] },
  ]);
  programId = program.id;
  programExerciseId = slots[0].programExerciseId;
  setIds = slots[0].setIds;
});

const revisions = () =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, programId)))
    .orderBy(asc(planRevisions.id));

const setRows = () =>
  db.select().from(programSets).where(eq(programSets.programExerciseId, programExerciseId)).orderBy(asc(programSets.id));

const version = async () => (await db.select({ v: programs.version }).from(programs).where(eq(programs.id, programId)))[0].v;

async function logSet(sessionId: number, position: number, programSetId: number, weightKg: number) {
  const r = await logWorkoutSet({
    sessionId,
    exerciseId,
    setNumber: position,
    programSetId,
    targetReps: 8,
    actualReps: 8,
    weightKg,
    restTimeSeconds: 90,
    isCompleted: true,
    isFailed: false,
    wasEasy: false,
  });
  expect(r.success).toBe(true);
}

describe("writers", () => {
  it("a user edit stores a baseline, then the change, and bumps the version", async () => {
    expect((await updateProgramSet({ id: setIds[0], weightKg: 90 })).success).toBe(true);
    const revs = await revisions();
    expect(revs.map((r) => [r.action, r.writer, r.version])).toEqual([
      ["baseline", "user", 1],
      ["update", "user", 2],
    ]);
    expect(await version()).toBe(2);
  });

  it("a write that changes nothing stores no revision", async () => {
    await updateProgramSet({ id: setIds[0], weightKg: 90 });
    await updateProgramSet({ id: setIds[0], weightKg: 90 });
    expect((await revisions()).length).toBe(2);
    expect(await version()).toBe(2);
  });

  it("progression writes are revisions but do not bump the version", async () => {
    await setProgramExerciseApplyToPlan({ programExerciseId, applyToPlan: true });
    const before = await version();
    await applyProgressionToPlan({ programExerciseId, updates: [{ programSetId: setIds[0], weightKg: 82.5 }] });
    const last = (await revisions()).at(-1)!;
    expect(last.writer).toBe("progression");
    expect(await version()).toBe(before);
  });

  it("assistant writes carry the client, the reason and one change set per review", async () => {
    const call = mcp(userId);
    const a = await call("update_program", { programId, name: "Push A", reason: "Clearer name", expectedVersion: 1 });
    expect(a.isError).toBeFalsy();
    const b = await call("update_program", { programId, name: "Push 1", reason: "Shorter", expectedVersion: 2 });
    expect(b.isError).toBeFalsy();
    const revs = (await revisions()).filter((r) => r.writer === "assistant");
    expect(revs).toHaveLength(2);
    expect(revs.map((r) => r.reason)).toEqual(["Clearer name", "Shorter"]);
    expect(revs[0].clientId).toBe("client-a");
    expect(revs[0].changeSetId).toBe(revs[1].changeSetId);

    const feed = await getAssistantChanges();
    expect(feed.success && feed.data[0].objects[0].changes.join(" ")).toContain("Push 1");
  });

  it("a weekly sync writes a sync revision and keeps the version", async () => {
    const run = await createExercise({ name: "Run", category: "cardio", discipline: "run" });
    const { program, slots } = await createProgram(userId, [
      { exerciseId: run.id, sets: [{ targetReps: null, weightKg: "0", distanceMeters: 10000, peakDistanceMeters: 10000 }] },
    ]);
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Tri", durationWeeks: 12, goal: "build", status: "active", startDate: toDateStr(new Date()) })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, programId: program.id, dayOfWeek: 1 });
    await syncPeriodizedTargets(cycle.id, userId, [{ programId: program.id }], 1, 12, "build", null);
    const revs = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, program.id)));
    expect(revs.map((r) => r.writer)).toEqual(["user", "sync"]);
    expect(revs[1].changeSetId).toBe(`sync:${cycle.id}:1`);
    const [p] = await db.select({ v: programs.version }).from(programs).where(eq(programs.id, program.id));
    expect(p.v).toBe(1);
    void slots;
  });
});

describe("soft delete and readers", () => {
  it("a deleted program is hidden from readers, kept in the export, and listed as deleted", async () => {
    expect((await deleteManyPrograms([programId])).success).toBe(true);
    const list = await getPrograms();
    expect(list.success && list.data.map((p) => p.id)).not.toContain(programId);
    expect((await getProgramWithExercises(programId)).success).toBe(false);
    const exported = await collectUserData(userId);
    expect(exported.programs.map((p) => p.id)).toContain(programId);
    expect(exported.plan_revisions.length).toBeGreaterThan(0);
    const deleted = await getDeletedPlans({ type: "program" });
    expect(deleted.success && deleted.data.map((d) => d.id)).toEqual([programId]);
  });

  it("a removed exercise slot is hidden, and its logged rows keep their link", async () => {
    const session = await createSession(userId, programId);
    await logSet(session.id, 1, setIds[0], 80);
    await removeExerciseFromProgram(programExerciseId, programId);
    const p = await getProgramWithExercises(programId);
    expect(p.success && p.data.programExercises).toHaveLength(0);
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    expect(row.programExerciseId).toBe(programExerciseId);
    expect(row.programSetId).toBe(setIds[0]);
  });

  it("deleting a program used by a workout in progress is refused", async () => {
    await createSession(userId, programId);
    const r = await deleteManyPrograms([programId]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/workout in progress/);
  });

  it("an active cycle reads a slot whose program was deleted as a slot with no program", async () => {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Block", durationWeeks: 8, status: "active", startDate: toDateStr(new Date()) })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, programId, dayOfWeek: 1 });
    await deleteManyPrograms([programId]);
    const active = await getActiveCycleForUser();
    expect(active.success).toBe(true);
    if (active.success && active.data) {
      expect(active.data.cycle.slots.every((s) => s.programId == null)).toBe(true);
    }
  });

  it("a cycle delete takes its generated programs along, and one restore brings both back", async () => {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Generated block", durationWeeks: 8 })
      .returning();
    await db.update(programs).set({ createdByCycleId: cycle.id }).where(eq(programs.id, programId));
    expect((await deleteTrainingCycle(cycle.id)).success).toBe(true);
    const cycles = await getTrainingCycles();
    expect(cycles.success && cycles.data.map((c) => c.id)).not.toContain(cycle.id);
    expect((await getProgramWithExercises(programId)).success).toBe(false);

    const deleted = await getDeletedPlans({ type: "cycle" });
    const revisionId = deleted.success ? deleted.data[0].revisionId! : 0;
    const r = await restorePlanRevision({ revisionId });
    expect(r.success).toBe(true);
    expect((await getProgramWithExercises(programId)).success).toBe(true);
    const back = await getTrainingCycles();
    expect(back.success && back.data.map((c) => c.id)).toContain(cycle.id);
  });
});

describe("restore", () => {
  it("brings a program back with the same ids and leaves logged rows exactly as they were", async () => {
    const session = await createSession(userId, programId, { isCompleted: true });
    await logSet(session.id, 1, setIds[0], 80);
    const loggedBefore = await db.select().from(workoutSets).orderBy(asc(workoutSets.id));
    const sessionsBefore = await db.select().from(workoutSessions).orderBy(asc(workoutSessions.id));

    await updateProgramSet({ id: setIds[1], weightKg: 100 });
    const call = mcp(userId);
    await call("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [{ setNumber: 1, weightKg: 70 }],
      reason: "One set only",
      expectedVersion: 2,
    });
    expect((await setRows()).filter((s) => s.deletedAt == null)).toHaveLength(1);

    const baseline = (await revisions())[0];
    const r = await restorePlanRevision({ revisionId: baseline.id });
    expect(r.success).toBe(true);

    const sets = (await setRows()).filter((s) => s.deletedAt == null);
    expect(sets.map((s) => s.id)).toEqual(setIds);
    expect(sets.map((s) => s.weightKg)).toEqual(["80.00", "82.50", "85.00"]);
    expect(await db.select().from(workoutSets).orderBy(asc(workoutSets.id))).toEqual(loggedBefore);
    expect(await db.select().from(workoutSessions).orderBy(asc(workoutSessions.id))).toEqual(sessionsBefore);

    // The restore is a revision of its own, and can itself be restored.
    const last = (await revisions()).at(-1)!;
    expect(last.action).toBe("restore");
    expect(last.restoredFromId).toBe(baseline.id);
    const beforeRestore = (await revisions()).at(-2)!;
    expect((await restorePlanRevision({ revisionId: beforeRestore.id })).success).toBe(true);
    expect((await setRows()).filter((s) => s.deletedAt == null).map((s) => s.id)).toEqual([setIds[0]]);
  });

  it("brings back a deleted program from its delete revision", async () => {
    await deleteManyPrograms([programId]);
    const deleted = await getDeletedPlans({ type: "program" });
    const r = await restorePlanRevision({ revisionId: deleted.success ? deleted.data[0].revisionId! : 0 });
    expect(r.success).toBe(true);
    const p = await getProgramWithExercises(programId);
    expect(p.success && p.data.programExercises[0].programSets.map((s) => s.id)).toEqual(setIds);
  });

  it("is refused while a workout on the program is in progress", async () => {
    await updateProgram({ id: programId, name: "Renamed" });
    await createSession(userId, programId);
    const r = await restorePlanRevision({ revisionId: (await revisions())[0].id });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/workout in progress/);
  });

  it("keeps a weight the progression engine set since, and restores one the user set after it", async () => {
    await updateProgram({ id: programId, name: "Target" });
    const target = (await revisions()).at(-1)!;
    await setProgramExerciseApplyToPlan({ programExerciseId, applyToPlan: true });
    await applyProgressionToPlan({
      programExerciseId,
      updates: [
        { programSetId: setIds[0], weightKg: 82.5 },
        { programSetId: setIds[1], weightKg: 85 },
      ],
    });
    // The user then sets set 2 by hand: that one is theirs and goes back.
    await updateProgramSet({ id: setIds[1], weightKg: 95 });

    expect((await restorePlanRevision({ revisionId: target.id })).success).toBe(true);
    const sets = await setRows();
    expect(sets.map((s) => s.weightKg)).toEqual(["82.50", "82.50", "85.00"]);
  });

  it("leaves the sync's fields to the sync and runs it again", async () => {
    const run = await createExercise({ name: "Run", category: "cardio", discipline: "run" });
    const { program, slots } = await createProgram(userId, [
      { exerciseId: run.id, sets: [{ targetReps: null, weightKg: "0", distanceMeters: 10000, peakDistanceMeters: 10000 }] },
    ]);
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Tri", durationWeeks: 12, goal: "maintain", status: "active", startDate: toDateStr(new Date()), lastSyncedWeek: 1 })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, programId: program.id, dayOfWeek: 1 });
    const runSet = slots[0].setIds[0];
    // The user changes the peak (an anchored edit): the week's distance follows.
    await updateProgramSet({ id: runSet, distanceMeters: 15000, anchor: "distance" });
    const [after] = await db.select().from(programSets).where(eq(programSets.id, runSet));
    expect(after.peakDistanceMeters).toBe(15000);

    const [baseline] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectId, program.id), eq(planRevisions.action, "baseline")));
    expect((await restorePlanRevision({ revisionId: baseline.id })).success).toBe(true);
    const [restored] = await db.select().from(programSets).where(eq(programSets.id, runSet));
    expect(restored.peakDistanceMeters).toBe(10000);
    // Recomputed by the sync from the restored peak ("maintain" is flat at 1×).
    expect(restored.distanceMeters).toBe(10000);
  });

  it("undoes a whole assistant change set in one step", async () => {
    const call = mcp(userId);
    await call("update_program", { programId, name: "AI 1", reason: "r", expectedVersion: 1 });
    await call("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      notes: "Pause at the chest",
      reason: "r",
      expectedVersion: 2,
    });
    const feed = await getAssistantChanges();
    const changeSetId = feed.success ? feed.data[0].changeSetId : "";
    expect((await undoPlanChangeSet({ changeSetId })).success).toBe(true);
    const p = await getProgramWithExercises(programId);
    expect(p.success && p.data.name).not.toBe("AI 1");
    expect(p.success && p.data.programExercises[0].notes).toBeNull();
  });

  it("is refused for another user's revision, and their history is not readable", async () => {
    await updateProgram({ id: programId, name: "Mine" });
    const revisionId = (await revisions())[0].id;
    const other = await createUser();
    asUser(other.id);
    expect((await restorePlanRevision({ revisionId })).success).toBe(false);
    expect((await getPlanHistory({ type: "program", id: programId })).success).toBe(false);
    asUser(userId);
    const [p] = await db.select({ name: programs.name }).from(programs).where(eq(programs.id, programId));
    expect(p.name).toBe("Mine");
  });
});

describe("versions and conflicts", () => {
  it("refuses an AI write based on an old version and changes nothing", async () => {
    await updateProgram({ id: programId, name: "User rename" });
    const r = await mcp(userId)("update_program", { programId, name: "AI rename", reason: "r", expectedVersion: 1 });
    expect(r.isError).toBe(true);
    expect(r.raw).toMatch(/Conflict: program .* version 2/);
    expect(r.raw).toContain("User rename");
    const [p] = await db.select({ name: programs.name }).from(programs).where(eq(programs.id, programId));
    expect(p.name).toBe("User rename");
  });

  it("a flushed set write whose field changed since the workout started is not applied, and is stored as a conflict", async () => {
    // The workout started at version 1. The assistant changes set 1's weight.
    await mcp(userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [
        { setNumber: 1, weightKg: 100, targetReps: 8, restTimeSeconds: 90 },
        { setNumber: 2, weightKg: 82.5, targetReps: 8, restTimeSeconds: 90 },
        { setNumber: 3, weightKg: 85, targetReps: 8, restTimeSeconds: 90 },
      ],
      reason: "Heavier top set",
      expectedVersion: 1,
    });
    const r = await updateProgramSet({ id: setIds[0], weightKg: 82.5, targetReps: 8, baseVersion: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.conflict?.programId).toBe(programId);
    const [set] = await db.select().from(programSets).where(eq(programSets.id, setIds[0]));
    expect(set.weightKg).toBe("100.00");
    const conflict = (await revisions()).at(-1)!;
    expect(conflict.action).toBe("conflict");

    // "Apply my value" then writes it as a normal edit.
    expect((await applyRejectedChange({ revisionId: conflict.id })).success).toBe(true);
    const [applied] = await db.select().from(programSets).where(eq(programSets.id, setIds[0]));
    expect(applied.weightKg).toBe("82.50");
  });

  it("the same conflicting write sent twice by the queue is one conflict, not two", async () => {
    await mcp(userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [{ setNumber: 1, weightKg: 100 }, { setNumber: 2, weightKg: 82.5 }, { setNumber: 3, weightKg: 85 }],
      reason: "Heavier top set",
      expectedVersion: 1,
    });
    const first = await updateProgramSet({ id: setIds[0], weightKg: 82.5, baseVersion: 1 });
    const again = await updateProgramSet({ id: setIds[0], weightKg: 82.5, baseVersion: 1 });
    expect(!first.success && !again.success && first.conflict?.revisionId === again.conflict?.revisionId).toBe(true);
    expect((await revisions()).filter((r) => r.action === "conflict")).toHaveLength(1);
  });

  it("a flushed write to a field nobody else changed still applies", async () => {
    await updateProgramSet({ id: setIds[2], weightKg: 90 }); // another set, by the user
    const r = await updateProgramSet({ id: setIds[0], weightKg: 81, baseVersion: 1 });
    expect(r.success).toBe(true);
    const [set] = await db.select().from(programSets).where(eq(programSets.id, setIds[0]));
    expect(set.weightKg).toBe("81.00");
  });

  it("a flushed write to a set deleted since is a conflict", async () => {
    await mcp(userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [{ setNumber: 2, weightKg: 82.5 }, { setNumber: 3, weightKg: 85 }],
      reason: "Drop set 1",
      expectedVersion: 1,
    });
    const r = await updateProgramSet({ id: setIds[0], weightKg: 81, baseVersion: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.conflict).toBeDefined();
  });

  it("a write with no base version (an old cached bundle) applies as before", async () => {
    await updateProgram({ id: programId, name: "Bump" });
    expect((await updateProgramSet({ id: setIds[0], weightKg: 81 })).success).toBe(true);
  });
});

describe("logging against the plan", () => {
  it("a set logged after its plan set was deleted keeps its link, and a later set at that position is not taken", async () => {
    const session = await createSession(userId, programId);
    await db.update(programSets).set({ deletedAt: new Date() }).where(eq(programSets.id, setIds[1]));
    await logSet(session.id, 2, setIds[1], 82.5);
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    expect(row.programSetId).toBe(setIds[1]);
    // A legacy payload without a set id at position 2 must not land on the deleted set.
    const r = await logWorkoutSet({
      sessionId: session.id,
      exerciseId,
      setNumber: 2,
      targetReps: 8,
      actualReps: 8,
      weightKg: 82.5,
      restTimeSeconds: 90,
      isCompleted: true,
      isFailed: false,
      wasEasy: false,
    });
    expect(r.success).toBe(true);
    const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    expect(rows.filter((x) => x.programSetId === setIds[1])).toHaveLength(1);
  });

  it("the working-set count skips deleted sets", async () => {
    const session = await createSession(userId, programId);
    await db.update(programSets).set({ deletedAt: new Date() }).where(eq(programSets.id, setIds[2]));
    await logSet(session.id, 1, setIds[0], 80);
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    expect(row.prescribedWorkingSets).toBe(2);
  });
});

describe("retention", () => {
  it("drops year-old revisions but keeps each object's newest, and purges programs deleted 90 days ago", async () => {
    await updateProgram({ id: programId, name: "One" });
    await updateProgram({ id: programId, name: "Two" });
    const old = new Date(Date.now() - 400 * 86_400_000);
    await db.update(planRevisions).set({ createdAt: old });
    // A second program, deleted long ago, with a logged session.
    const { program: gone } = await createProgram(userId, [{ exerciseId, sets: [{}] }]);
    const session = await createSession(userId, gone.id, { isCompleted: true });
    await deleteManyPrograms([gone.id]);
    await db.update(programs).set({ deletedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(programs.id, gone.id));

    await purgePlanRevisions();

    const left = await revisions();
    expect(left).toHaveLength(1);
    expect(left[0].action).toBe("update");
    // plan-read: includes deleted (checks the purge removed the row)
    expect(await db.select().from(programs).where(eq(programs.id, gone.id))).toHaveLength(0);
    const [s] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
    expect(s).toBeDefined();
    expect(s.programId).toBeNull();
  });

  it("account deletion removes the revisions", async () => {
    await updateProgram({ id: programId, name: "One" });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(planRevisions)).toHaveLength(0);
  });
});

describe("programExercises restore of a removed slot", () => {
  it("brings a removed slot back with its id and sets", async () => {
    await removeExerciseFromProgram(programExerciseId, programId);
    const baseline = (await revisions())[0];
    expect((await restorePlanRevision({ revisionId: baseline.id })).success).toBe(true);
    const [slot] = await db.select().from(programExercises).where(eq(programExercises.id, programExerciseId));
    expect(slot.deletedAt).toBeNull();
    expect((await setRows()).every((s) => s.deletedAt == null)).toBe(true);
  });
});
