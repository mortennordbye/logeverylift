/**
 * Endurance steps stored as program sets (docs/plans/one-program-model.md,
 * step 1): written through the assistant, refused when a write would break
 * the exercise, and carried by every path that copies sets.
 */
import { db } from "@/db";
import { programExercises, programSets, programShares } from "@/db/schema";
import { exportProgram, importProgram, updateProgramSet } from "@/lib/actions/programs";
import { copySharedProgram } from "@/lib/actions/program-shares";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import type { Workout } from "@/lib/utils/workout-steps";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

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

const intervals: Workout = {
  v: 1,
  sport: "run",
  name: "Threshold",
  steps: [
    { type: "warmup", end: { type: "distance", meters: 2000 } },
    {
      type: "repeat",
      count: 4,
      steps: [
        { type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } },
        { type: "recovery", end: { type: "time", seconds: 120 } },
      ],
    },
    { type: "cooldown", end: { type: "lap" } },
  ],
};

const liveSets = (programExerciseId: number) =>
  db
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber));

let me: string;

beforeEach(async () => {
  me = (await createUser()).id;
});

async function runSlot() {
  const run = await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" });
  const { program } = await createProgram(me, []);
  const call = toolsFor(me);
  const added = await call("edit_program_exercise", {
    operation: "add",
    programId: program.id,
    exerciseId: run.id,
    workout: intervals,
    reason: "Test",
    expectedVersion: 1,
  });
  expect(added.isError, added.raw).toBeFalsy();
  const pe = JSON.parse(added.raw) as { id: number; programVersion: number };
  return { program, run, pe, call };
}

describe("edit_program_exercise with steps", () => {
  it("stores a step tree as one row per round and reads back the same tree", async () => {
    const { pe } = await runSlot();
    const rows = await liveSets(pe.id);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.blockId === 1).map((r) => r.blockRound)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const built = buildWorkout(rows as StepRow[], { sport: "run", name: "Threshold" });
    expect("workout" in built && built.workout).toEqual(intervals);
  });

  it("refuses steps on a strength exercise and writes nothing", async () => {
    const lift = await createExercise();
    const { program } = await createProgram(me, []);
    const call = toolsFor(me);
    const r = await call("edit_program_exercise", {
      operation: "add",
      programId: program.id,
      exerciseId: lift.id,
      sets: [{ setNumber: 1, stepKind: "work", durationSeconds: 600 }],
      reason: "Test",
      expectedVersion: 1,
    });
    expect(r.isError).toBe(true);
    expect(r.raw).toMatch(/only a swim, bike or run exercise can hold steps/);
    const slots = await db.select().from(programExercises).where(eq(programExercises.programId, program.id));
    expect(slots).toHaveLength(0);
  });

  it("refuses an update whose rounds differ, and keeps the stored rows", async () => {
    const { pe, call } = await runSlot();
    const rows = await liveSets(pe.id);
    const sets = rows.map((r) => ({
      id: r.id,
      setNumber: r.setNumber,
      stepKind: r.stepKind,
      durationSeconds: r.durationSeconds,
      distanceMeters: r.setNumber === 4 ? 800 : r.distanceMeters,
      endsOnLap: r.endsOnLap,
      blockId: r.blockId,
      blockRound: r.blockRound,
      targets: r.targets,
    }));
    const res = await call("edit_program_exercise", { operation: "update", programExerciseId: pe.id, sets, reason: "Test", expectedVersion: pe.programVersion });
    expect(res.isError).toBe(true);
    expect(res.raw).toMatch(/round 2 of the repeat block differs from round 1/);
    expect((await liveSets(pe.id)).find((r) => r.setNumber === 4)?.distanceMeters).toBe(1000);
  });
});

describe("app writes to a structured exercise", () => {
  it("refuses a one-set edit that breaks a block, and leaves strength edits alone", async () => {
    const { pe } = await runSlot();
    asUser(me);
    const rows = await liveSets(pe.id);
    const round2Work = rows.find((r) => r.blockId === 1 && r.blockRound === 2 && r.stepKind === "work")!;
    const refused = await updateProgramSet({ id: round2Work.id, distanceMeters: 400 });
    expect(refused.success).toBe(false);
    expect(!refused.success && refused.error).toMatch(/^Set 4: round 2 of the repeat block differs/);
    expect((await liveSets(pe.id)).find((r) => r.id === round2Work.id)?.distanceMeters).toBe(1000);

    const lift = await createExercise();
    const { slots } = await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }]);
    const ok = await updateProgramSet({ id: slots[0].setIds[0], targetReps: 12 });
    expect(ok.success).toBe(true);
  });
});

describe("copy paths keep the steps", () => {
  it("export and import keep every step field and the pool length", async () => {
    const swim = await createExercise({ name: `Swim ${Math.random()}`, category: "cardio", discipline: "swim" });
    const { program } = await createProgram(me, []);
    const call = toolsFor(me);
    const added = await call("edit_program_exercise", {
      operation: "add",
      programId: program.id,
      exerciseId: swim.id,
      poolLengthM: 25,
      workout: {
        v: 1,
        sport: "swim",
        name: "Swim",
        poolLengthM: 25,
        steps: [
          { type: "warmup", end: { type: "distance", meters: 400 }, stroke: "choice" },
          { type: "repeat", count: 3, steps: [{ type: "work", end: { type: "distance", meters: 100 }, sendOffSeconds: 105, equipment: ["pull_buoy"], target: { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 4 }, note: "long" }] },
        ],
      },
      reason: "Test",
      expectedVersion: 1,
    });
    expect(added.isError, added.raw).toBeFalsy();

    asUser(me);
    const exported = await exportProgram(program.id);
    expect(exported.success).toBe(true);
    if (!exported.success) return;
    const imported = await importProgram(exported.data);
    expect(imported.success, !imported.success ? imported.error : "").toBe(true);

    const slots = await db.select().from(programExercises).where(eq(programExercises.exerciseId, swim.id)).orderBy(asc(programExercises.id));
    expect(slots).toHaveLength(2);
    expect(slots[1].poolLengthM).toBe(25);
    const pick = (r: typeof programSets.$inferSelect) => [r.setNumber, r.stepKind, r.distanceMeters, r.stroke, r.equipment, r.sendOffSeconds, r.targets, r.blockId, r.blockRound, r.note];
    expect((await liveSets(slots[1].id)).map(pick)).toEqual((await liveSets(slots[0].id)).map(pick));
  });

  it("a shared program arrives with its steps", async () => {
    const { program, pe } = await runSlot();
    const friend = (await createUser()).id;
    const [share] = await db.insert(programShares).values({ programId: program.id, sharedByUserId: me, sharedWithUserId: friend }).returning();
    asUser(friend);
    const copied = await copySharedProgram({ shareId: share.id });
    expect(copied.success, !copied.success ? copied.error : "").toBe(true);
    if (!copied.success) return;
    const [slot] = await db.select().from(programExercises).where(eq(programExercises.programId, copied.data.programId));
    const pick = (r: typeof programSets.$inferSelect) => [r.setNumber, r.stepKind, r.distanceMeters, r.durationSeconds, r.endsOnLap, r.targets, r.blockId, r.blockRound];
    expect((await liveSets(slot.id)).map(pick)).toEqual((await liveSets(pe.id)).map(pick));
  });
});

describe("a structured program session in compliance (step 2)", () => {
  it("plans it from its steps: time, distance, hard flag and summary", async () => {
    const { trainingCycles, trainingCycleSlots } = await import("@/db/schema");
    const { getActiveCycleForUser } = await import("@/lib/actions/training-cycles");
    const { sessionCompliance } = await import("@/lib/session-compliance");
    const { workoutToRows } = await import("@/lib/utils/program-steps");
    const { estimateWorkout } = await import("@/lib/utils/workout-steps");
    const { vi } = await import("vitest");

    const user = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    asUser(user);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    try {
      const run = await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" });
      const timed: Workout = {
        v: 1,
        sport: "run",
        name: "Threshold",
        steps: [
          { type: "warmup", end: { type: "time", seconds: 600 } },
          { type: "repeat", count: 4, steps: [{ type: "work", end: { type: "time", seconds: 240 }, target: { metric: "hr", anchor: "lthr", zone: 4 } }, { type: "recovery", end: { type: "time", seconds: 120 } }] },
        ],
      };
      const steady: Workout = { v: 1, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 2700 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] };
      const asSets = (w: Workout) => workoutToRows(w).map((r) => ({ ...r, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
      const hardP = await createProgram(user, [{ exerciseId: run.id, sets: asSets(timed) }]);
      const easyP = await createProgram(user, [{ exerciseId: run.id, sets: asSets(steady) }]);

      const [c] = await db.insert(trainingCycles).values({ userId: user, name: "Block", durationWeeks: 2, status: "active", startDate: "2026-11-02" }).returning();
      await db.insert(trainingCycleSlots).values([
        { trainingCycleId: c.id, daySlot: 1, dayOfWeek: 2, programId: hardP.program.id },
        { trainingCycleId: c.id, daySlot: 1, dayOfWeek: 4, programId: easyP.program.id },
      ]);
      await getActiveCycleForUser();
      const week = await sessionCompliance(user, "2026-11-02", "2026-11-08", { cycleId: c.id });
      const hardS = week.find((s) => s.programId === hardP.program.id)!;
      const easyS = week.find((s) => s.programId === easyP.program.id)!;

      expect(hardS.planned.durationSeconds).toBe(estimateWorkout(timed).durationSeconds);
      expect(hardS.hard).toBe(true);
      expect(hardS.programWorkouts).toHaveLength(1);
      expect(hardS.workoutSummary).toMatch(/^10 min warm-up · 4 × \(4 min Z4 HR, 2 min easy\)/);
      expect(easyS.planned.durationSeconds).toBe(2700);
      expect(easyS.hard).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
