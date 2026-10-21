import { db } from "@/db";
import { exercisePrs, programSets, workoutSessions, workoutSets } from "@/db/schema";
import { reorderProgramSets } from "@/lib/actions/programs";
import {
  getActiveSessionCompletedProgramSetIds,
  logWorkoutSet,
  unlogWorkoutSet,
  updateWorkoutSetNotes,
} from "@/lib/actions/workout-sets";
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Logging sets against a real database, the way WorkoutSetsList does it: the
 * client sends the set's current position as setNumber and its plan slot as
 * programSetId.
 */

let userId: string;
let exerciseId: number;
let programId: number;
let programExerciseId: number;
let setIds: number[];
let sessionId: number;

beforeEach(async () => {
  const user = await createUser();
  userId = user.id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Bench Press" })).id;
  const { program, slots } = await createProgram(userId, [
    { exerciseId, sets: [{ weightKg: "80" }, { weightKg: "82.5" }, { weightKg: "85" }] },
  ]);
  programId = program.id;
  programExerciseId = slots[0].programExerciseId;
  setIds = slots[0].setIds;
  sessionId = (await createSession(userId, programId)).id;
});

/** The payload WorkoutSetsList.toggleSet sends for the set at `position`. */
function logPayload(position: number, programSetId: number, weightKg: number, extra: object = {}) {
  return {
    sessionId,
    exerciseId,
    setNumber: position,
    programSetId,
    targetReps: 8,
    actualReps: 8,
    weightKg,
    restTimeSeconds: 90,
    isCompleted: true,
    isFailed: false,
    wasEasy: false,
    ...extra,
  };
}

async function loggedRows() {
  return db
    .select({
      programSetId: workoutSets.programSetId,
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      notes: workoutSets.notes,
    })
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, sessionId))
    .orderBy(asc(workoutSets.setNumber), asc(workoutSets.id));
}

describe("logWorkoutSet", () => {
  it("writes one row per set and treats a repeat tap as an update", async () => {
    const [a] = setIds;
    expect((await logWorkoutSet(logPayload(1, a, 80))).success).toBe(true);
    expect((await logWorkoutSet(logPayload(1, a, 80, { actualReps: 7 }))).success).toBe(true);

    const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].actualReps).toBe(7);
    expect(rows[0].programSetId).toBe(a);
  });

  it("refuses a session owned by someone else", async () => {
    const other = await createUser();
    asUser(other.id);
    const result = await logWorkoutSet(logPayload(1, setIds[0], 80));
    expect(result.success).toBe(false);
    expect(await loggedRows()).toHaveLength(0);
  });

  it("keeps every logged set after a mid-workout reorder", async () => {
    const [a, b, c] = setIds;
    // Log A in first position, then drag it to the end: order B, C, A.
    await logWorkoutSet(logPayload(1, a, 80));
    expect((await reorderProgramSets(programExerciseId, [b, c, a])).success).toBe(true);

    // B is now first, so the client sends setNumber 1 for it.
    await logWorkoutSet(logPayload(1, b, 82.5));

    const rows = await loggedRows();
    expect(rows.map((r) => r.programSetId).sort()).toEqual([a, b].sort());
    expect(rows.find((r) => r.programSetId === a)?.weightKg).toBe("80.00");
    expect(rows.find((r) => r.programSetId === b)?.weightKg).toBe("82.50");
    // Positions follow the new order.
    expect(rows.find((r) => r.programSetId === b)?.setNumber).toBe(1);
    expect(rows.find((r) => r.programSetId === a)?.setNumber).toBe(3);

    const completed = await getActiveSessionCompletedProgramSetIds(sessionId);
    expect(completed.success && [...completed.data].sort()).toEqual([a, b].sort());
  });

  it("un-logs the moved set, not whatever now sits at its old position", async () => {
    const [a, b, c] = setIds;
    await logWorkoutSet(logPayload(1, a, 80));
    await reorderProgramSets(programExerciseId, [b, c, a]);
    await logWorkoutSet(logPayload(1, b, 82.5));

    // Un-log A from where it is now: third.
    const result = await unlogWorkoutSet({ sessionId, exerciseId, setNumber: 3, programSetId: a });
    expect(result.success).toBe(true);

    const rows = await loggedRows();
    expect(rows.map((r) => r.programSetId)).toEqual([b]);
  });

  it("logging a set after an earlier one is deleted does not overwrite the deleted set's log", async () => {
    const [a, b, c] = setIds;
    await logWorkoutSet(logPayload(2, b, 82.5));
    // B removed from the plan mid-workout: its log stays, slot nulled by the FK.
    await db.delete(programSets).where(eq(programSets.id, b));
    // C moved up to second position in the list.
    await logWorkoutSet(logPayload(2, c, 85));

    const rows = await loggedRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.weightKg).sort()).toEqual(["82.50", "85.00"]);
    expect(rows.map((r) => r.programSetId)).toContain(c);
    void a;
  });

  it("edits the note of the moved set", async () => {
    const [a, b, c] = setIds;
    await logWorkoutSet(logPayload(1, a, 80));
    await reorderProgramSets(programExerciseId, [b, c, a]);
    await logWorkoutSet(logPayload(1, b, 82.5));

    const result = await updateWorkoutSetNotes({
      sessionId,
      exerciseId,
      setNumber: 3,
      programSetId: a,
      notes: "belt on",
    });
    expect(result.success).toBe(true);
    const rows = await loggedRows();
    expect(rows.find((r) => r.programSetId === a)?.notes).toBe("belt on");
    expect(rows.find((r) => r.programSetId === b)?.notes).toBeNull();
  });
});

describe("PR records", () => {
  /** A finished session at `weightKg` x `reps` on the first set, as history. */
  async function history(weightKg: number, reps = 8, rir: number | undefined = undefined) {
    const earlier = await createSession(userId, programId);
    asUser(userId);
    const r = await logWorkoutSet({ ...logPayload(1, setIds[0], weightKg, { actualReps: reps, rir }), sessionId: earlier.id });
    expect(r.success).toBe(true);
    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, earlier.id));
  }

  async function currentRecords() {
    const rows = await db
      .select()
      .from(exercisePrs)
      .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt)));
    return rows.map((p) => `${p.prType}:${Number(p.value)}${p.weightKg ? `@${Number(p.weightKg)}` : ""}`).sort();
  }

  it("records a PR for a heavier set and restores the previous record when it is un-logged", async () => {
    await history(80);
    expect(await currentRecords()).toEqual(["reps_at_weight:8@80", "weight:80"]);

    const logged = await logWorkoutSet(logPayload(1, setIds[0], 90));
    expect(logged.success && logged.data.newPRs.map((p) => p.type).sort()).toEqual(["reps_at_weight", "weight"]);
    expect(await currentRecords()).toEqual(["reps_at_weight:8@80", "reps_at_weight:8@90", "weight:90"]);

    await unlogWorkoutSet({ sessionId, exerciseId, setNumber: 1, programSetId: setIds[0] });
    expect(await currentRecords()).toEqual(["reps_at_weight:8@80", "weight:80"]);
  });

  it("a corrected re-log drops the PR the mistyped value earned", async () => {
    await history(80);
    // 200 typed instead of 100, then corrected in the set editor (a re-log).
    await logWorkoutSet(logPayload(1, setIds[0], 200));
    expect(await currentRecords()).toContain("weight:200");

    await logWorkoutSet(logPayload(1, setIds[0], 100));
    expect(await currentRecords()).toEqual(["reps_at_weight:8@100", "reps_at_weight:8@80", "weight:100"]);

    // And correcting it below the old record brings the old record back.
    await logWorkoutSet(logPayload(1, setIds[0], 70));
    expect(await currentRecords()).toEqual(["reps_at_weight:8@70", "reps_at_weight:8@80", "weight:80"]);
  });

  it("un-logging restores the record each PR displaced, not just the latest superseded one", async () => {
    await history(80);
    await history(85);
    // Two superseded weight records now exist (80, then 85 current).
    await logWorkoutSet(logPayload(1, setIds[0], 90));
    await unlogWorkoutSet({ sessionId, exerciseId, setNumber: 1, programSetId: setIds[0] });
    expect((await currentRecords()).filter((r) => r.startsWith("weight"))).toEqual(["weight:85"]);
  });

  it("sets logged at once leave exactly one current weight record", async () => {
    // Catching up earlier sets and ticking a whole exercise both fire their
    // logs in parallel. Several rounds, because a race only shows sometimes.
    for (let round = 0; round < 5; round++) {
      const session = await createSession(userId, programId);
      await Promise.all(
        setIds.map((id, i) =>
          logWorkoutSet({ ...logPayload(i + 1, id, 100 + round * 10 + i), sessionId: session.id }),
        ),
      );
      const weight = (await currentRecords()).filter((r) => r.startsWith("weight"));
      expect(weight).toEqual([`weight:${100 + round * 10 + setIds.length - 1}`]);
    }
  });

  it("a failed PR detection still logs the set", async () => {
    // A value the exercise_prs.value column (decimal(8,2)) cannot hold makes
    // the record insert fail; the set row must survive it.
    const result = await logWorkoutSet(logPayload(1, setIds[0], 999, { actualReps: 9_999_999 }));
    expect(result.success).toBe(true);
    expect(await loggedRows()).toHaveLength(1);
  });
});
