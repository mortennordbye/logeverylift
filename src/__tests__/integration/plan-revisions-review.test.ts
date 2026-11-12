import { db } from "@/db";
import { planRevisions, programExercises, programs, trainingCycles, workoutSets } from "@/db/schema";
import { deleteCustomExercise } from "@/lib/actions/exercises";
import {
  applyRejectedChange,
  getDeletedPlans,
  restorePlanRevision,
  undoPlanChangeSet,
} from "@/lib/actions/plan-revisions";
import { deleteManyPrograms, updateProgram, updateProgramSet } from "@/lib/actions/programs";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { planWrite, purgePlanRevisions } from "@/lib/plan-revisions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/** Fixes from the review of the revision layer (docs/plans/revisions.md). */

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
function mcp(userId: string) {
  const tools = new Map<string, { schema: z.ZodTypeAny; handler: Handler }>();
  registerProgramTools(
    {
      registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: Handler) =>
        tools.set(name, { schema: z.object(config.inputSchema), handler }),
    } as unknown as McpServer,
    userId,
  );
  return async (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name)!;
    return tool.handler(tool.schema.parse(args) as Record<string, unknown>);
  };
}

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

let userId: string;
let exerciseId: number;
let programId: number;
let programExerciseId: number;
let setIds: number[];

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Bench" })).id;
  const { program, slots } = await createProgram(userId, [{ exerciseId, sets: [{}, {}] }]);
  programId = program.id;
  programExerciseId = slots[0].programExerciseId;
  setIds = slots[0].setIds;
});

const revisionsOf = (id: number) =>
  db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, id)));

describe("retention", () => {
  it("does not take a recently deleted generated program down with its long-deleted cycle", async () => {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Old block", durationWeeks: 4, deletedAt: days(100) })
      .returning();
    await db.update(programs).set({ createdByCycleId: cycle.id }).where(eq(programs.id, programId));
    await deleteManyPrograms([programId]);
    await db.update(programs).set({ deletedAt: days(10) }).where(eq(programs.id, programId));

    await purgePlanRevisions();

    // plan-read: includes deleted (checks the purge kept the row)
    const [kept] = await db.select().from(programs).where(eq(programs.id, programId));
    expect(kept).toBeDefined();
    expect((await revisionsOf(programId)).length).toBeGreaterThan(0);
  });

  it("does not leave revisions behind for a program purged with its cycle", async () => {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Old block", durationWeeks: 4, deletedAt: days(100) })
      .returning();
    await db.update(programs).set({ createdByCycleId: cycle.id }).where(eq(programs.id, programId));
    await deleteManyPrograms([programId]);
    await db.update(programs).set({ deletedAt: days(100) }).where(eq(programs.id, programId));
    await purgePlanRevisions();
    expect(await revisionsOf(programId)).toHaveLength(0);
  });

  it("keeps the newest real snapshot when only a conflict row is newer", async () => {
    await updateProgram({ id: programId, name: "Renamed" });
    await mcp(userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [{ setNumber: 1, weightKg: 100 }, { setNumber: 2, weightKg: 80 }],
      reason: "r",
      expectedVersion: 2,
    });
    await updateProgramSet({ id: setIds[0], weightKg: 82.5, baseVersion: 2 });
    await db.update(planRevisions).set({ createdAt: days(400) }).where(eq(planRevisions.objectId, programId));
    await purgePlanRevisions();
    const left = await revisionsOf(programId);
    expect(left.some((r) => r.action !== "conflict")).toBe(true);
  });
});

describe("locks", () => {
  it("a plan write in progress does not hold up starting a workout on that program", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let touched!: () => void;
    const isTouched = new Promise<void>((r) => (touched = r));
    const write = planWrite({ userId, writer: "user" }, async (w) => {
      await w.touch({ type: "program", id: programId });
      touched();
      await held;
    });
    await isTouched;
    // A new session row takes a KEY SHARE lock on its program.
    const started = await Promise.race([
      createSession(userId, programId).then(() => "started"),
      new Promise((r) => setTimeout(() => r("blocked"), 1500)),
    ]);
    release();
    await write;
    expect(started).toBe("started");
  });
});

describe("the MCP set list", () => {
  it("applies nothing when the set list is refused, not even the slot fields", async () => {
    const r = await mcp(userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      notes: "Should not stick",
      sets: [{ id: 999999, setNumber: 1, weightKg: 100 }],
      reason: "r",
      expectedVersion: 1,
    });
    expect(r.isError).toBe(true);
    const [slot] = await db.select().from(programExercises).where(eq(programExercises.id, programExerciseId));
    expect(slot.notes).toBeNull();
    expect(await revisionsOf(programId)).toHaveLength(0);
    const [p] = await db.select({ v: programs.version }).from(programs).where(eq(programs.id, programId));
    expect(p.v).toBe(1);
  });
});

describe("restore", () => {
  it("skips a slot whose exercise is another user's custom exercise", async () => {
    const other = await createUser();
    const theirs = await createExercise({ name: "Their move", isCustom: true, userId: other.id });
    await updateProgram({ id: programId, name: "Renamed" });
    const [baseline] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectId, programId), eq(planRevisions.action, "baseline")));
    const snap = baseline.snapshot as { exercises: { exerciseId: number }[] };
    snap.exercises[0].exerciseId = theirs.id;
    await db.update(planRevisions).set({ snapshot: snap }).where(eq(planRevisions.id, baseline.id));

    const r = await restorePlanRevision({ revisionId: baseline.id });
    expect(r.success).toBe(true);
    const [slot] = await db.select().from(programExercises).where(eq(programExercises.id, programExerciseId));
    expect(slot.exerciseId).toBe(exerciseId);
  });
});

describe("deleteCustomExercise", () => {
  it("says a friend's copy has logged sets, not the user's history", async () => {
    const custom = await createExercise({ name: "Shared move", isCustom: true, userId });
    const friend = await createUser();
    const { program, slots } = await createProgram(friend.id, [{ exerciseId: custom.id, sets: [{}] }]);
    const session = await createSession(friend.id, program.id);
    await db.insert(workoutSets).values({
      sessionId: session.id,
      exerciseId: custom.id,
      programSetId: slots[0].setIds[0],
      setNumber: 1,
      actualReps: 8,
      weightKg: "40",
      restTimeSeconds: 0,
    });
    await db.update(programs).set({ deletedAt: new Date() }).where(eq(programs.id, program.id));
    asUser(userId);
    const r = await deleteCustomExercise(custom.id);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).not.toMatch(/your history/);
      expect(r.error).toMatch(/friend/);
    }
  });
});

describe("another user's calls", () => {
  it("cannot undo a change set, apply a rejected change, or list deleted plans", async () => {
    await mcp(userId)("update_program", { programId, name: "AI", reason: "r", expectedVersion: 1 });
    const [rev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectId, programId), eq(planRevisions.writer, "assistant")));
    await mcp(userId)("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [{ setNumber: 1, weightKg: 100 }, { setNumber: 2, weightKg: 80 }],
      reason: "r",
      expectedVersion: 2,
    });
    await updateProgramSet({ id: setIds[0], weightKg: 82.5, baseVersion: 2 });
    const [conflict] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectId, programId), eq(planRevisions.action, "conflict")));
    await deleteManyPrograms([programId]);

    const other = await createUser();
    asUser(other.id);
    expect((await undoPlanChangeSet({ changeSetId: rev.changeSetId! })).success).toBe(false);
    expect((await applyRejectedChange({ revisionId: conflict.id })).success).toBe(false);
    const deleted = await getDeletedPlans({ type: "program" });
    expect(deleted.success && deleted.data).toEqual([]);

    asUser(userId);
    // plan-read: includes deleted (checks nothing changed)
    const [p] = await db.select().from(programs).where(eq(programs.id, programId));
    expect(p.name).toBe("AI");
    expect(p.deletedAt).not.toBeNull();
  });
});
