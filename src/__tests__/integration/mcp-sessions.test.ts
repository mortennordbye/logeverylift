import { db } from "@/db";
import { exercisePrs, trainingCycleSlots, trainingCycles, workoutSessions, workoutSets } from "@/db/schema";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { mcpTools } from "./mcp-call";

/** A day relative to today, on the server's clock (no user time zone is set). */
const day = (offset: number) => toDateStr(addDays(new Date(), offset));

let me: string;
let other: string;
let squat: number;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
  squat = (await createExercise({ name: "Back Squat" })).id;
});

const sessionsOf = (userId: string) => db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));

describe("log_session", () => {
  it("writes a completed session from the assistant, with its sets and notes", async () => {
    const result = await mcpTools(registerSessionTools, me)("log_session", {
      date: day(-2),
      durationMinutes: 50,
      feeling: "Good",
      notes: "Hotel gym",
      sets: [
        { exerciseId: squat, setNumber: 1, reps: 5, weightKg: 100, rir: 2 },
        { exerciseId: squat, setNumber: 2, reps: 5, weightKg: 100, notes: "felt heavy" },
      ],
    });
    expect(result.isError, result.raw).toBe(false);

    const [session] = await sessionsOf(me);
    expect(session).toMatchObject({ date: day(-2), source: "assistant", isCompleted: true, feeling: "Good", notes: "Hotel gym" });
    expect((session.endTime!.getTime() - session.startTime.getTime()) / 60_000).toBe(50);
    const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id));
    expect(sets.map((s) => [s.setNumber, s.actualReps, s.weightKg, s.rir, s.rpe, s.notes, s.programSetId])).toEqual([
      [1, 5, "100.00", 2, 8, null, null],
      [2, 5, "100.00", null, null, "felt heavy", null],
    ]);
    // Dated by the session, not by the call.
    expect(sets.every((s) => toDateStr(s.createdAt) === day(-2))).toBe(true);
  });

  it("rebuilds records from a backdated session on", async () => {
    const call = mcpTools(registerSessionTools, me);
    await call("log_session", { date: day(-2), sets: [{ exerciseId: squat, setNumber: 1, reps: 5, weightKg: 100 }] });
    const later = (await call("log_session", {
      date: day(-5),
      sets: [{ exerciseId: squat, setNumber: 1, reps: 5, weightKg: 110 }],
    })).data.sessionId;

    const standing = await db
      .select()
      .from(exercisePrs)
      .where(and(eq(exercisePrs.userId, me), eq(exercisePrs.prType, "weight"), isNull(exercisePrs.supersededAt)));
    expect(standing).toHaveLength(1);
    expect(standing[0]).toMatchObject({ value: "110.00", sessionId: later });
  });

  it("replaces the day's auto row for the program, and refuses a second log of it", async () => {
    const { program } = await createProgram(me, [{ exerciseId: squat, sets: [{}] }]);
    const date = day(-1);
    await createSession(me, program.id, { date, isCompleted: true, source: "auto" });
    const call = mcpTools(registerSessionTools, me);

    const first = await call("log_session", { date, programId: program.id, sets: [{ exerciseId: squat, setNumber: 1, reps: 5, weightKg: 80 }] });
    expect(first.isError, first.raw).toBe(false);
    expect((await sessionsOf(me)).map((s) => s.source)).toEqual(["assistant"]);

    const second = await call("log_session", { date, programId: program.id, sets: [{ exerciseId: squat, setNumber: 1, reps: 5, weightKg: 80 }] });
    expect(second.isError).toBe(true);
    expect(second.raw).toContain("already logged this program");
    expect(await sessionsOf(me)).toHaveLength(1);
  });

  it("refuses a future date, a date too far back and an unknown set key", async () => {
    const call = mcpTools(registerSessionTools, me);
    const set = { exerciseId: squat, setNumber: 1, reps: 5, weightKg: 80 };
    expect((await call("log_session", { date: day(1), sets: [set] })).raw).toContain("future");
    expect((await call("log_session", { date: day(-61), sets: [set] })).raw).toContain("60 days");
    expect((await call("log_session", { date: day(0), sets: [{ ...set, targetReps: 5 }] })).isError).toBe(true);
    expect(await sessionsOf(me)).toEqual([]);
  });

  it("refuses another user's program or custom exercise and writes nothing", async () => {
    const theirs = (await createExercise({ name: "Their lift", userId: other, isCustom: true })).id;
    const { program } = await createProgram(other, [{ exerciseId: squat, sets: [{}] }]);
    const call = mcpTools(registerSessionTools, me);

    const withExercise = await call("log_session", { date: day(0), sets: [{ exerciseId: theirs, setNumber: 1, reps: 5 }] });
    expect(withExercise).toMatchObject({ isError: true, raw: "Error: Exercise not found" });
    const withProgram = await call("log_session", { date: day(0), programId: program.id, sets: [{ exerciseId: squat, setNumber: 1, reps: 5 }] });
    expect(withProgram).toMatchObject({ isError: true, raw: "Error: Program not found" });
    expect(await sessionsOf(me)).toEqual([]);
    expect(await sessionsOf(other)).toEqual([]);
  });
});

describe("confirm_session", () => {
  let programId: number;

  beforeEach(async () => {
    programId = (await createProgram(me, [{ exerciseId: squat, sets: [{}] }])).program.id;
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: day(-10) })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, dayOfWeek: 2, programId });
  });

  it("writes one auto row for the day; a second call is a no-op", async () => {
    const call = mcpTools(registerSessionTools, me);
    expect((await call("confirm_session", { date: day(-3), programId })).data).toMatchObject({ confirmed: true, already: false });
    expect((await call("confirm_session", { date: day(-3), programId })).data).toMatchObject({ confirmed: true, already: true });
    const rows = await sessionsOf(me);
    expect(rows.map((r) => [r.date, r.source, r.isCompleted])).toEqual([[day(-3), "auto", true]]);
  });

  it("refuses a program not in the active cycle, a future day and a day before the cycle", async () => {
    const elsewhere = (await createProgram(me, [{ exerciseId: squat, sets: [{}] }])).program.id;
    const call = mcpTools(registerSessionTools, me);
    expect((await call("confirm_session", { date: day(-1), programId: elsewhere })).raw).toContain("not in the active cycle");
    expect((await call("confirm_session", { date: day(1), programId })).raw).toContain("future");
    expect((await call("confirm_session", { date: day(-11), programId })).raw).toContain("before the cycle started");
    expect(await sessionsOf(me)).toEqual([]);
  });

  it("does not reach another user's cycle", async () => {
    const result = await mcpTools(registerSessionTools, other)("confirm_session", { date: day(-1), programId });
    expect(result).toMatchObject({ isError: true, raw: "Error: No active training cycle" });
    expect(await sessionsOf(me)).toEqual([]);
  });
});
