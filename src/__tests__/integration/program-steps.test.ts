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

describe("logging a structured program session (step 3)", () => {
  const timed: Workout = {
    v: 1,
    sport: "run",
    name: "Threshold",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 600 } },
      { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } }, { type: "recovery", end: { type: "time", seconds: 120 } }] },
    ],
  };

  async function plannedRun(user: string, w: Workout = timed) {
    const { trainingCycles, trainingCycleSlots, plannedSessions } = await import("@/db/schema");
    const { getActiveCycleForUser } = await import("@/lib/actions/training-cycles");
    const { workoutToRows } = await import("@/lib/utils/program-steps");
    const run = await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" });
    const { program, slots } = await createProgram(user, [{ exerciseId: run.id, sets: workoutToRows(w).map((r) => ({ ...r, targetReps: null, weightKg: null, restTimeSeconds: 0 })) }]);
    const [c] = await db.insert(trainingCycles).values({ userId: user, name: "Block", durationWeeks: 1, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, daySlot: 1, dayOfWeek: 1, programId: program.id });
    await getActiveCycleForUser();
    const [ps] = await db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, c.id), eq(plannedSessions.date, "2026-11-02")));
    return { run, program, slot: slots[0], plannedSessionId: ps.id };
  }

  async function withClock<T>(fn: (user: string) => Promise<T>) {
    const { vi } = await import("vitest");
    const user = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    asUser(user);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));
    try {
      return await fn(user);
    } finally {
      vi.useRealTimers();
    }
  }

  it("a player save writes one set per step with its status, plan copy and the session RPE, once", async () => {
    await withClock(async (user) => {
      const { saveStepResults, getStepResults } = await import("@/lib/step-results");
      const { plannedSessionView } = await import("@/lib/planned-view");
      const { workoutSessions, workoutSets } = await import("@/db/schema");
      const { run, program, plannedSessionId } = await plannedRun(user);

      const view = await plannedSessionView(user, plannedSessionId);
      expect(view?.player.steps.map((s) => s.key)).toEqual(["s1", "s3#1", "s4#1", "s3#2", "s4#2"]);
      const steps = [
        { key: "s1", status: "done", activeSeconds: 600 },
        { key: "s3#1", status: "done", activeSeconds: 250, distanceMeters: 1000, value: 4.1 },
        { key: "s4#1", status: "done", activeSeconds: 120, extendedSeconds: 30 },
        { key: "s3#2", status: "partial", activeSeconds: 180, distanceMeters: 700 },
        { key: "s4#2", status: "skipped" },
      ];
      const saved = await saveStepResults(user, { plannedSessionId, steps, sessionRpe: 8, clientKey: "run-abc-12345", pausedSeconds: 40, startedAt: new Date("2026-11-02T17:00:00Z") }, "player");
      expect(saved.created).toBe("session");
      const again = await saveStepResults(user, { plannedSessionId, steps, clientKey: "run-abc-12345" }, "player");
      expect(again).toMatchObject({ created: "repeat", workoutSessionId: saved.workoutSessionId });

      const [ws] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, saved.workoutSessionId));
      expect(ws).toMatchObject({ programId: program.id, plannedSessionId, pausedSeconds: 40, clientKey: "run-abc-12345", isCompleted: true });
      const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, ws.id)).orderBy(asc(workoutSets.setNumber));
      expect(sets.map((s) => [s.setNumber, s.stepStatus, s.isCompleted, s.durationSeconds, s.distanceMeters, s.rpe])).toEqual([
        [1, "done", true, 600, null, 8],
        [2, "done", true, 250, 1000, 8],
        [3, "done", true, 120, null, 8],
        [4, "partial", true, 180, 700, 8],
        [5, "skipped", false, null, null, null],
      ]);
      expect(sets[1]).toMatchObject({ measuredValue: 4.1, exerciseId: run.id });
      expect(sets[2].extendedSeconds).toBe(30);
      expect((sets[1].plannedStep as { step: { type: string } }).step.type).toBe("work");

      const results = await getStepResults(user, { plannedSessionId });
      expect(results?.rows.map((r) => [r.key, r.result?.status ?? null])).toEqual([["s1", "done"], ["s3#1", "done"], ["s4#1", "done"], ["s3#2", "partial"], ["s4#2", "skipped"]]);
      expect(results?.sessionRpe).toBe(8);
    });
  });

  it("a guided save takes over the workout the workout screen left open, and ends it", async () => {
    await withClock(async (user) => {
      const { saveStepResults } = await import("@/lib/step-results");
      const { createSession } = await import("./factories");
      const { workoutSessions } = await import("@/db/schema");
      const { program, plannedSessionId } = await plannedRun(user);
      const open = await createSession(user, program.id, { date: "2026-11-02", startTime: new Date("2026-11-02T17:00:00Z") });
      const steps = [{ key: "s1", status: "done", activeSeconds: 600 }];
      const r = await saveStepResults(user, { plannedSessionId, steps, clientKey: "run-open-123456" }, "player");
      expect(r).toMatchObject({ created: "attached", workoutSessionId: open.id });
      const all = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, user));
      expect(all.map((x) => [x.id, x.plannedSessionId, x.isCompleted])).toEqual([[open.id, plannedSessionId, true]]);
    });
  });

  it("a guided save joins the open workout that holds the hand-logged steps and never undoes them", async () => {
    await withClock(async (user) => {
      const { saveStepResults } = await import("@/lib/step-results");
      const { logWorkoutSet } = await import("@/lib/actions/workout-sets");
      const { createSession } = await import("./factories");
      const { workoutSessions, workoutSets } = await import("@/db/schema");
      const { run, program, slot, plannedSessionId } = await plannedRun(user);
      const logged = await createSession(user, program.id, { date: "2026-11-02", startTime: new Date("2026-11-02T17:00:00Z") });
      const r = await logWorkoutSet({ sessionId: logged.id, exerciseId: run.id, setNumber: 2, programSetId: slot.setIds[1], actualReps: 0, weightKg: 0, distanceMeters: 1000, durationSeconds: 245, restTimeSeconds: 0, isCompleted: true, isFailed: false, wasEasy: false, rpe: 8 });
      expect(r.success).toBe(true);
      // A second, empty open workout of the same program, opened later (a fresh sign-in on the workout page).
      const empty = await createSession(user, program.id, { date: "2026-11-02", startTime: new Date("2026-11-02T17:30:00Z") });

      const saved = await saveStepResults(user, { plannedSessionId, steps: [{ key: "s1", status: "done", activeSeconds: 600 }, { key: "s3#1", status: "skipped" }] }, "player");
      expect(saved.workoutSessionId).toBe(logged.id);
      const [step2] = await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, logged.id), eq(workoutSets.programSetId, slot.setIds[1])));
      expect(step2).toMatchObject({ stepStatus: "done", isCompleted: true, distanceMeters: 1000, durationSeconds: 245 });
      const [other] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, empty.id));
      expect(other.isCompleted).toBe(false);
    });
  });

  it("the workout screen stops offering Start guided once today's session is done", async () => {
    await withClock(async (user) => {
      const { saveStepResults } = await import("@/lib/step-results");
      const { programStepsView } = await import("@/lib/program-steps-view");
      const { program, plannedSessionId } = await plannedRun(user);
      expect((await programStepsView(user, program.id))?.guided.href).toBe(`/planned/${plannedSessionId}/play`);
      await saveStepResults(user, { plannedSessionId, steps: [{ key: "s1", status: "done", activeSeconds: 600 }] }, "player");
      expect((await programStepsView(user, program.id))?.guided.href).toBeNull();
    });
  });

  it("records one distance PR for the session's steps together", async () => {
    await withClock(async (user) => {
      const { saveStepResults } = await import("@/lib/step-results");
      const { exercisePrs } = await import("@/db/schema");
      const { run, plannedSessionId } = await plannedRun(user);
      const steps = [
        { key: "s1", status: "done", activeSeconds: 600, distanceMeters: 2000 },
        { key: "s3#1", status: "done", activeSeconds: 250, distanceMeters: 1000 },
        { key: "s4#1", status: "done", activeSeconds: 120, distanceMeters: 300 },
        { key: "s3#2", status: "done", activeSeconds: 250, distanceMeters: 1000 },
        { key: "s4#2", status: "done", activeSeconds: 120, distanceMeters: 300 },
      ];
      await saveStepResults(user, { plannedSessionId, steps }, "manual");
      const prs = await db.select().from(exercisePrs).where(and(eq(exercisePrs.userId, user), eq(exercisePrs.exerciseId, run.id), eq(exercisePrs.prType, "distance")));
      expect(prs).toHaveLength(1);
      expect(Number(prs[0].value)).toBe(4600);
    });
  });

  it("a set logged by hand on a step keeps its plan and counts toward the session's effort", async () => {
    await withClock(async (user) => {
      const { logWorkoutSet } = await import("@/lib/actions/workout-sets");
      const { createSession } = await import("./factories");
      const { workoutSets, exercisePrs } = await import("@/db/schema");
      const { run, program, slot } = await plannedRun(user);
      const session = await createSession(user, program.id);
      for (const [i, id] of slot.setIds.slice(0, 2).entries()) {
        const r = await logWorkoutSet({ sessionId: session.id, exerciseId: run.id, setNumber: i + 1, programSetId: id, actualReps: 0, weightKg: 0, distanceMeters: i === 0 ? 2000 : 1000, durationSeconds: 600, restTimeSeconds: 0, isCompleted: true, isFailed: false, wasEasy: false, rpe: 7 });
        expect(r.success, !r.success ? r.error : "").toBe(true);
      }
      const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id)).orderBy(asc(workoutSets.setNumber));
      expect(sets.map((s) => [s.stepStatus, (s.plannedStep as { step: { type: string } } | null)?.step.type])).toEqual([["done", "warmup"], ["done", "work"]]);
      const prs = await db.select().from(exercisePrs).where(and(eq(exercisePrs.userId, user), eq(exercisePrs.exerciseId, run.id), eq(exercisePrs.prType, "distance")));
      expect(prs.filter((p) => p.supersededAt == null).map((p) => Number(p.value))).toEqual([3000]);
    });
  });
});

describe("saving steps from the editor (step 4)", () => {
  it("keeps set ids and a weekly-sync anchor outside blocks, drops it inside, and refuses another sport", async () => {
    const { saveExerciseSteps } = await import("@/lib/actions/program-steps");
    const user = (await createUser({ enduranceEnabled: true })).id;
    asUser(user);
    const run = await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" });
    const { slots } = await createProgram(user, [
      {
        exerciseId: run.id,
        sets: [
          { targetReps: null, weightKg: null, distanceMeters: 8000, peakDistanceMeters: 16000, sessionRole: null },
          { targetReps: null, weightKg: null, distanceMeters: 1000, peakDistanceMeters: 1000, sessionRole: "work", targetHeartRateZone: 4 },
        ],
      },
    ]);
    const pe = slots[0].programExerciseId;
    const tree: Workout = {
      v: 1,
      sport: "run",
      name: "Long",
      steps: [
        { type: "work", end: { type: "distance", meters: 8000 } },
        { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "distance", meters: 1000 } }] },
      ],
    };
    const r = await saveExerciseSteps({ programExerciseId: pe, workout: tree });
    expect(r.success, !r.success ? r.error : "").toBe(true);
    const rows = await liveSets(pe);
    expect(rows.map((x) => x.id).slice(0, 2)).toEqual(slots[0].setIds);
    expect(rows.map((x) => [x.stepKind, x.blockId, x.peakDistanceMeters, x.targetHeartRateZone])).toEqual([
      ["work", null, 16000, null],
      ["work", 1, null, null],
      ["work", 1, null, null],
    ]);

    const bike = await saveExerciseSteps({ programExerciseId: pe, workout: { ...tree, sport: "bike" } });
    expect(bike.success).toBe(false);

    const lift = await createExercise();
    const { slots: liftSlots } = await createProgram(user, [{ exerciseId: lift.id, sets: [{}] }]);
    const refused = await saveExerciseSteps({ programExerciseId: liftSlots[0].programExerciseId, workout: tree });
    expect(refused.success).toBe(false);
  });
});
