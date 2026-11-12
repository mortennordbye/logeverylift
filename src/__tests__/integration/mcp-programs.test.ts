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
    const result = await tool.handler(parsed.data);
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

    for (const exerciseId of [system.id, mine.id]) {
      const result = await call("edit_program_exercise", { operation: "update", programExerciseId: id, exerciseId });
      expect(result.isError).toBeFalsy();
      const [slot] = await db
        .select({ exerciseId: programExercises.exerciseId })
        .from(programExercises)
        .where(eq(programExercises.id, id));
      expect(slot.exerciseId).toBe(exerciseId);
    }
  });
});
