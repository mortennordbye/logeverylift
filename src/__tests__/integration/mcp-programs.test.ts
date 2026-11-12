import { db } from "@/db";
import { programExercises, programSets } from "@/db/schema";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

/**
 * The program tools as one token's holder reaches them. The input is parsed
 * with the tool's own schema first, as the MCP SDK does before it calls the
 * handler, so a key the schema drops is dropped here too.
 */
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

let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
});

const setsOf = (programExerciseId: number) =>
  db
    .select()
    .from(programSets)
    .where(eq(programSets.programExerciseId, programExerciseId))
    .orderBy(asc(programSets.setNumber));

describe("edit_program_exercise update with sets", () => {
  it("stores every planned-set field the tool accepts", async () => {
    const lift = await createExercise();
    const { slots } = await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }]);
    const call = toolsFor(me);

    const result = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      reason: "Test",
      expectedVersion: 1,
      sets: [
        {
          setNumber: 1,
          targetReps: 10,
          repRangeMin: 8,
          repRangeMax: 12,
          targetRir: 2,
          targetHeartRateZone: 4,
          sessionRole: "work",
          startDelaySeconds: 10,
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const [set] = await setsOf(slots[0].programExerciseId);
    expect(set).toMatchObject({
      repRangeMin: 8,
      repRangeMax: 12,
      targetRir: 2,
      targetHeartRateZone: 4,
      sessionRole: "work",
      startDelaySeconds: 10,
    });
  });

  it("fails on an unknown set field and changes nothing", async () => {
    const lift = await createExercise();
    const { slots } = await createProgram(me, [{ exerciseId: lift.id, sets: [{ targetReps: 5 }] }]);
    const call = toolsFor(me);

    const result = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      reason: "Test",
      expectedVersion: 1,
      sets: [{ setNumber: 1, targetReps: 10, targetRpe: 8 }],
    });

    expect(result.isError).toBe(true);
    expect(result.raw).toContain("targetRpe");
    const [set] = await setsOf(slots[0].programExerciseId);
    expect(set.targetReps).toBe(5);
  });

  it("refuses a rep range whose min is above its max", async () => {
    const lift = await createExercise();
    const { slots } = await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }]);
    const result = await toolsFor(me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      reason: "Test",
      expectedVersion: 1,
      sets: [{ setNumber: 1, repRangeMin: 12, repRangeMax: 8 }],
    });
    expect(result.isError).toBe(true);
  });
});

describe("edit_program_exercise update with an exerciseId", () => {
  it("refuses another user's custom exercise and keeps the slot's exercise", async () => {
    const lift = await createExercise();
    const theirs = await createExercise({ userId: other });
    const { slots } = await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }]);

    const result = await toolsFor(me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      reason: "Test",
      expectedVersion: 1,
      exerciseId: theirs.id,
    });

    expect(result.isError).toBe(true);
    const [slot] = await db
      .select({ exerciseId: programExercises.exerciseId })
      .from(programExercises)
      .where(eq(programExercises.id, slots[0].programExerciseId));
    expect(slot.exerciseId).toBe(lift.id);
  });

  it("accepts a system exercise and the user's own custom exercise", async () => {
    const lift = await createExercise();
    const system = await createExercise();
    const mine = await createExercise({ userId: me });
    const { slots } = await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }]);
    const call = toolsFor(me);
    const id = slots[0].programExerciseId;

    for (const [i, exerciseId] of [system.id, mine.id].entries()) {
      const result = await call("edit_program_exercise", {
        operation: "update",
        programExerciseId: id,
        exerciseId,
        reason: "Test",
        expectedVersion: i + 1,
      });
      expect(result.isError).toBeFalsy();
      const [slot] = await db
        .select({ exerciseId: programExercises.exerciseId })
        .from(programExercises)
        .where(eq(programExercises.id, id));
      expect(slot.exerciseId).toBe(exerciseId);
    }
  });
});

describe("edit_program_exercise on a set the weekly sync owns", () => {
  // A "work" set with a peak anchor: the sync sets its zone and rest by phase.
  async function workSet() {
    const run = await createExercise({ category: "cardio", discipline: "run" });
    const { program, slots } = await createProgram(me, [
      {
        exerciseId: run.id,
        sets: [{ durationSeconds: 300, peakDurationSeconds: 300, sessionRole: "work", targetHeartRateZone: 4, restTimeSeconds: 120, targetReps: null }],
      },
    ]);
    return { programId: program.id, programExerciseId: slots[0].programExerciseId, setId: slots[0].setIds[0] };
  }
  const update = (w: Awaited<ReturnType<typeof workSet>>, set: Record<string, unknown>) =>
    toolsFor(me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: w.programExerciseId,
      sets: [{ id: w.setId, setNumber: 1, durationSeconds: 300, ...set }],
      reason: "Test",
      expectedVersion: 1,
    });

  it("refuses a different zone or rest and changes nothing", async () => {
    const w = await workSet();
    const zone = await update(w, { targetHeartRateZone: 3 });
    expect(zone.isError).toBe(true);
    expect(zone.raw).toContain("send sessionRole: null");
    expect((await update(w, { restTimeSeconds: 60 })).isError).toBe(true);
    const [set] = await setsOf(w.programExerciseId);
    expect(set).toMatchObject({ targetHeartRateZone: 4, restTimeSeconds: 120, sessionRole: "work" });
  });

  it("keeps the sync's zone and rest when the set list leaves them out", async () => {
    const w = await workSet();
    const result = await update(w, { durationSeconds: 360 });
    expect(result.isError, result.raw).toBeFalsy();
    const [set] = await setsOf(w.programExerciseId);
    expect(set).toMatchObject({ durationSeconds: 360, targetHeartRateZone: 4, restTimeSeconds: 120 });
  });

  it("applies them once sessionRole null takes the set out of the sync's control", async () => {
    const w = await workSet();
    const result = await update(w, { sessionRole: null, targetHeartRateZone: 2, restTimeSeconds: 30 });
    expect(result.isError, result.raw).toBeFalsy();
    const [set] = await setsOf(w.programExerciseId);
    expect(set).toMatchObject({ sessionRole: null, targetHeartRateZone: 2, restTimeSeconds: 30 });
  });
});
