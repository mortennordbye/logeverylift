import { db } from "@/db";
import { customWeightUsage, friendships, programExercises, programSets, programShares, programs, workoutSessions, workoutSets } from "@/db/schema";
import { logCustomWeight } from "@/lib/actions/custom-weights";
import { copySharedProgram, shareProgram } from "@/lib/actions/program-shares";
import { createWorkoutSession } from "@/lib/actions/workout-sessions";
import { getSessionDetail, logWorkoutSet } from "@/lib/actions/workout-sets";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { plannedStepSnapshot } from "@/lib/program-steps-db";
import { createExercise, createProgram, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Starting a session and logging into it only touch the caller's own
 * programs and the exercises the caller can see: system ones, their own
 * custom ones, and ones in their live programs (a copied friend's program).
 */

let aliceId: string;
let bobId: string;
let systemExerciseId: number;
let aliceExerciseId: number;
let aliceProgramId: number;
let aliceSetId: number;

const today = new Date().toISOString().slice(0, 10);

function setPayload(sessionId: number, exerciseId: number, extra: object = {}) {
  return {
    sessionId,
    exerciseId,
    setNumber: 1,
    targetReps: 8,
    actualReps: 8,
    weightKg: 60,
    restTimeSeconds: 90,
    isCompleted: true,
    isFailed: false,
    wasEasy: false,
    ...extra,
  };
}

beforeEach(async () => {
  aliceId = (await createUser()).id;
  bobId = (await createUser()).id;
  systemExerciseId = (await createExercise({ name: "Bench Press" })).id;
  aliceExerciseId = (await createExercise({ name: "Alice Secret Press", userId: aliceId })).id;
  const { program, slots } = await createProgram(aliceId, [
    { exerciseId: aliceExerciseId, sets: [{}, {}] },
    { exerciseId: systemExerciseId, sets: [{}] },
  ]);
  aliceProgramId = program.id;
  aliceSetId = slots[0].setIds[0];
});

describe("createWorkoutSession ownership", () => {
  it("refuses a session on another user's program", async () => {
    asUser(bobId);
    const r = await createWorkoutSession({ date: today, programId: aliceProgramId });
    expect(r.success).toBe(false);
    const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, bobId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a session on the caller's own deleted program", async () => {
    asUser(aliceId);
    await db.update(programs).set({ deletedAt: new Date() }).where(eq(programs.id, aliceProgramId));
    const r = await createWorkoutSession({ date: today, programId: aliceProgramId });
    expect(r.success).toBe(false);
  });

  it("starts a session on the caller's own program and without one", async () => {
    asUser(aliceId);
    expect((await createWorkoutSession({ date: today, programId: aliceProgramId })).success).toBe(true);
    expect((await createWorkoutSession({ date: today })).success).toBe(true);
  });
});

describe("logWorkoutSet ownership", () => {
  it("refuses another user's custom exercise in a session with no program", async () => {
    asUser(bobId);
    const session = await createSession(bobId, null);
    const r = await logWorkoutSet(setPayload(session.id, aliceExerciseId));
    expect(r.success).toBe(false);
    const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses another user's custom exercise with a slot of the caller's own program", async () => {
    asUser(bobId);
    const own = await createProgram(bobId, [{ exerciseId: systemExerciseId, sets: [{}] }]);
    const session = await createSession(bobId, own.program.id);
    const r = await logWorkoutSet(setPayload(session.id, aliceExerciseId, { programSetId: own.slots[0].setIds[0] }));
    expect(r.success).toBe(false);
  });

  it("does not take a plan slot or program name from a program the session owner does not own", async () => {
    // A session row pointing at another user's program (as one created before
    // createWorkoutSession checked it would).
    asUser(bobId);
    const session = await createSession(bobId, aliceProgramId);
    const r = await logWorkoutSet(setPayload(session.id, systemExerciseId, { programSetId: aliceSetId }));
    if (r.success) {
      const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
      expect(row.programSetId).toBeNull();
      expect(row.programExerciseId).toBeNull();
    }
    const detail = await getSessionDetail(session.id);
    expect(detail.success).toBe(true);
    if (detail.success) expect(detail.data.programName).toBeNull();
  });

  it("logs the caller's own custom exercise and system exercises in their own program", async () => {
    asUser(aliceId);
    const started = await createWorkoutSession({ date: today, programId: aliceProgramId });
    expect(started.success).toBe(true);
    if (!started.success) return;
    const own = await logWorkoutSet(setPayload(started.data.id, aliceExerciseId, { programSetId: aliceSetId }));
    expect(own.success).toBe(true);
    const sys = await logWorkoutSet(setPayload(started.data.id, systemExerciseId, { setNumber: 1 }));
    expect(sys.success).toBe(true);
  });

  it("logs a system exercise in a session with no program", async () => {
    asUser(bobId);
    const session = await createSession(bobId, null);
    expect((await logWorkoutSet(setPayload(session.id, systemExerciseId))).success).toBe(true);
  });

  it("logs a friend's custom exercise from a copied shared program", async () => {
    asUser(aliceId);
    await db.insert(friendships).values({ requesterId: aliceId, addresseeId: bobId, status: "accepted" });
    const shared = await shareProgram({ programId: aliceProgramId, friendUserId: bobId });
    expect(shared.success).toBe(true);

    asUser(bobId);
    const [share] = await db.select().from(programShares).where(eq(programShares.programId, aliceProgramId));
    const copied = await copySharedProgram({ shareId: share.id });
    expect(copied.success).toBe(true);
    if (!copied.success) return;
    const copy = { id: copied.data.programId };
    const started = await createWorkoutSession({ date: today, programId: copy.id });
    expect(started.success).toBe(true);
    if (!started.success) return;
    const r = await logWorkoutSet(setPayload(started.data.id, aliceExerciseId));
    expect(r.success).toBe(true);
  });

  it("logs a friend's custom exercise from the slot of a copied program deleted mid-workout", async () => {
    asUser(aliceId);
    await db.insert(friendships).values({ requesterId: aliceId, addresseeId: bobId, status: "accepted" });
    expect((await shareProgram({ programId: aliceProgramId, friendUserId: bobId })).success).toBe(true);

    asUser(bobId);
    const [share] = await db.select().from(programShares).where(eq(programShares.programId, aliceProgramId));
    const copied = await copySharedProgram({ shareId: share.id });
    if (!copied.success) throw new Error(copied.error);
    const started = await createWorkoutSession({ date: today, programId: copied.data.programId });
    if (!started.success) throw new Error(started.error);
    const [slot] = await db
      .select({ id: programSets.id })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .where(and(eq(programExercises.programId, copied.data.programId), eq(programExercises.exerciseId, aliceExerciseId)))
      .orderBy(asc(programSets.setNumber))
      .limit(1);
    // Soft-deleted from somewhere else (another device, the assistant) while the set waits in the queue.
    await db.update(programs).set({ deletedAt: new Date() }).where(eq(programs.id, copied.data.programId));

    const r = await logWorkoutSet(setPayload(started.data.id, aliceExerciseId, { programSetId: slot.id }));
    expect(r.success).toBe(true);
    const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, started.data.id));
    expect(rows.map((x) => [x.exerciseId, x.programSetId])).toEqual([[aliceExerciseId, slot.id]]);
  });
});

describe("logCustomWeight ownership", () => {
  it("refuses another user's custom exercise", async () => {
    asUser(bobId);
    const r = await logCustomWeight({ exerciseId: aliceExerciseId, weightKg: 42.5 });
    expect(r.success).toBe(false);
    const rows = await db.select().from(customWeightUsage).where(eq(customWeightUsage.userId, bobId));
    expect(rows).toHaveLength(0);
  });

  it("records the caller's own custom exercise and a system exercise", async () => {
    asUser(aliceId);
    expect((await logCustomWeight({ exerciseId: aliceExerciseId, weightKg: 42.5 })).success).toBe(true);
    expect((await logCustomWeight({ exerciseId: systemExerciseId, weightKg: 42.5 })).success).toBe(true);
  });
});

describe("plannedStepSnapshot ownership", () => {
  it("gives the plan of a step only to the program's owner", async () => {
    const bike = (await createExercise({ name: "Bike ride", category: "cardio", discipline: "bike" })).id;
    const { slots } = await createStepProgram(aliceId, bike, {
      v: 2,
      sport: "bike",
      name: "Easy",
      steps: [{ type: "work", end: { type: "time", seconds: 600 }, free: true }],
    });
    const stepId = slots[0].setIds[0];
    expect(await plannedStepSnapshot(db, stepId, aliceId)).not.toBeNull();
    expect(await plannedStepSnapshot(db, stepId, bobId)).toBeNull();
  });
});
