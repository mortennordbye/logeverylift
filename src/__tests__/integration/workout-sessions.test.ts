import { db } from "@/db";
import { programExercises, programSets, workoutSessions, workoutSets } from "@/db/schema";
import { reorderProgramExercises, reorderProgramSets } from "@/lib/actions/programs";
import {
  completeWorkoutSession,
  createWorkoutSession,
  isSessionResumable,
} from "@/lib/actions/workout-sessions";
import { deleteWorkoutSession, logWorkoutSet } from "@/lib/actions/workout-sets";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

let userId: string;
let otherUserId: string;
let programId: number;
let slots: Awaited<ReturnType<typeof createProgram>>["slots"];

beforeEach(async () => {
  userId = (await createUser()).id;
  otherUserId = (await createUser()).id;
  const bench = await createExercise({ name: "Bench Press" });
  const row = await createExercise({ name: "Barbell Row" });
  const created = await createProgram(userId, [
    { exerciseId: bench.id, sets: [{}, {}, {}] },
    { exerciseId: row.id, sets: [{}, {}] },
  ]);
  programId = created.program.id;
  slots = created.slots;
  asUser(userId);
});

describe("createWorkoutSession", () => {
  it("closes the caller's sessions left open for over an hour, and nobody else's", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stale = await createSession(userId, programId, { startTime: twoHoursAgo });
    const recent = await createSession(userId, programId);
    const othersStale = await createSession(otherUserId, null, { startTime: twoHoursAgo });

    const result = await createWorkoutSession({ date: "2026-10-21", programId });
    expect(result.success).toBe(true);

    const byId = async (id: number) =>
      (await db.select().from(workoutSessions).where(eq(workoutSessions.id, id)))[0];
    expect((await byId(stale.id)).isCompleted).toBe(true);
    expect((await byId(recent.id)).isCompleted).toBe(false);
    expect((await byId(othersStale.id)).isCompleted).toBe(false);
  });
});

describe("isSessionResumable", () => {
  it("is true only for the caller's open session of that program", async () => {
    const open = await createSession(userId, programId);
    const done = await createSession(userId, programId, { isCompleted: true });
    const others = await createSession(otherUserId, programId);

    const check = async (sessionId: number) => {
      const r = await isSessionResumable({ sessionId, programId });
      return r.success ? r.data : "error";
    };
    expect(await check(open.id)).toBe(true);
    expect(await check(done.id)).toBe(false);
    expect(await check(others.id)).toBe(false);
  });
});

describe("completeWorkoutSession", () => {
  it("replaces an auto-completed row for the same program and day", async () => {
    const auto = await createSession(userId, programId, {
      date: "2026-10-21",
      source: "auto",
      isCompleted: true,
    });
    const real = await createSession(userId, programId, { date: "2026-10-21" });

    const result = await completeWorkoutSession({ sessionId: real.id, feeling: "Good" });
    expect(result.success).toBe(true);

    const rows = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));
    expect(rows.map((r) => r.id)).toEqual([real.id]);
    expect(rows[0].isCompleted).toBe(true);
    void auto;
  });

  it("refuses someone else's session", async () => {
    const others = await createSession(otherUserId, null);
    const result = await completeWorkoutSession({ sessionId: others.id });
    expect(result.success).toBe(false);
    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, others.id));
    expect(row.isCompleted).toBe(false);
  });
});

describe("deleteWorkoutSession", () => {
  it("deletes the caller's session with its sets, and refuses someone else's", async () => {
    const mine = await createSession(userId, programId);
    await logWorkoutSet({
      sessionId: mine.id,
      exerciseId: slots[0].exerciseId,
      setNumber: 1,
      programSetId: slots[0].setIds[0],
      actualReps: 8,
      weightKg: 80,
      restTimeSeconds: 90,
    });
    const others = await createSession(otherUserId, null);

    expect((await deleteWorkoutSession(others.id)).success).toBe(false);
    expect((await deleteWorkoutSession(mine.id)).success).toBe(true);

    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.id, mine.id))).toHaveLength(0);
    expect(await db.select().from(workoutSets).where(eq(workoutSets.sessionId, mine.id))).toHaveLength(0);
    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.id, others.id))).toHaveLength(1);
  });
});

describe("reordering", () => {
  it("reorders sets and the open session's logs, but not finished sessions", async () => {
    const [a, b, c] = slots[0].setIds;
    const done = await createSession(userId, programId, { isCompleted: true });
    await db.insert(workoutSets).values({
      sessionId: done.id,
      exerciseId: slots[0].exerciseId,
      programExerciseId: slots[0].programExerciseId,
      programSetId: a,
      setNumber: 1,
      actualReps: 8,
      weightKg: "80",
      restTimeSeconds: 90,
    });
    const open = await createSession(userId, programId);
    await logWorkoutSet({
      sessionId: open.id,
      exerciseId: slots[0].exerciseId,
      setNumber: 1,
      programSetId: a,
      actualReps: 8,
      weightKg: 80,
      restTimeSeconds: 90,
    });

    expect((await reorderProgramSets(slots[0].programExerciseId, [c, a, b])).success).toBe(true);

    const plan = await db
      .select({ id: programSets.id })
      .from(programSets)
      .where(eq(programSets.programExerciseId, slots[0].programExerciseId))
      .orderBy(asc(programSets.setNumber));
    expect(plan.map((p) => p.id)).toEqual([c, a, b]);

    const setNumberIn = async (sessionId: number) =>
      (await db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId)))[0].setNumber;
    expect(await setNumberIn(open.id)).toBe(2);
    expect(await setNumberIn(done.id)).toBe(1);
  });

  it("refuses to reorder another user's sets or exercises", async () => {
    asUser(otherUserId);
    const [a, b, c] = slots[0].setIds;
    expect((await reorderProgramSets(slots[0].programExerciseId, [c, b, a])).success).toBe(false);
    expect(
      (await reorderProgramExercises(programId, [slots[1].programExerciseId, slots[0].programExerciseId])).success,
    ).toBe(false);

    const plan = await db
      .select({ id: programSets.id })
      .from(programSets)
      .where(eq(programSets.programExerciseId, slots[0].programExerciseId))
      .orderBy(asc(programSets.setNumber));
    expect(plan.map((p) => p.id)).toEqual([a, b, c]);
  });

  it("reorders exercises", async () => {
    const ids = [slots[1].programExerciseId, slots[0].programExerciseId];
    expect((await reorderProgramExercises(programId, ids)).success).toBe(true);
    const rows = await db
      .select({ id: programExercises.id })
      .from(programExercises)
      .where(eq(programExercises.programId, programId))
      .orderBy(asc(programExercises.orderIndex));
    expect(rows.map((r) => r.id)).toEqual(ids);
  });
});
