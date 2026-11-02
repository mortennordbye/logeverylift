import { db } from "@/db";
import { programExercises, workoutSets } from "@/db/schema";
import { clearWeightStack } from "@/lib/actions/programs";
import {
  closeStaleOpenSessions,
  completeWorkoutSession,
  createWorkoutSession,
} from "@/lib/actions/workout-sessions";
import { getProgressiveSuggestions, logWorkoutSet, updateLoggedSet } from "@/lib/actions/workout-sets";
import { learnWeightStacks } from "@/lib/weight-stack-learning";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

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

async function logSets(sessionId: number, weights: number[], s = slot) {
  for (const [i, weightKg] of weights.entries()) {
    const result = await logWorkoutSet({
      sessionId,
      exerciseId: s.exerciseId,
      setNumber: i + 1,
      programSetId: s.setIds[i],
      actualReps: 8,
      weightKg,
      restTimeSeconds: 90,
    });
    expect(result.success).toBe(true);
  }
}

/** One finished session at these weights, started `hoursAgo` hours back. */
async function finishedSession(weights: number[], hoursAgo = 0) {
  const session = await createSession(userId, programId, {
    startTime: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  });
  await logSets(session.id, weights);
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
    await finishedSession([18, 18], 4);
    await finishedSession([27, 27], 2);
    expect(await storedStack()).toBe("kg4_5");
  });

  it("learns on an exercise with no equipment recorded", async () => {
    const exercise = await createExercise({ equipment: null });
    const { program, slots } = await createProgram(userId, [
      { exerciseId: exercise.id, sets: [{ weightKg: "18" }] },
    ]);
    const session = await createSession(userId, program.id);
    await logSets(session.id, [18], slots[0]);
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
    vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(learnWeightStacks(session.id, userId)).resolves.toBeUndefined();
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
    expect(await storedStack()).toBeNull();
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
