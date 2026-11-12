import { db } from "@/db";
import { exercisePrs, trainingCycleSlots, trainingCycles, users, workoutSessions, workoutSets } from "@/db/schema";
import { localDateStr } from "@/lib/utils/user-date";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";

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
    expect(second.raw).toContain("already logged this on that day");
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

  // Characterization test for package C2 (docs/plans/sessions.md, 8.1, C11).
  it("takes a confirmed day off the missed list, once", async () => {
    // The last Tuesday before today (the slot's day), within the 7-day window.
    const back = [1, 2, 3, 4, 5, 6, 7].find((o) => addDays(new Date(), -o).getDay() === 2)!;
    asUser(me);
    const missedDates = async () => {
      const r = await getActiveCycleForUser();
      if (!r.success) throw new Error(r.error);
      return r.data!.missedSlots.map((m) => m.date);
    };
    expect(await missedDates()).toContain(day(-back));
    const call = mcpTools(registerSessionTools, me);
    expect((await call("confirm_session", { date: day(-back), programId })).isError).toBe(false);
    expect((await call("confirm_session", { date: day(-back), programId })).data).toMatchObject({ already: true });
    expect(await missedDates()).not.toContain(day(-back));
    expect((await sessionsOf(me)).filter((s) => s.source === "auto")).toHaveLength(1);
  });

  it("does not reach another user's cycle", async () => {
    const result = await mcpTools(registerSessionTools, other)("confirm_session", { date: day(-1), programId });
    expect(result).toMatchObject({ isError: true, raw: "Error: No active training cycle" });
    expect(await sessionsOf(me)).toEqual([]);
  });
});

describe("log_session, review fixes", () => {
  const set = () => ({ exerciseId: squat, setNumber: 1, reps: 5, weightKg: 80 });

  it("refuses a second log of the same exercises on the same day without a program", async () => {
    const call = mcpTools(registerSessionTools, me);
    expect((await call("log_session", { date: day(-1), sets: [set()] })).isError).toBe(false);
    const again = await call("log_session", { date: day(-1), sets: [set()] });
    expect(again.isError).toBe(true);
    expect(again.raw).toContain("already logged");
    expect(await sessionsOf(me)).toHaveLength(1);
  });

  it("writes one session when the same log races", async () => {
    const { program } = await createProgram(me, [{ exerciseId: squat, sets: [{}] }]);
    const call = mcpTools(registerSessionTools, me);
    const args = { date: day(-1), programId: program.id, sets: [set()] };
    const results = await Promise.all([call("log_session", args), call("log_session", args), call("log_session", args)]);
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    expect(await sessionsOf(me)).toHaveLength(1);
  });

  it("refuses a startTime on another day than date", async () => {
    const result = await mcpTools(registerSessionTools, me)("log_session", {
      date: day(-2),
      startTime: `${day(-1)}T09:00:00Z`,
      sets: [set()],
    });
    expect(result.isError).toBe(true);
    expect(result.raw).toContain("startTime");
    expect(await sessionsOf(me)).toEqual([]);
  });

  it("dates a session without a time at noon in the user's time zone", async () => {
    const zone = "Pacific/Kiritimati"; // UTC+14: far from the server's clock
    await db.update(users).set({ timeZone: zone }).where(eq(users.id, me));
    const date = localDateStr(new Date(Date.now() - 2 * 86_400_000), zone);
    const result = await mcpTools(registerSessionTools, me)("log_session", { date, sets: [set()] });
    expect(result.isError, result.raw).toBe(false);
    const [session] = await sessionsOf(me);
    expect(localDateStr(session.startTime, zone)).toBe(date);
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(session.startTime)).toBe("12");
  });

  it("refuses rir and rpe on the same set", async () => {
    const result = await mcpTools(registerSessionTools, me)("log_session", { date: day(-1), sets: [{ ...set(), rir: 2, rpe: 9 }] });
    expect(result.isError).toBe(true);
    expect(result.raw).toContain("rir or rpe");
    expect(await sessionsOf(me)).toEqual([]);
  });
});

