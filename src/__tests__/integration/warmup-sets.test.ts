import { db } from "@/db";
import { programSets, workoutSets } from "@/db/schema";
import { addWarmupSets } from "@/lib/actions/programs";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Generating warm-ups in front of a barbell exercise mid-workout, while some
 * of its sets are already logged.
 */

let userId: string;
let exerciseId: number;
let programExerciseId: number;
let setIds: number[];
let sessionId: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Back Squat", equipment: "barbell" })).id;
  const { program, slots } = await createProgram(userId, [
    { exerciseId, sets: [{ weightKg: "100", targetReps: 5 }, { weightKg: "100", targetReps: 5 }] },
  ]);
  programExerciseId = slots[0].programExerciseId;
  setIds = slots[0].setIds;
  sessionId = (await createSession(userId, program.id)).id;
});

function plan() {
  return db
    .select()
    .from(programSets)
    .where(eq(programSets.programExerciseId, programExerciseId))
    .orderBy(asc(programSets.setNumber));
}

describe("addWarmupSets", () => {
  it("puts the ramp first and keeps logged sets on their program sets", async () => {
    const [first, second] = setIds;
    await logWorkoutSet({
      sessionId,
      exerciseId,
      setNumber: 1,
      programSetId: first,
      targetReps: 5,
      actualReps: 5,
      weightKg: 100,
      restTimeSeconds: 90,
      isCompleted: true,
    });

    const result = await addWarmupSets({ programExerciseId });
    expect(result.success).toBe(true);

    const sets = await plan();
    expect(sets.map((s) => [s.setType, Number(s.weightKg), s.targetReps])).toEqual([
      ["warmup", 20, 10],
      ["warmup", 40, 5],
      ["warmup", 60, 3],
      ["warmup", 80, 2],
      ["working", 100, 5],
      ["working", 100, 5],
    ]);
    expect(sets.slice(4).map((s) => s.id)).toEqual([first, second]);

    // The logged row moved with its set, to the position the list now sends.
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId));
    expect(row.programSetId).toBe(first);
    expect(row.setNumber).toBe(5);
  });

  it("ramps to today's weight when the client sends it", async () => {
    expect((await addWarmupSets({ programExerciseId, workingKg: 85 })).success).toBe(true);
    const sets = await plan();
    expect(sets.slice(0, 4).map((s) => Number(s.weightKg))).toEqual([20, 35, 50, 67.5]);
  });

  it("leaves finished workouts in the order they were done", async () => {
    const [first] = setIds;
    const finished = (await createSession(userId, null, { isCompleted: true })).id;
    await db.insert(workoutSets).values({
      sessionId: finished,
      exerciseId,
      programExerciseId,
      programSetId: first,
      setNumber: 1,
      actualReps: 5,
      weightKg: "100",
      restTimeSeconds: 90,
    });

    expect((await addWarmupSets({ programExerciseId })).success).toBe(true);

    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, finished));
    expect(row.setNumber).toBe(1);
  });

  it("refuses a second run", async () => {
    expect((await addWarmupSets({ programExerciseId })).success).toBe(true);
    const again = await addWarmupSets({ programExerciseId });
    expect(again).toEqual({ success: false, error: "This exercise already has warm-up sets" });
    expect(await plan()).toHaveLength(6);
  });

  it("refuses another user's exercise", async () => {
    asUser((await createUser()).id);
    expect(await addWarmupSets({ programExerciseId })).toEqual({ success: false, error: "Not found" });
    asUser(userId);
    expect(await plan()).toHaveLength(2);
  });

  it("refuses an exercise that isn't on a barbell", async () => {
    const dumbbell = (await createExercise({ equipment: "dumbbell" })).id;
    const { slots } = await createProgram(userId, [{ exerciseId: dumbbell, sets: [{ weightKg: "30" }] }]);
    const result = await addWarmupSets({ programExerciseId: slots[0].programExerciseId });
    expect(result.success).toBe(false);
  });
});
