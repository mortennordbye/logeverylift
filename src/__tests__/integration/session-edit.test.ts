import { db } from "@/db";
import { exercisePrs, workoutSessions, workoutSets } from "@/db/schema";
import { deleteWorkoutSession, logWorkoutSet, unlogWorkoutSet, updateLoggedSet, updateWorkoutSession } from "@/lib/actions/workout-sets";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Editing finished sessions from history, and the record chain that has to
 * stay consistent behind them.
 */

let userId: string;
let exerciseId: number;
let programId: number;
let programSetId: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Back Squat" })).id;
  const { program, slots } = await createProgram(userId, [{ exerciseId, sets: [{}] }]);
  programId = program.id;
  programSetId = slots[0].setIds[0];
});

/**
 * A finished session on `day` with one set, logged the way the workout screen
 * logs it, then dated to that day: the set, and the records it earned, carry
 * the session's time as they would had it been logged then.
 */
async function finished(day: string, weightKg: number, reps = 5) {
  const start = new Date(`${day}T17:00:00Z`);
  const session = await createSession(userId, programId, { date: day, startTime: start });
  const logged = await logWorkoutSet({
    sessionId: session.id,
    exerciseId,
    setNumber: 1,
    programSetId,
    targetReps: 5,
    actualReps: reps,
    weightKg,
    rir: 2,
    restTimeSeconds: 120,
    isCompleted: true,
    isFailed: false,
    wasEasy: false,
  });
  expect(logged.success).toBe(true);
  await db
    .update(workoutSessions)
    .set({ isCompleted: true, endTime: new Date(start.getTime() + 3_600_000) })
    .where(eq(workoutSessions.id, session.id));
  await db.update(workoutSets).set({ createdAt: start }).where(eq(workoutSets.sessionId, session.id));
  await db.execute(sql`
    UPDATE exercise_prs p SET achieved_at = s.created_at
    FROM workout_sets s WHERE p.set_id = s.id AND s.session_id = ${session.id}`);
  await db.execute(sql`
    UPDATE exercise_prs p SET superseded_at = n.achieved_at
    FROM exercise_prs n WHERE p.superseded_by_id = n.id`);
  const [set] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
  return { sessionId: session.id, setId: set.id };
}

/** Current records as `type:value@weight`, sorted. */
async function currentRecords() {
  const rows = await db
    .select()
    .from(exercisePrs)
    .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt)));
  return rows
    .map((p) => `${p.prType}:${Number(p.value)}${p.prType === "reps_at_weight" ? `@${Number(p.weightKg)}` : ""}`)
    .sort();
}

/** The weight records in the order they were set, with the day and who beat each. */
async function weightChain() {
  const rows = await db
    .select()
    .from(exercisePrs)
    .where(and(eq(exercisePrs.userId, userId), eq(exercisePrs.prType, "weight")))
    .orderBy(asc(exercisePrs.achievedAt));
  return rows.map((p) => ({
    value: Number(p.value),
    day: p.achievedAt.toISOString().slice(0, 10),
    current: p.supersededAt == null,
  }));
}

/**
 * Every record as what it says, leaving out the ids a rebuild re-issues for the
 * records it rewrites.
 */
async function allRecords() {
  const rows = await db.select().from(exercisePrs).orderBy(asc(exercisePrs.achievedAt), asc(exercisePrs.prType));
  return rows.map((p) => ({
    prType: p.prType,
    value: p.value,
    weightKg: p.weightKg,
    setId: p.setId,
    achievedAt: p.achievedAt,
    supersededAt: p.supersededAt,
  }));
}

function edit(setId: number, weightKg: number, extra: object = {}) {
  return updateLoggedSet({ setId, weightKg, actualReps: 5, isFailed: false, notes: null, ...extra });
}

describe("updateLoggedSet", () => {
  it("an older set edited above a later record, then below it, leaves one current record per type", async () => {
    const older = await finished("2026-10-01", 100);
    await finished("2026-10-08", 110);
    expect(await currentRecords()).toEqual([
      "estimated_1rm:128.33",
      "reps_at_weight:5@100",
      "reps_at_weight:5@110",
      "weight:110",
    ]);

    expect((await edit(older.setId, 120)).success).toBe(true);
    expect(await currentRecords()).toEqual([
      "estimated_1rm:140",
      "reps_at_weight:5@110",
      "reps_at_weight:5@120",
      "weight:120",
    ]);
    expect(await weightChain()).toEqual([{ value: 120, day: "2026-10-01", current: true }]);

    expect((await edit(older.setId, 90)).success).toBe(true);
    expect(await currentRecords()).toEqual([
      "estimated_1rm:128.33",
      "reps_at_weight:5@110",
      "reps_at_weight:5@90",
      "weight:110",
    ]);
    expect(await weightChain()).toEqual([
      { value: 90, day: "2026-10-01", current: false },
      { value: 110, day: "2026-10-08", current: true },
    ]);
  });

  it("saves reps, the failed flag and the note", async () => {
    const { setId } = await finished("2026-10-01", 100);
    const result = await edit(setId, 100, { actualReps: 3, isFailed: true, notes: "  Hips shot up  " });
    expect(result.success).toBe(true);
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.id, setId));
    expect(row).toMatchObject({ actualReps: 3, isFailed: true, notes: "Hips shot up" });
    expect(await currentRecords()).toContain("reps_at_weight:3@100");
  });

  it("leaves records from before honest rep logging as they are", async () => {
    const old = await finished("2026-08-20", 100);
    await finished("2026-10-01", 105);
    const before = await allRecords();

    expect((await edit(old.setId, 140)).success).toBe(true);
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.id, old.setId));
    expect(Number(row.weightKg)).toBe(140);
    // The 100 kg record stands though its set now says 140, and the 105 after
    // it is replayed unchanged.
    expect(await allRecords()).toEqual(before);
  });

  it("rebuilds from the set's own time when the session's start is later than it", async () => {
    // The start comes from the phone's clock and the set's time from the
    // server's, so a phone running ahead puts the start after its sets.
    const { sessionId, setId } = await finished("2026-10-01", 200);
    await db
      .update(workoutSessions)
      .set({ startTime: new Date("2026-10-01T17:02:00Z") })
      .where(eq(workoutSessions.id, sessionId));

    expect((await edit(setId, 100)).success).toBe(true);
    expect(await currentRecords()).toContain("weight:100");
    expect(await currentRecords()).not.toContain("weight:200");
  });

  it("refuses another user's set", async () => {
    const { setId } = await finished("2026-10-01", 100);
    asUser((await createUser()).id);
    expect(await edit(setId, 200)).toMatchObject({ success: false });
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.id, setId));
    expect(Number(row.weightKg)).toBe(100);
  });

  it("refuses a set in a workout still in progress", async () => {
    const { sessionId, setId } = await finished("2026-10-01", 100);
    await db.update(workoutSessions).set({ isCompleted: false }).where(eq(workoutSessions.id, sessionId));
    expect(await edit(setId, 200)).toMatchObject({ success: false });
  });
});

describe("updateWorkoutSession", () => {
  it("moving a session earlier or later re-orders the record chain", async () => {
    await finished("2026-10-01", 100);
    const later = await finished("2026-10-08", 110);

    // Before the 100: the 110 came first, and the 100 was never a record.
    expect((await updateWorkoutSession({ sessionId: later.sessionId, date: "2026-09-24", notes: null })).success).toBe(true);
    expect(await weightChain()).toEqual([{ value: 110, day: "2026-09-24", current: true }]);

    // After it again: the 100 is a record, beaten by the 110.
    expect((await updateWorkoutSession({ sessionId: later.sessionId, date: "2026-10-15", notes: null })).success).toBe(true);
    expect(await weightChain()).toEqual([
      { value: 100, day: "2026-10-01", current: false },
      { value: 110, day: "2026-10-15", current: true },
    ]);

    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, later.sessionId));
    expect(session.date).toBe("2026-10-15");
    expect(session.startTime.toISOString()).toBe("2026-10-15T17:00:00.000Z");
    expect(session.endTime?.toISOString()).toBe("2026-10-15T18:00:00.000Z");
    const [set] = await db.select().from(workoutSets).where(eq(workoutSets.id, later.setId));
    expect(set.createdAt.toISOString()).toBe("2026-10-15T17:00:00.000Z");
  });

  it("saves the notes without touching records", async () => {
    const { sessionId } = await finished("2026-10-01", 100);
    const before = await db.select().from(exercisePrs).orderBy(asc(exercisePrs.id));
    expect((await updateWorkoutSession({ sessionId, date: "2026-10-01", notes: " Felt strong " })).success).toBe(true);
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
    expect(session.notes).toBe("Felt strong");
    expect(await db.select().from(exercisePrs).orderBy(asc(exercisePrs.id))).toEqual(before);
  });

  it("refuses another user's session", async () => {
    const { sessionId } = await finished("2026-10-01", 100);
    asUser((await createUser()).id);
    expect(await updateWorkoutSession({ sessionId, date: "2026-09-30", notes: "mine now" })).toMatchObject({ success: false });
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
    expect(session).toMatchObject({ date: "2026-10-01", notes: null });
  });

  it("moves the records of sets logged before the session's start", async () => {
    await finished("2026-10-01", 100);
    const skewed = await finished("2026-10-08", 110);
    await db
      .update(workoutSessions)
      .set({ startTime: new Date("2026-10-08T17:02:00Z") })
      .where(eq(workoutSessions.id, skewed.sessionId));

    expect((await updateWorkoutSession({ sessionId: skewed.sessionId, date: "2026-09-24", notes: null })).success).toBe(true);
    expect(await weightChain()).toEqual([{ value: 110, day: "2026-09-24", current: true }]);
  });

  it("refuses a move across the start of honest rep logging, either way", async () => {
    await finished("2026-08-10", 90);
    const after = await finished("2026-09-05", 100);
    const before = await finished("2026-08-20", 95);
    const records = await allRecords();

    expect(await updateWorkoutSession({ sessionId: after.sessionId, date: "2026-08-25", notes: null })).toMatchObject({ success: false });
    expect(await updateWorkoutSession({ sessionId: before.sessionId, date: "2026-09-10", notes: null })).toMatchObject({ success: false });
    expect(await allRecords()).toEqual(records);
    expect(await currentRecords()).toContain("weight:100");
  });

  it("refuses an auto session", async () => {
    const auto = await createSession(userId, programId, { date: "2026-10-01", isCompleted: true, source: "auto" });
    expect(await updateWorkoutSession({ sessionId: auto.id, date: "2026-09-30", notes: null })).toMatchObject({ success: false });
  });

  it("refuses a day in the future", async () => {
    const { sessionId } = await finished("2026-10-01", 100);
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    expect(await updateWorkoutSession({ sessionId, date: nextYear, notes: null })).toMatchObject({ success: false });
  });

  it("replaces the auto session on the day it moves to", async () => {
    const { sessionId } = await finished("2026-10-01", 100);
    const auto = await createSession(userId, programId, { date: "2026-10-03", isCompleted: true, source: "auto" });
    expect((await updateWorkoutSession({ sessionId, date: "2026-10-03", notes: null })).success).toBe(true);
    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.id, auto.id))).toEqual([]);
  });
});

describe("deleteWorkoutSession", () => {
  it("takes the session's records with it and restores the ones they beat", async () => {
    await finished("2026-10-01", 100);
    const later = await finished("2026-10-08", 110);

    expect((await deleteWorkoutSession(later.sessionId)).success).toBe(true);
    expect(await weightChain()).toEqual([{ value: 100, day: "2026-10-01", current: true }]);
    expect(await currentRecords()).toEqual(["estimated_1rm:116.67", "reps_at_weight:5@100", "weight:100"]);
  });

  it("a discarded workout leaves no records behind", async () => {
    await finished("2026-10-01", 100);
    const live = await createSession(userId, programId);
    await logWorkoutSet({
      sessionId: live.id,
      exerciseId,
      setNumber: 1,
      programSetId,
      targetReps: 5,
      actualReps: 5,
      weightKg: 120,
      rir: 2,
      restTimeSeconds: 120,
      isCompleted: true,
      isFailed: false,
      wasEasy: false,
    });
    expect(await currentRecords()).toContain("weight:120");

    expect((await deleteWorkoutSession(live.id)).success).toBe(true);
    expect(await currentRecords()).toEqual(["estimated_1rm:116.67", "reps_at_weight:5@100", "weight:100"]);
  });
});

describe("record chain edges", () => {
  /** Log set `n` of a two-set slot in a live session. */
  async function liveTwoSets() {
    const { program, slots } = await createProgram(userId, [{ exerciseId, sets: [{}, {}] }]);
    const live = await createSession(userId, program.id);
    const log = (n: number, weightKg: number, actualReps = 5) =>
      logWorkoutSet({
        sessionId: live.id,
        exerciseId,
        setNumber: n,
        programSetId: slots[0].setIds[n - 1],
        targetReps: 5,
        actualReps,
        weightKg,
        rir: 2,
        restTimeSeconds: 120,
        isCompleted: true,
        isFailed: false,
        wasEasy: false,
      });
    return { live, slots, log };
  }

  it("correcting an earlier set mid-workout after a later one beat it keeps one current record", async () => {
    await finished("2026-10-01", 90);
    const { log } = await liveTwoSets();
    await log(1, 100);
    await log(2, 105);

    expect((await log(1, 100, 4)).success).toBe(true);
    expect((await currentRecords()).filter((r) => r.startsWith("weight"))).toEqual(["weight:105"]);
  });

  it("correcting an earlier set down makes a later set the record it now is", async () => {
    await finished("2026-10-01", 90);
    const { log } = await liveTwoSets();
    await log(1, 100);
    await log(2, 98);

    await log(1, 92);
    expect((await currentRecords()).filter((r) => r.startsWith("weight"))).toEqual(["weight:98"]);
  });

  it("un-logging an earlier set mid-workout after a later one beat it keeps one current record", async () => {
    await finished("2026-10-01", 90);
    const { live, slots, log } = await liveTwoSets();
    await log(1, 100);
    await log(2, 105);

    await unlogWorkoutSet({ sessionId: live.id, exerciseId, setNumber: 1, programSetId: slots[0].setIds[0] });
    expect((await currentRecords()).filter((r) => r.startsWith("weight"))).toEqual(["weight:105"]);
  });

  it("keeps a record whose re-log dated it after the edit point", async () => {
    const first = await finished("2026-10-20", 100);
    const second = await finished("2026-10-21", 95);
    // A re-log of the first set that landed late, from the offline queue: the
    // set keeps its time, its record is dated when it arrived.
    await db.execute(sql`UPDATE exercise_prs SET achieved_at = '2026-10-22T09:00:00Z' WHERE set_id = ${first.setId}`);

    expect((await deleteWorkoutSession(second.sessionId)).success).toBe(true);
    expect((await currentRecords()).filter((r) => r.startsWith("weight"))).toEqual(["weight:100"]);
  });

  it("restores a record that lost its link to the one that beat it", async () => {
    await finished("2026-09-05", 100);
    const later = await finished("2026-10-01", 110);
    // Rows the superseded_by_id backfill (migration 0059) could not link.
    await db.execute(sql`UPDATE exercise_prs SET superseded_by_id = NULL`);

    expect((await edit(later.setId, 90)).success).toBe(true);
    expect((await currentRecords()).filter((r) => r.startsWith("weight"))).toEqual(["weight:100"]);
  });

  it("two saves of the same date move shift the sets once", async () => {
    const { sessionId, setId } = await finished("2026-10-10", 100);
    await Promise.all([
      updateWorkoutSession({ sessionId, date: "2026-10-09", notes: null }),
      updateWorkoutSession({ sessionId, date: "2026-10-09", notes: null }),
    ]);
    const [set] = await db.select().from(workoutSets).where(eq(workoutSets.id, setId));
    expect(set.createdAt.toISOString()).toBe("2026-10-09T17:00:00.000Z");
  });
});
