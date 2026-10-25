import { db } from "@/db";
import { exerciseNotes, exercisePrs, workoutSets } from "@/db/schema";
import { getExerciseWithNote, upsertExerciseNote } from "@/lib/actions/exercises";
import { getExerciseHistory, getExerciseProgress, getExerciseRecords } from "@/lib/actions/metrics";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

let userId: string;
let exerciseId: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Back Squat" })).id;
});

/** A completed session on `date` with one set of this exercise. */
async function logSession(forUser: string, date: string, weightKg: number) {
  const session = await createSession(forUser, null, { date, isCompleted: true });
  await db.insert(workoutSets).values({
    sessionId: session.id,
    exerciseId,
    setNumber: 1,
    actualReps: 5,
    weightKg: String(weightKg),
    restTimeSeconds: 120,
  });
  return session;
}

describe("getExerciseProgress", () => {
  it("returns the latest 16 sessions, oldest first, when there are 20", async () => {
    for (let day = 1; day <= 20; day++) {
      await logSession(userId, `2026-01-${String(day).padStart(2, "0")}`, 100 + day);
    }

    const result = await getExerciseProgress(exerciseId);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(16);
    expect(result.data[0].date).toBe("2026-01-05");
    expect(result.data[15].date).toBe("2026-01-20");
    expect(result.data[15].maxWeightKg).toBe(120);
  });
});

describe("getExerciseHistory", () => {
  it("lists the user's completed sessions newest first with their sets", async () => {
    await logSession(userId, "2026-02-01", 100);
    const latest = await logSession(userId, "2026-02-08", 105);
    await createSession(userId, null, { date: "2026-02-09", isCompleted: false });

    const result = await getExerciseHistory(exerciseId);
    if (!result.success) throw new Error(result.error);
    expect(result.data.map((s) => s.date)).toEqual(["2026-02-08", "2026-02-01"]);
    expect(result.data[0].sessionId).toBe(latest.id);
    expect(result.data[0].sets).toMatchObject([{ setNumber: 1, actualReps: 5, weightKg: "105.00" }]);
  });

  it("keeps the latest 20 sessions and only this exercise's sets", async () => {
    const otherExercise = (await createExercise()).id;
    for (let day = 1; day <= 22; day++) {
      const session = await logSession(userId, `2026-01-${String(day).padStart(2, "0")}`, 100);
      await db.insert(workoutSets).values({
        sessionId: session.id,
        exerciseId: otherExercise,
        setNumber: 2,
        actualReps: 8,
        weightKg: "40",
        restTimeSeconds: 90,
      });
    }

    const result = await getExerciseHistory(exerciseId);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(20);
    expect(result.data[0].date).toBe("2026-01-22");
    expect(result.data[19].date).toBe("2026-01-03");
    expect(result.data.every((s) => s.sets.length === 1 && s.sets[0].weightKg === "100.00")).toBe(true);
  });

  it("never returns another user's sets", async () => {
    const otherId = (await createUser()).id;
    await logSession(otherId, "2026-02-01", 200);

    const result = await getExerciseHistory(exerciseId);
    expect(result).toEqual({ success: true, data: [] });
  });
});

describe("getExerciseRecords", () => {
  it("returns only the user's standing records on this exercise", async () => {
    const otherId = (await createUser()).id;
    const otherExercise = (await createExercise()).id;
    await db.insert(exercisePrs).values([
      { userId, exerciseId, prType: "weight", value: "120", achievedAt: new Date("2026-03-02") },
      { userId, exerciseId, prType: "weight", value: "110", achievedAt: new Date("2026-03-01"), supersededAt: new Date("2026-03-02") },
      { userId, exerciseId: otherExercise, prType: "weight", value: "90", achievedAt: new Date("2026-03-01") },
      { userId: otherId, exerciseId, prType: "weight", value: "200", achievedAt: new Date("2026-03-01") },
    ]);

    const result = await getExerciseRecords(exerciseId);
    if (!result.success) throw new Error(result.error);
    expect(result.data.map((r) => r.value)).toEqual([120]);
  });
});

describe("upsertExerciseNote", () => {
  async function storedNotes() {
    return db.select({ userId: exerciseNotes.userId, note: exerciseNotes.note }).from(exerciseNotes);
  }

  it("creates, updates and deletes the note", async () => {
    expect((await upsertExerciseNote({ exerciseId, note: "  Belt from 140  " })).success).toBe(true);
    expect(await storedNotes()).toEqual([{ userId, note: "Belt from 140" }]);

    expect((await upsertExerciseNote({ exerciseId, note: "Belt from 150" })).success).toBe(true);
    expect(await storedNotes()).toEqual([{ userId, note: "Belt from 150" }]);
    const detail = await getExerciseWithNote(exerciseId);
    expect(detail.success && detail.data.note).toBe("Belt from 150");

    expect((await upsertExerciseNote({ exerciseId, note: "  " })).success).toBe(true);
    expect(await storedNotes()).toEqual([]);
  });

  it("keeps each user's note separate", async () => {
    await upsertExerciseNote({ exerciseId, note: "Mine" });
    const otherId = (await createUser()).id;
    asUser(otherId);

    const detail = await getExerciseWithNote(exerciseId);
    expect(detail.success && detail.data.note).toBeNull();
    await upsertExerciseNote({ exerciseId, note: "" });
    await upsertExerciseNote({ exerciseId, note: "Theirs" });
    expect(await storedNotes()).toEqual(
      expect.arrayContaining([
        { userId, note: "Mine" },
        { userId: otherId, note: "Theirs" },
      ]),
    );
  });

  it("rejects a note over 1000 characters", async () => {
    const result = await upsertExerciseNote({ exerciseId, note: "x".repeat(1001) });
    expect(result.success).toBe(false);
    expect(await storedNotes()).toEqual([]);
  });

  it("allows another user's custom exercise that one of the user's programs uses", async () => {
    // A copied shared program keeps pointing at the sharer's custom exercise.
    const otherId = (await createUser()).id;
    const theirs = (await createExercise({ isCustom: true, userId: otherId })).id;
    await createProgram(userId, [{ exerciseId: theirs, sets: [{}] }]);

    expect((await upsertExerciseNote({ exerciseId: theirs, note: "Their cue" })).success).toBe(true);
    const detail = await getExerciseWithNote(theirs);
    expect(detail.success && detail.data.note).toBe("Their cue");
  });

  it("refuses another user's custom exercise", async () => {
    const otherId = (await createUser()).id;
    const theirs = (await createExercise({ isCustom: true, userId: otherId })).id;

    expect(await upsertExerciseNote({ exerciseId: theirs, note: "peek" })).toEqual({
      success: false,
      error: "Not found",
    });
    expect(await getExerciseWithNote(theirs)).toEqual({ success: false, error: "Not found" });
    expect(await storedNotes()).toEqual([]);
  });
});
