import { db } from "@/db";
import { programExercises, users, workoutSessions, workoutSets } from "@/db/schema";
import { clearWeightStack } from "@/lib/actions/programs";
import {
  closeStaleOpenSessions,
  completeWorkoutSession,
  createWorkoutSession,
} from "@/lib/actions/workout-sessions";
import { getProgressiveSuggestions, logWorkoutSet, updateLoggedSet } from "@/lib/actions/workout-sets";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { FORGOTTEN_STACK } from "@/lib/utils/weight-stacks";
import { learnWeightStacks } from "@/lib/weight-stack-learning";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

const SLOT_TOOL = "edit_program_exercise";

let userId: string;
let programId: number;
let slot: Awaited<ReturnType<typeof createProgram>>["slots"][number];

beforeEach(async () => {
  userId = (await createUser()).id;
  const pushdown = await createExercise({ name: "Cable Pushdown", equipment: "cable" });
  const created = await createProgram(userId, [
    { exerciseId: pushdown.id, sets: [{ weightKg: "18" }, { weightKg: "18" }] },
  ]);
  programId = created.program.id;
  slot = created.slots[0];
  asUser(userId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const storedStack = async (id = slot.programExerciseId) =>
  (
    await db
      .select({ weightStack: programExercises.weightStack })
      .from(programExercises)
      .where(eq(programExercises.id, id))
  )[0].weightStack;

/** The column defaults to manual, where the app suggests no weight at all. */
const suggestsLoad = () =>
  db
    .update(programExercises)
    .set({ progressionAdvance: "load" })
    .where(eq(programExercises.id, slot.programExerciseId));

const setStack = (weightStack: string) =>
  db
    .update(programExercises)
    .set({ weightStack })
    .where(eq(programExercises.id, slot.programExerciseId));

async function logSets(sessionId: number, weights: number[], s = slot, actualReps = 8) {
  for (const [i, weightKg] of weights.entries()) {
    const result = await logWorkoutSet({
      sessionId,
      exerciseId: s.exerciseId,
      setNumber: i + 1,
      programSetId: s.setIds[i],
      actualReps,
      weightKg,
      restTimeSeconds: 90,
    });
    expect(result.success).toBe(true);
  }
}

/** One finished session at these weights, started `hoursAgo` hours back. */
async function finishedSession(weights: number[], hoursAgo = 0, actualReps = 8) {
  const session = await createSession(userId, programId, {
    startTime: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  });
  await logSets(session.id, weights, slot, actualReps);
  const done = await completeWorkoutSession({ sessionId: session.id });
  expect(done.success).toBe(true);
  return session;
}

describe("finishing a workout", () => {
  it("remembers the most common pattern containing a custom weight", async () => {
    await finishedSession([18, 18]);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("uses every working set of the session", async () => {
    await finishedSession([18, 20]);
    expect(await storedStack()).toBe("kg2");
  });

  it("picks again when a later custom weight is off the pattern", async () => {
    await finishedSession([18, 18], 2);
    await finishedSession([20, 20]);
    expect(await storedStack()).toBe("kg5");
  });

  it("keeps the pattern when later weights are on it", async () => {
    await finishedSession([18, 18], 2);
    await finishedSession([22.5, 22.5]);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("learns nothing from weights the default ladder already has", async () => {
    await finishedSession([17.5, 20]);
    expect(await storedStack()).toBeNull();
  });

  it("leaves the pattern alone when no pattern fits", async () => {
    await finishedSession([18, 18], 2);
    await finishedSession([17.3, 17.3]);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("ignores warm-up sets", async () => {
    const session = await createSession(userId, programId);
    await logSets(session.id, [17.5, 17.5]);
    await db
      .insert(workoutSets)
      .values({
        sessionId: session.id,
        exerciseId: slot.exerciseId,
        programExerciseId: slot.programExerciseId,
        setNumber: 3,
        actualReps: 8,
        weightKg: "18",
        restTimeSeconds: 90,
        setType: "warmup",
      });
    await completeWorkoutSession({ sessionId: session.id });
    expect(await storedStack()).toBeNull();
  });

  it("learns a stack whose weights all fit the default ladder from a jump between sessions", async () => {
    await finishedSession([20, 20], 2);
    expect(await storedStack()).toBeNull();
    await finishedSession([25, 25]);
    expect(await storedStack()).toBe("kg5");
  });

  it("learns nothing from accepting the app's own suggestion", async () => {
    await suggestsLoad();
    await finishedSession([20, 20], 2);
    await finishedSession([21.25, 21.25]);
    expect(await storedStack()).toBeNull();
  });

  it("learns nothing from going down", async () => {
    await finishedSession([25, 25], 2);
    await finishedSession([20, 20]);
    expect(await storedStack()).toBeNull();
  });

  it("does not treat a jump on a learned stack as news", async () => {
    await setStack("kg2_5");
    await finishedSession([20, 20], 2);
    await finishedSession([30, 30]);
    expect(await storedStack()).toBe("kg2_5");
  });

  it("learns nothing from coming back to a weight already lifted", async () => {
    await finishedSession([40, 40], 4);
    await finishedSession([35, 35], 2);
    await finishedSession([40, 40]);
    expect(await storedStack()).toBeNull();
  });

  it("still learns a step after an older, heavier session", async () => {
    await finishedSession([50, 50], 4);
    await finishedSession([20, 20], 2);
    await finishedSession([25, 25]);
    expect(await storedStack()).toBe("kg5");
  });

  it("does not learn a step from a weight that is on no shared pattern", async () => {
    await finishedSession([18.75, 18.75], 2);
    await finishedSession([22.5, 22.5]);
    expect(await storedStack()).toBeNull();
  });

  it("judges a custom weight by its own session, not the machine before it", async () => {
    await finishedSession([17.5, 17.5], 2);
    await finishedSession([18, 18]);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("learns from the first session on an endurance goal, before the app has suggested anything", async () => {
    await db.update(users).set({ goals: JSON.stringify(["endurance"]) }).where(eq(users.id, userId));
    await finishedSession([18, 18]);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("respects a manual increment that fits the weight, even on the first session", async () => {
    await db
      .update(programExercises)
      .set({ overloadIncrementKg: "1" })
      .where(eq(programExercises.id, slot.programExerciseId));
    await finishedSession([18, 18]);
    expect(await storedStack()).toBeNull();
  });

  it("learns on no equipment from a weight off the current zone's grid", async () => {
    const exercise = await createExercise({ equipment: null });
    const { program, slots } = await createProgram(userId, [
      { exerciseId: exercise.id, sets: [{ weightKg: "28" }] },
    ]);
    for (const [hoursAgo, kg] of [[2, 28], [0, 31]]) {
      const session = await createSession(userId, program.id, {
        startTime: new Date(Date.now() - hoursAgo * 3_600_000),
      });
      await logSets(session.id, [kg], slots[0]);
      await completeWorkoutSession({ sessionId: session.id });
    }
    expect(await storedStack(slots[0].programExerciseId)).toBe("kg1");
  });

  it("learns nothing from taking the app's back-off", async () => {
    await suggestsLoad();
    await finishedSession([40, 40], 8);
    for (const hoursAgo of [6, 4, 2]) await finishedSession([50, 50], hoursAgo, 4);

    const suggestions = await getProgressiveSuggestions(programId);
    if (!suggestions.success) throw new Error(suggestions.error);
    const { reason, suggestedWeightKg } = suggestions.data[slot.setIds[0]];
    expect(reason).toBe("deload");

    await finishedSession([suggestedWeightKg, suggestedWeightKg]);
    expect(await storedStack()).toBeNull();
  });

  it("measures a step from the last session, so an old weight can't make it look smaller", async () => {
    await finishedSession([22.5, 22.5], 4);
    await finishedSession([20, 20], 2);
    await finishedSession([25, 25]);
    expect(await storedStack()).toBe("kg5");
  });

  it("learns nothing from climbing back up on the app's suggestions after a deload", async () => {
    await suggestsLoad();
    await db
      .update(programExercises)
      .set({ exerciseType: "compound" })
      .where(eq(programExercises.id, slot.programExerciseId));
    await finishedSession([41.25, 41.25], 6);
    await finishedSession([37.5, 37.5], 4);
    await finishedSession([40, 40], 2);
    await finishedSession([42.5, 42.5]);
    expect(await storedStack()).toBeNull();
  });

  it("does not relearn a forgotten stack from a weight already lifted", async () => {
    await finishedSession([18, 18], 2);
    expect(await storedStack()).toBe("kg4_5");
    await clearWeightStack({ programExerciseId: slot.programExerciseId });
    await finishedSession([18, 18]);
    expect(await storedStack()).toBe(FORGOTTEN_STACK);
  });

  it("learns again after a forget from a weight not lifted before", async () => {
    await finishedSession([18, 18], 2);
    await clearWeightStack({ programExerciseId: slot.programExerciseId });
    await finishedSession([19, 19]);
    expect(await storedStack()).toBe("kg1");
  });

  it("learns nothing from coming back to a weight that wasn't a session's heaviest", async () => {
    await finishedSession([30, 30], 4);
    await finishedSession([40, 35], 2);
    await finishedSession([35, 35]);
    expect(await storedStack()).toBeNull();
  });

  it("learns from a weight off the 1.25 grid on a slot where the app suggests nothing", async () => {
    const exercise = await createExercise({ equipment: null });
    const { program, slots } = await createProgram(userId, [
      { exerciseId: exercise.id, sets: [{ weightKg: "20" }] },
    ]);
    for (const [hoursAgo, kg] of [[2, 20], [0, 21]]) {
      const session = await createSession(userId, program.id, {
        startTime: new Date(Date.now() - hoursAgo * 3_600_000),
      });
      await logSets(session.id, [kg], slots[0]);
      await completeWorkoutSession({ sessionId: session.id });
    }
    expect(await storedStack(slots[0].programExerciseId)).toBe("kg3");
  });

  it("learns nothing from a jump bigger than one step of any pattern", async () => {
    await finishedSession([10, 10], 2);
    await finishedSession([30, 30]);
    expect(await storedStack()).toBeNull();
  });

  it("corrects a wrong stack with the weights the app used to suggest", async () => {
    await setStack("kg5");
    await finishedSession([40, 40], 2);
    await finishedSession([41.25, 41.25]);
    expect(await storedStack()).toBe("kg1_25");
  });

  it("corrects a wrong stack even when the weight is the old next step", async () => {
    await setStack("kg4_5");
    await finishedSession([18, 18], 2);
    await finishedSession([18.75, 18.75]);
    expect(await storedStack()).toBe("kg1_25");
  });

  it("learns nothing from holding at a weight on the app's own grid", async () => {
    await db
      .update(programExercises)
      .set({ overloadIncrementKg: "1" })
      .where(eq(programExercises.id, slot.programExerciseId));
    await finishedSession([20, 20], 4);
    await finishedSession([21, 21], 2);
    await finishedSession([21, 21]);
    expect(await storedStack()).toBeNull();
  });

  it("learns nothing on an endurance goal's whole-kg steps, lighter sets included", async () => {
    await suggestsLoad();
    await db.update(users).set({ goals: JSON.stringify(["endurance"]) }).where(eq(users.id, userId));
    await finishedSession([25, 20], 2);
    await finishedSession([26, 21]);
    expect(await storedStack()).toBeNull();
  });

  it("does not count another exercise's weights toward a jump after a swap", async () => {
    const dumbbell = await createExercise({ equipment: "dumbbell" });
    await db
      .update(programExercises)
      .set({ exerciseId: dumbbell.id })
      .where(eq(programExercises.id, slot.programExerciseId));
    const old = await createSession(userId, programId, { startTime: new Date(Date.now() - 7_200_000) });
    await logSets(old.id, [20, 20], { ...slot, exerciseId: dumbbell.id });
    await completeWorkoutSession({ sessionId: old.id });
    await db
      .update(programExercises)
      .set({ exerciseId: slot.exerciseId })
      .where(eq(programExercises.id, slot.programExerciseId));
    await finishedSession([25, 25]);
    expect(await storedStack()).toBeNull();
  });

  it("learns on an exercise with no equipment recorded", async () => {
    const exercise = await createExercise({ equipment: null });
    const { program, slots } = await createProgram(userId, [
      { exerciseId: exercise.id, sets: [{ weightKg: "13.5" }] },
    ]);
    const session = await createSession(userId, program.id);
    await logSets(session.id, [13.5], slots[0]);
    await completeWorkoutSession({ sessionId: session.id });
    expect(await storedStack(slots[0].programExerciseId)).toBe("kg4_5");
  });

  it("ignores equipment with its own known steps", async () => {
    for (const equipment of ["dumbbell", "barbell"] as const) {
      const exercise = await createExercise({ equipment });
      const { program, slots } = await createProgram(userId, [
        { exerciseId: exercise.id, sets: [{ weightKg: "18" }] },
      ]);
      const session = await createSession(userId, program.id);
      await logSets(session.id, [18], slots[0]);
      await completeWorkoutSession({ sessionId: session.id });
      expect(await storedStack(slots[0].programExerciseId)).toBeNull();
    }
  });

  it("does not move the progression config date", async () => {
    await finishedSession([18, 18]);
    const [pe] = await db
      .select({ at: programExercises.progressionConfigAt })
      .from(programExercises)
      .where(eq(programExercises.id, slot.programExerciseId));
    expect(pe.at).toBeNull();
  });

  it("still finishes the workout if learning fails", async () => {
    const session = await createSession(userId, programId);
    await logSets(session.id, [18, 18]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The action's own ownership read goes through; the learner's first read throws.
    const realSelect = db.select.bind(db);
    vi.spyOn(db, "select")
      .mockImplementationOnce(realSelect as never)
      .mockImplementationOnce(() => {
        throw new Error("boom");
      });
    const done = await completeWorkoutSession({ sessionId: session.id });
    expect(done.success).toBe(true);
    vi.restoreAllMocks();
    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id));
    expect(row.isCompleted).toBe(true);
    expect(await storedStack()).toBeNull();
  });

  it("reaches the next suggestion", async () => {
    await db
      .update(programExercises)
      .set({ progressionAdvance: "load", progressionRequiredHits: 1, progressionScope: "all" })
      .where(eq(programExercises.id, slot.programExerciseId));
    await finishedSession([18, 18]);
    const result = await getProgressiveSuggestions(programId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[slot.setIds[0]].suggestedWeightKg).toBe(22.5);
  });
});

describe("other ways a session closes or changes", () => {
  it("learns when a forgotten session is closed from the home screen", async () => {
    const session = await createSession(userId, programId, {
      startTime: new Date(Date.now() - 11 * 60 * 60 * 1000),
    });
    await logSets(session.id, [18, 18]);
    await closeStaleOpenSessions();
    expect(await storedStack()).toBe("kg4_5");
  });

  it("learns when starting a new workout sweeps up an old one", async () => {
    const session = await createSession(userId, programId, {
      startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    await logSets(session.id, [18, 18]);
    await createWorkoutSession({ date: "2026-10-21", programId });
    expect(await storedStack()).toBe("kg4_5");
  });

  it("re-learns when the latest session's weight is corrected from history", async () => {
    const session = await finishedSession([18, 18]);
    const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    for (const row of rows) {
      await updateLoggedSet({ setId: row.id, weightKg: 19, actualReps: 8, isFailed: false, notes: null });
    }
    expect(await storedStack()).toBe("kg1");
  });

  it("does not let an edit to an older session overwrite what a newer one taught", async () => {
    const older = await finishedSession([18, 18], 48);
    await finishedSession([20, 21]);
    expect(await storedStack()).toBe("kg1");
    await db
      .update(programExercises)
      .set({ weightStack: "kg5" })
      .where(eq(programExercises.id, slot.programExerciseId));
    const [row] = await db
      .select()
      .from(workoutSets)
      .where(and(eq(workoutSets.sessionId, older.id), eq(workoutSets.setNumber, 1)));
    await updateLoggedSet({ setId: row.id, weightKg: 19, actualReps: 8, isFailed: false, notes: null });
    expect(await storedStack()).toBe("kg5");
  });
});

describe("ownership", () => {
  it("does not learn from a session id the caller does not own", async () => {
    const session = await createSession(userId, programId);
    await logSets(session.id, [18, 18]);
    const stranger = await createUser();
    await learnWeightStacks(session.id, stranger.id);
    expect(await storedStack()).toBeNull();
  });
});

describe("swapping a slot's exercise through MCP", () => {
  /** The slot tool's handler, as the MCP server would call it for this user. */
  function slotTool() {
    let handler: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
    const server = {
      registerTool(name: string, _config: unknown, fn: typeof handler) {
        if (name === SLOT_TOOL) handler = fn;
      },
    } as unknown as McpServer;
    registerProgramTools(server, userId);
    return handler!;
  }

  it("forgets the stack, which described the old exercise's machine", async () => {
    await setStack("kg4_5");
    const barbell = await createExercise({ equipment: "barbell" });
    await slotTool()({ operation: "update", programExerciseId: slot.programExerciseId, exerciseId: barbell.id });
    expect(await storedStack()).toBeNull();
  });

  it("keeps the stack when the exercise does not change", async () => {
    await setStack("kg4_5");
    await slotTool()({ operation: "update", programExerciseId: slot.programExerciseId, exerciseId: slot.exerciseId });
    expect(await storedStack()).toBe("kg4_5");
  });
});

describe("clearWeightStack", () => {
  beforeEach(async () => {
    await db
      .update(programExercises)
      .set({ weightStack: "kg4_5" })
      .where(eq(programExercises.id, slot.programExerciseId));
  });

  it("forgets the pattern for its owner", async () => {
    const result = await clearWeightStack({ programExerciseId: slot.programExerciseId });
    expect(result.success).toBe(true);
    expect(await storedStack()).toBe(FORGOTTEN_STACK);
  });

  it("refuses another user's exercise", async () => {
    asUser((await createUser()).id);
    const result = await clearWeightStack({ programExerciseId: slot.programExerciseId });
    expect(result.success).toBe(false);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("rejects invalid input", async () => {
    const result = await clearWeightStack({ programExerciseId: "x" });
    expect(result.success).toBe(false);
  });
});
