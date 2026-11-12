import { db } from "@/db";
import { planRevisions, programSets, programs } from "@/db/schema";
import { deleteProgramSet, flushWorkoutPlan, updateProgramSet } from "@/lib/actions/programs";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The finish flush (docs/plans/revisions.md, 2.7): the lifter's own plan writes
 * during the workout never count as a conflict, and the flush is one write.
 */

let userId: string;
let programId: number;
let programExerciseId: number;
let setIds: number[];

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  const ex = (await createExercise({ name: "Bench" })).id;
  const { program, slots } = await createProgram(userId, [
    { exerciseId: ex, sets: [{ weightKg: "60" }, { weightKg: "57.5" }, { weightKg: "60" }] },
  ]);
  programId = program.id;
  programExerciseId = slots[0].programExerciseId;
  setIds = slots[0].setIds;
});

const conflictRows = () =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectId, programId), eq(planRevisions.action, "conflict")));
const weightOf = async (id: number) => (await db.select().from(programSets).where(eq(programSets.id, id)))[0].weightKg;

describe("the lifter's own writes during the workout", () => {
  it("a carried weight, then the lifter's own edit of that set, is applied at finish", async () => {
    // Auto-carry when set 1 is logged (WorkoutSetsList), a plain user write.
    expect((await updateProgramSet({ id: setIds[1], weightKg: 60 })).success).toBe(true);
    // The lifter then sets 62.5 for the session; the finish flushes it.
    const r = await updateProgramSet({ id: setIds[1], targetReps: 8, weightKg: 62.5, baseVersion: 1 });
    expect(r.success).toBe(true);
    expect(await weightOf(setIds[1])).toBe("62.50");
    expect(await conflictRows()).toHaveLength(0);
  });

  it("a set the lifter deleted is skipped, with no conflict", async () => {
    await deleteProgramSet(setIds[2], programId, programExerciseId);
    const r = await updateProgramSet({ id: setIds[2], targetReps: 8, weightKg: 65, baseVersion: 1 });
    expect(r.success).toBe(true);
    expect(await conflictRows()).toHaveLength(0);
    expect(await weightOf(setIds[2])).toBe("60.00");
  });

  it("an assistant's change to the same field is still a conflict", async () => {
    const tools = new Map<string, { schema: z.ZodTypeAny; handler: (a: Record<string, unknown>) => Promise<unknown> }>();
    registerProgramTools(
      {
        registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: never) =>
          tools.set(name, { schema: z.object(config.inputSchema), handler }),
      } as unknown as McpServer,
      userId,
    );
    const t = tools.get("edit_program_exercise")!;
    await t.handler(
      t.schema.parse({
        operation: "update",
        programExerciseId,
        sets: [{ setNumber: 1, weightKg: 60 }, { setNumber: 2, weightKg: 70 }, { setNumber: 3, weightKg: 60 }],
        reason: "r",
        expectedVersion: 1,
      }) as Record<string, unknown>,
    );
    const r = await flushWorkoutPlan({ programId, baseVersion: 1, sets: [{ id: setIds[1], targetReps: 8, weightKg: 62.5 }] });
    expect(r.success && r.data.conflicts).toBe(1);
    expect(await weightOf(setIds[1])).toBe("70.00");
  });
});

describe("flushWorkoutPlan", () => {
  it("writes thirty overrides as one revision and one version step", async () => {
    const ex = (await createExercise({ name: "Row" })).id;
    const { program, slots } = await createProgram(
      userId,
      Array.from({ length: 6 }, () => ({ exerciseId: ex, sets: Array.from({ length: 5 }, () => ({ weightKg: "50" })) })),
    );
    const ids = slots.flatMap((s) => s.setIds);
    const r = await flushWorkoutPlan({
      programId: program.id,
      baseVersion: 1,
      sets: ids.map((id) => ({ id, targetReps: 8, weightKg: 52.5 })),
    });
    expect(r.success && r.data).toEqual({ applied: 30, conflicts: 0 });
    const revs = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, program.id)));
    expect(revs.map((x) => x.action)).toEqual(["baseline", "update"]);
    const [p] = await db.select({ v: programs.version }).from(programs).where(eq(programs.id, program.id));
    expect(p.v).toBe(2);
  });

  it("refuses another user's program and changes nothing", async () => {
    const other = await createUser();
    asUser(other.id);
    const r = await flushWorkoutPlan({ programId, baseVersion: 1, sets: [{ id: setIds[0], targetReps: 8, weightKg: 99 }] });
    expect(r.success).toBe(false);
    asUser(userId);
    expect(await weightOf(setIds[0])).toBe("60.00");
  });

  it("ignores a set of another program", async () => {
    const { slots } = await createProgram(userId, [{ exerciseId: (await createExercise()).id, sets: [{}] }]);
    const r = await flushWorkoutPlan({ programId, baseVersion: 1, sets: [{ id: slots[0].setIds[0], targetReps: 8, weightKg: 99 }] });
    expect(r.success && r.data.applied).toBe(0);
    expect(await weightOf(slots[0].setIds[0])).toBe("80.00");
    void createSession;
  });
});
