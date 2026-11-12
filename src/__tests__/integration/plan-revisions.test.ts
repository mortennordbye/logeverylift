import { db } from "@/db";
import { programSets, workoutSets } from "@/db/schema";
import { deleteCustomExercise } from "@/lib/actions/exercises";
import { deleteProgramSet } from "@/lib/actions/programs";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Package A4 (docs/plans/revisions.md): plan writes keep ids and never unlink
 * or delete a logged set.
 */

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function toolsFor(userId: string) {
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
let sessionId: number;

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
  sessionId = (await createSession(userId, programId)).id;
});

async function logSet(position: number, programSetId: number, weightKg: number) {
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

const loggedRows = () =>
  db
    .select({ id: workoutSets.id, programSetId: workoutSets.programSetId, programExerciseId: workoutSets.programExerciseId })
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, sessionId))
    .orderBy(asc(workoutSets.id));

describe("deleteProgramSet", () => {
  it("keeps the logged row linked to the deleted plan set", async () => {
    await logSet(2, setIds[1], 82.5);
    const r = await deleteProgramSet(setIds[1], programId, programExerciseId);
    expect(r.success).toBe(true);
    const rows = await loggedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].programSetId).toBe(setIds[1]);
  });
});

describe("MCP edit_program_exercise with sets during an open workout", () => {
  it("updates the sets in place, so ids stay and logged rows keep their links", async () => {
    await logSet(1, setIds[0], 80);
    const call = toolsFor(userId);
    const result = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId,
      sets: [
        { setNumber: 1, targetReps: 6, weightKg: 90 },
        { setNumber: 2, targetReps: 6, weightKg: 90 },
        { setNumber: 3, targetReps: 6, weightKg: 90 },
      ],
      reason: "Heavier triples",
      expectedVersion: 1,
    });
    expect(result.isError).toBeFalsy();
    const sets = await db
      .select({ id: programSets.id, weightKg: programSets.weightKg })
      .from(programSets)
      .where(eq(programSets.programExerciseId, programExerciseId))
      .orderBy(asc(programSets.setNumber));
    expect(sets.map((s) => s.id)).toEqual(setIds);
    expect(sets.map((s) => s.weightKg)).toEqual(["90.00", "90.00", "90.00"]);
    const rows = await loggedRows();
    expect(rows[0].programSetId).toBe(setIds[0]);
  });
});

describe("deleteCustomExercise", () => {
  it("refuses an exercise with logged sets, and the logged sets stay", async () => {
    const custom = await createExercise({ name: "My Press", isCustom: true, userId });
    const { program, slots } = await createProgram(userId, [{ exerciseId: custom.id, sets: [{}] }]);
    const session = await createSession(userId, program.id);
    const r0 = await logWorkoutSet({
      sessionId: session.id,
      exerciseId: custom.id,
      setNumber: 1,
      programSetId: slots[0].setIds[0],
      targetReps: 8,
      actualReps: 8,
      weightKg: 40,
      restTimeSeconds: 90,
      isCompleted: true,
      isFailed: false,
      wasEasy: false,
    });
    expect(r0.success).toBe(true);

    const r = await deleteCustomExercise(custom.id);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/logged/i);
    const rows = await db.select().from(workoutSets).where(eq(workoutSets.exerciseId, custom.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses an exercise used in a live program and names the program", async () => {
    const custom = await createExercise({ name: "My Row", isCustom: true, userId });
    const { program } = await createProgram(userId, [{ exerciseId: custom.id, sets: [{}] }]);
    const r = await deleteCustomExercise(custom.id);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain(program.name);
  });

  it("still deletes an unused custom exercise", async () => {
    const custom = await createExercise({ name: "Unused", isCustom: true, userId });
    const r = await deleteCustomExercise(custom.id);
    expect(r.success).toBe(true);
  });
});
