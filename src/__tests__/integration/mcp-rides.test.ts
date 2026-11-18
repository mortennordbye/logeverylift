/**
 * The assistant's tools for bike rides (docs/plans/bike-ride-logger.md, step 5):
 * edit_program_exercise writes ramp, free, outdoor, notes and the FTP test and
 * refuses what does not fit with the reason; log_step_results and
 * get_step_results carry every result field with its source and never replace
 * what the rider typed or Garmin filled; get_ride reads a finished or
 * ended-early ride. Clock: Tue 2026-11-17 12:00 UTC.
 */
import { db } from "@/db";
import { athleteThresholds, plannedSessions, programExercises, trainingCycles, users, workoutSessions, workoutSets } from "@/db/schema";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { saveStepResults } from "@/lib/step-results";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { registerEnduranceAppTools } from "@/lib/mcp/tools/endurance-app";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { sportExerciseId } from "@/lib/session-answers";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const TODAY = "2026-11-17";
const T0 = new Date(`${TODAY}T12:00:00Z`);
const MIN = 60_000;
let me: string;
let other: string;
let bike: number;
let run: number;

/** The mockup ride (4.6): 5 steps once the last recovery is dropped (6 program sets). Keys s1, s3#1, s4#1, s3#2, s4#2, s5. */
const mockup = {
  v: 2,
  sport: "bike",
  name: "Tempo 2 x 15",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 }, note: "Climb at 4%" },
        { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
      ],
    },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
  ],
};

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

const rowsOf = (sessionId: number) => db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId));

/** A started ride of the mockup program in an open workout of today. */
async function startMockRide(userId = me) {
  const { program, slots } = await createStepProgram(userId, bike, mockup);
  const session = await createSession(userId, program.id, { date: TODAY, startTime: T0 });
  const { programExerciseId, setIds } = slots[0];
  const view = ok(await startRide({ sessionId: session.id, programExerciseId, mode: "indoor", clientId: `start-${session.id}` }));
  return { programId: program.id, programExerciseId, sessionId: session.id, rideId: view.ride.id, setIds, ridden: [0, 1, 2, 3, 5].map((i) => setIds[i]) };
}

/** Ride mode's save of a step when it ends (stepLogPayload). */
const clockSave = (sessionId: number, programSetId: number, setNumber: number, seconds = 900) => ({
  sessionId,
  exerciseId: bike,
  setNumber,
  programSetId,
  actualReps: 0,
  weightKg: 0,
  durationSeconds: seconds,
  restTimeSeconds: 0,
  isCompleted: true,
  stepStatus: "done",
  targetOffsetW: 0,
  extendedSeconds: 0,
  sources: { durationSeconds: "clock" },
});

/** A finished ride whose 5 steps the clock saved. */
async function finishedRide() {
  const r = await startMockRide();
  vi.setSystemTime(new Date(T0.getTime() + 66 * MIN));
  const seconds = [900, 900, 300, 900, 900];
  const setNumbers = [1, 2, 3, 4, 6];
  for (const [i, id] of r.ridden.entries()) ok(await logWorkoutSet(clockSave(r.sessionId, id, setNumbers[i], seconds[i])));
  return r;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  other = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  for (const u of [me, other]) await db.insert(athleteThresholds).values({ userId: u, kind: "ftp", value: 180, measuredOn: TODAY, source: "manual" });
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("edit_program_exercise with bike steps", () => {
  it("writes ramp, free, outdoor, notes and the FTP test, and get_program reads them back", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { program, slots } = await createStepProgram(me, bike, mockup);
    const outdoor = { metric: "hr", anchor: "lthr", low: 83, high: 89 };
    const test = {
      v: 2,
      sport: "bike",
      name: "20 min test",
      test: "20min",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 1200 }, ramp: { anchor: "ftp", from: 50, to: 75 }, note: "Two 1 min hard efforts" },
        { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "power", anchor: "ftp", low: 95, high: 105 }, outdoor, note: "Climb at 6%, seated" },
        { type: "cooldown", end: { type: "time", seconds: 600 }, free: true },
      ],
    };
    const r = await call("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, workout: test, reason: "FTP test", expectedVersion: 1 });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.programVersion).toBe(2);

    const got = (await call("get_program", { programId: program.id })).data.programExercises[0];
    expect(got.rideTest).toBe("20min");
    expect(got.programSets.map((s: Record<string, unknown>) => [s.ramp, s.free, s.outdoorTarget, s.note])).toEqual([
      [{ anchor: "ftp", from: 50, to: 75 }, false, null, "Two 1 min hard efforts"],
      [null, false, outdoor, "Climb at 6%, seated"],
      [null, true, null, null],
    ]);

    // A set list leaves the test; a tree without one clears it.
    const sets = got.programSets.map((s: Record<string, unknown>) => ({
      id: s.id,
      setNumber: s.setNumber,
      stepKind: s.stepKind,
      durationSeconds: s.durationSeconds,
      targets: s.targets,
      ramp: s.ramp,
      free: s.free,
      outdoorTarget: s.outdoorTarget,
      note: s.note,
    }));
    const same = await call("edit_program_exercise", { operation: "update", programExerciseId: got.id, sets, reason: "Same", expectedVersion: 2 });
    expect(same.isError, same.raw).toBe(false);
    expect((await db.select().from(programExercises).where(eq(programExercises.id, got.id)))[0].rideTest).toBe("20min");
    const { test: _t, ...plain } = test;
    void _t;
    const cleared = await call("edit_program_exercise", { operation: "update", programExerciseId: got.id, workout: plain, reason: "Not a test", expectedVersion: same.data.programVersion });
    expect(cleared.isError, cleared.raw).toBe(false);
    expect((await db.select().from(programExercises).where(eq(programExercises.id, got.id)))[0].rideTest).toBeNull();
  });

  it("refuses bad bike input with the reason, and writes nothing", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { slots } = await createStepProgram(me, bike, mockup);
    const runSlot = (await createStepProgram(me, run, { v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] })).slots[0];
    const step = (extra: Record<string, unknown>) => ({ type: "work", end: { type: "time", seconds: 600 }, ...extra });
    const tree = (s: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ v: 2, sport: "bike", name: "x", steps: [s], ...extra });
    const write = (programExerciseId: number, body: Record<string, unknown>) =>
      call("edit_program_exercise", { operation: "update", programExerciseId, reason: "Test", expectedVersion: 1, ...body });

    const cases: [number, Record<string, unknown>, string][] = [
      [slots[0].programExerciseId, { workout: tree(step({ target: { metric: "gradient", anchor: "absolute", low: 6, high: 8 } })) }, "gradient is never a target"],
      [slots[0].programExerciseId, { workout: tree(step({ gradient: 6 })) }, "write the climb in the step's note"],
      [slots[0].programExerciseId, { workout: tree(step({ target: { metric: "speed", anchor: "absolute", low: 8, high: 9 } })) }, "speed is a result"],
      [slots[0].programExerciseId, { workout: tree(step({ target: { metric: "power", anchor: "ftp", zone: 2 }, outdoor: { metric: "hr", anchor: "lthr", zone: 2, end: { type: "distance", meters: 5000 } } })) }, "never how the step ends"],
      [slots[0].programExerciseId, { workout: tree(step({ ramp: { anchor: "ftp", from: 50, to: 70 }, target2: { metric: "hr", anchor: "lthr", low: 70, high: 80 } })) }, "a ramp takes no cap"],
      [slots[0].programExerciseId, { workout: tree(step({ ramp: { anchor: "ftp", from: 50, to: 70 }, target: { metric: "power", anchor: "ftp", zone: 2 } })) }, "give a target or a ramp, not both"],
      [slots[0].programExerciseId, { workout: tree(step({ free: true, target: { metric: "power", anchor: "ftp", zone: 2 } })) }, "a free step has no target"],
      [runSlot.programExerciseId, { workout: { v: 2, sport: "run", name: "x", steps: [step({ ramp: { anchor: "ftp", from: 50, to: 70 } })] } }, "ramp is only for bike steps"],
      [runSlot.programExerciseId, { workout: { v: 2, sport: "run", name: "x", test: "ramp", steps: [step({})] } }, "only for bike workouts"],
      [runSlot.programExerciseId, { workout: { v: 2, sport: "run", name: "x", steps: [step({ outdoor: { metric: "rpe", anchor: "absolute", low: 3, high: 4 } })] } }, "outdoor is only for bike steps"],
      [runSlot.programExerciseId, { sets: [{ setNumber: 1, stepKind: "work", durationSeconds: 600, free: true }] }, "free is only for bike steps"],
      // A bike tree sent to a run exercise is checked as the run it is stored as.
      [runSlot.programExerciseId, { workout: tree(step({}), { test: "ramp" }) }, "only for bike workouts"],
    ];
    for (const [id, body, reason] of cases) {
      const r = await write(id, body);
      expect(r.isError, JSON.stringify(body)).toBe(true);
      expect(r.raw).toContain(reason);
    }
    // Nothing changed: the programs are on their first version.
    const call2 = await write(slots[0].programExerciseId, { notes: "Still version 1" });
    expect(call2.isError, call2.raw).toBe(false);
  });

  it("refuses another user's program", async () => {
    const { slots } = await createStepProgram(other, bike, mockup);
    const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, workout: mockup, reason: "x", expectedVersion: 1 });
    expect(r).toMatchObject({ isError: true, raw: expect.stringContaining("not found") });
  });
});

describe("log_step_results and get_step_results on a ride", () => {
  it("writes every result field with source assistant and keeps typed and Garmin values, saying so", async () => {
    const r = await finishedRide();
    // The rider typed step 2's watts; Garmin filled step 5's.
    ok(await logWorkoutSet({ ...clockSave(r.sessionId, r.ridden[1], 2), avgPower: 141, sources: { avgPower: "typed" } }));
    await db.update(workoutSets).set({ avgPower: 118, sources: { durationSeconds: "clock", avgPower: "garmin" } }).where(eq(workoutSets.programSetId, r.ridden[4]));
    const call = mcpTools(registerEnduranceAppTools, me);
    const res = await call("log_step_results", {
      workoutSessionId: r.sessionId,
      steps: [
        { key: "s1", status: "done", activeSeconds: 905, avgPower: 124, avgHr: 128, maxHr: 140, avgCadence: 88, avgSpeed: 9.5, climbM: 40, value: 124, distanceMeters: 8000 },
        { key: "s3#1", status: "done", avgPower: 150, avgHr: 148 },
        { key: "s5", status: "done", avgPower: 130, rpe: 6 },
      ],
      reason: "From the athlete",
    });
    expect(res.isError, res.raw).toBe(false);
    expect(res.data.kept).toEqual([
      { key: "s3#1", fields: [{ field: "avgPower", by: "typed" }] },
      { key: "s5", fields: [{ field: "avgPower", by: "garmin" }] },
    ]);

    const rows = new Map((await rowsOf(r.sessionId)).map((x) => [x.programSetId, x]));
    const s1 = rows.get(r.ridden[0])!;
    expect([s1.durationSeconds, s1.avgPower, s1.avgHr, s1.maxHr, s1.avgCadence, s1.avgSpeed, s1.climbM, s1.measuredValue, s1.distanceMeters]).toEqual([905, 124, 128, 140, 88, 9.5, 40, 124, 8000]);
    expect(s1.sources).toEqual({
      durationSeconds: "assistant",
      distanceMeters: "assistant",
      avgPower: "assistant",
      avgHr: "assistant",
      maxHr: "assistant",
      avgCadence: "assistant",
      avgSpeed: "assistant",
      climbM: "assistant",
      measuredValue: "assistant",
    });
    const s2 = rows.get(r.ridden[1])!;
    expect([s2.avgPower, s2.avgHr, s2.durationSeconds, s2.sources]).toEqual([141, 148, 900, { durationSeconds: "clock", avgPower: "typed", avgHr: "assistant" }]);
    const s5 = rows.get(r.ridden[4])!;
    expect([s5.avgPower, s5.rpe, s5.sources]).toEqual([118, 6, { durationSeconds: "clock", avgPower: "garmin" }]);
    // A step not named stays as the clock saved it, and keeps the plan it was ridden with.
    const s3 = rows.get(r.ridden[2])!;
    expect([s3.durationSeconds, s3.avgPower, s3.sources, s3.stepStatus]).toEqual([300, null, { durationSeconds: "clock" }, "done"]);

    // A second write: the assistant may correct its own values; the rider's effort stays.
    ok(await logWorkoutSet({ ...clockSave(r.sessionId, r.ridden[3], 4), rpe: 7, sources: {} }));
    const again = await call("log_step_results", { workoutSessionId: r.sessionId, steps: [{ key: "s1", status: "done", avgPower: 125 }, { key: "s3#2", status: "skipped", rpe: 5 }], reason: "Fix" });
    expect(again.data.kept).toEqual([{ key: "s3#2", fields: [{ field: "rpe", by: "logged" }, { field: "status", by: "logged" }] }]);
    const after = new Map((await rowsOf(r.sessionId)).map((x) => [x.programSetId, x]));
    expect(after.get(r.ridden[0])!.avgPower).toBe(125);
    expect([after.get(r.ridden[3])!.rpe, after.get(r.ridden[3])!.stepStatus]).toEqual([7, "done"]);

    // get_step_results reads it back, with the sources.
    const got = await call("get_step_results", { workoutSessionId: r.sessionId });
    expect(got.isError, got.raw).toBe(false);
    const byKey = new Map(got.data.steps.map((s: { key: string }) => [s.key, s]));
    expect(byKey.get("s1")).toMatchObject({
      result: { status: "done", activeSeconds: 905, avgPower: 125, avgHr: 128, maxHr: 140, avgCadence: 88, avgSpeed: 9.5, climbM: 40, distanceMeters: 8000 },
      sources: { avgPower: "assistant", durationSeconds: "assistant" },
    });
    expect(byKey.get("s3#1")).toMatchObject({ result: { avgPower: 141, avgHr: 148 }, sources: { avgPower: "typed", avgHr: "assistant" } });
  });

  it("refuses a ride that is still running (D9), and another user's session", async () => {
    const r = await startMockRide();
    const call = mcpTools(registerEnduranceAppTools, me);
    const res = await call("log_step_results", { workoutSessionId: r.sessionId, steps: [{ key: "s1", status: "done", avgPower: 120 }], reason: "x" });
    expect(res).toMatchObject({ isError: true, raw: expect.stringContaining("still running") });
    expect(await rowsOf(r.sessionId)).toEqual([]);

    vi.setSystemTime(new Date(T0.getTime() + 66 * MIN));
    const theirs = mcpTools(registerEnduranceAppTools, other);
    expect(await theirs("log_step_results", { workoutSessionId: r.sessionId, steps: [{ key: "s1", status: "done" }], reason: "x" })).toMatchObject({ isError: true, raw: expect.stringContaining("not found") });
    expect((await theirs("get_step_results", { workoutSessionId: r.sessionId })).data).toEqual({ results: null });
  });

  it("still logs a run by planned session, with heart rate marked as the assistant's", async () => {
    const runId = (await sportExerciseId("run")) ?? (await createExercise({ name: "Built-in run", category: "cardio", discipline: "run" })).id;
    const { program } = await createStepProgram(me, runId, { v: 2, sport: "run", name: "Easy run", steps: [{ type: "work", end: { type: "time", seconds: 1800 } }] });
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-16" }).returning();
    const [p] = await db.insert(plannedSessions).values({ userId: me, cycleId: c.id, date: TODAY, position: 1, programId: program.id }).returning();
    const call = mcpTools(registerEnduranceAppTools, me);
    const res = await call("log_step_results", { plannedSessionId: p.id, steps: [{ key: "s1", status: "done", activeSeconds: 1800, avgHr: 140 }], sessionRpe: 4, reason: "Told me" });
    expect(res.isError, res.raw).toBe(false);
    expect(res.data.written).toBe("new session");
    const [row] = await rowsOf(res.data.workoutSessionId);
    expect([row.durationSeconds, row.avgHr, row.rpe, row.sources]).toEqual([1800, 140, 4, { durationSeconds: "assistant", avgHr: "assistant" }]);
  });
});

describe("get_ride", () => {
  it("reads a finished ride: plan, mode, status, steps planned against done with sources, and the numbers", async () => {
    const r = await finishedRide();
    const watts = [124, 141, 92, 131, 118];
    for (const [i, id] of r.ridden.entries()) {
      await db.update(workoutSets).set({ avgPower: watts[i], rpe: 6, sources: { durationSeconds: "clock", avgPower: "typed" } }).where(and(eq(workoutSets.sessionId, r.sessionId), eq(workoutSets.programSetId, id)));
    }
    const call = mcpTools(registerEnduranceAppTools, me);
    const res = await call("get_ride", { workoutSessionId: r.sessionId });
    expect(res.isError, res.raw).toBe(false);
    const ride = res.data.ride;
    expect(ride).toMatchObject({ rideId: r.rideId, workoutSessionId: r.sessionId, programExerciseId: r.programExerciseId, mode: "indoor", status: "finished" });
    expect(ride.plan).toMatchObject({ ftp: 180, steps: 5, seconds: 3900, openSteps: false });
    expect(ride.plan.intensityFactor).toBeCloseTo(0.71, 2);
    expect(ride.steps.map((s: { key: string }) => s.key)).toEqual(["s1", "s3#1", "s4#1", "s3#2", "s5"]);
    expect(ride.steps[0].planned).toMatchObject({ seconds: 900, ramp: { anchor: "ftp", from: 55, to: 75 }, watts: { from: 99, to: 135 } });
    expect(ride.steps[1].planned.note).toBe("Climb at 4%");
    expect(ride.steps[1].done).toMatchObject({ status: "done", seconds: 900, avgPower: 141, rpe: 6, sources: { durationSeconds: "clock", avgPower: "typed" } });
    expect(ride.numbers).toMatchObject({
      seconds: 3900,
      avgPower: 126,
      npEstimate: 127,
      stream: false,
      np: null,
      intensityFactor: null,
      drift: null,
      timeOnTarget: null,
      heartRateZoneMinutes: null,
      load: { method: "bike_power", estimated: true },
      effort: 6,
    });
    expect(Math.round(ride.numbers.load.value)).toBe(54);

    // The latest ride of the program exercise is the same one.
    expect((await call("get_ride", { programExerciseId: r.programExerciseId })).data.ride.rideId).toBe(r.rideId);
  });

  it("reads an ended-early ride: the steps not ridden have no result", async () => {
    const r = await startMockRide();
    vi.setSystemTime(new Date(T0.getTime() + 20 * MIN));
    ok(await sendRideEvent({ rideId: r.rideId, clientId: "end-1", kind: "end", expectedSeq: 1 }));
    const res = await mcpTools(registerEnduranceAppTools, me)("get_ride", { workoutSessionId: r.sessionId });
    const ride = res.data.ride;
    expect(ride.status).toBe("ended_early");
    expect(ride.steps.map((s: { done: { status: string } | null }) => s.done?.status ?? null)).toEqual(["done", "partial", null, null, null]);
    expect(ride.steps[1].done.seconds).toBe(300);
    // No numbers but the time: no power, no effort, so no load.
    expect(ride.numbers).toMatchObject({ seconds: 1200, avgPower: null, kj: null, load: null });
  });

  it("says a running ride keeps its plan", async () => {
    const r = await startMockRide();
    vi.setSystemTime(new Date(T0.getTime() + 5 * MIN));
    const ride = (await mcpTools(registerEnduranceAppTools, me)("get_ride", { programExerciseId: r.programExerciseId })).data.ride;
    expect(ride.status).toBe("running");
    expect(ride.note).toContain("program edits apply from the next ride");
  });

  it("gives nothing of another user's ride, and refuses a user without endurance features", async () => {
    const r = await startMockRide();
    const theirs = mcpTools(registerEnduranceAppTools, other);
    expect((await theirs("get_ride", { workoutSessionId: r.sessionId })).data).toEqual({ ride: null });
    expect((await theirs("get_ride", { programExerciseId: r.programExerciseId })).data).toEqual({ ride: null });

    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    const call = mcpTools(registerEnduranceAppTools, me);
    expect(await call("get_ride", { workoutSessionId: r.sessionId })).toMatchObject({ isError: true, raw: expect.stringContaining("Endurance features are not on") });
    expect(await call("log_step_results", { workoutSessionId: r.sessionId, steps: [{ key: "s1", status: "done" }], reason: "x" })).toMatchObject({
      isError: true,
      raw: expect.stringContaining("Endurance features are not on"),
    });
  });
});

/** A planned session of today running this program. */
async function plannedFor(programId: number) {
  const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-16" }).returning();
  const [p] = await db.insert(plannedSessions).values({ userId: me, cycleId: c.id, date: TODAY, position: 1, programId }).returning();
  return p.id;
}

/** The mockup with three rounds: set numbers move, so the program's set ids hold other steps. */
const threeRounds = { ...mockup, steps: [mockup.steps[0], { ...mockup.steps[1], count: 3 }, mockup.steps[2]] };

describe("review fixes (step 5)", () => {
  it("refuses results by planned session while a ride started from the program runs on today's open workout (D9)", async () => {
    const r = await startMockRide();
    const planned = await plannedFor(r.programId);
    const res = await mcpTools(registerEnduranceAppTools, me)("log_step_results", { plannedSessionId: planned, steps: [{ key: "s1", status: "done", activeSeconds: 900 }], reason: "x" });
    expect(res).toMatchObject({ isError: true, raw: expect.stringContaining("still running") });
    expect(await rowsOf(r.sessionId)).toEqual([]);
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, r.sessionId));
    expect(session.isCompleted).toBe(false);
  });

  it("a program edit and a new FTP during a ride never reach its saved steps", async () => {
    const r = await startMockRide();
    const call = mcpTools(registerProgramTools, me);
    const edited = await call("edit_program_exercise", { operation: "update", programExerciseId: r.programExerciseId, workout: threeRounds, reason: "More", expectedVersion: 1 });
    expect(edited.isError, edited.raw).toBe(false);
    await db.update(athleteThresholds).set({ value: 250 }).where(eq(athleteThresholds.userId, me));
    // Step 2 (s3#1) ends: ride mode saves it to the program set the ride froze.
    vi.setSystemTime(new Date(T0.getTime() + 31 * MIN));
    ok(await logWorkoutSet(clockSave(r.sessionId, r.ridden[1], 2)));
    const [row] = await rowsOf(r.sessionId);
    const snap = row.plannedStep as { step: { target: unknown }; thresholds: { ftp: number } };
    expect(snap.step.target).toEqual({ metric: "power", anchor: "ftp", low: 75, high: 81 });
    expect(snap.thresholds.ftp).toBe(180);

    // The ride ends: only its own dropped recovery is logged as not done, not the sets added mid-ride.
    vi.setSystemTime(new Date(T0.getTime() + 66 * MIN));
    ok(await getRide({ rideId: r.rideId }));
    const notDone = (await rowsOf(r.sessionId)).filter((x) => x.stepStatus === "not_done");
    expect(notDone.map((x) => x.programSetId)).toEqual([r.setIds[4]]);
    expect((notDone[0].plannedStep as { thresholds: { ftp: number } }).thresholds.ftp).toBe(180);
  });

  it("maps keys through the ride's frozen plan after the program changed, and refuses a changed program without a ride", async () => {
    const r = await finishedRide();
    const call = mcpTools(registerEnduranceAppTools, me);
    const edited = await mcpTools(registerProgramTools, me)("edit_program_exercise", { operation: "update", programExerciseId: r.programExerciseId, workout: threeRounds, reason: "More", expectedVersion: 1 });
    expect(edited.isError, edited.raw).toBe(false);
    const res = await call("log_step_results", { workoutSessionId: r.sessionId, steps: [{ key: "s5", status: "done", avgPower: 130 }], reason: "x" });
    expect(res.isError, res.raw).toBe(false);
    const rows = new Map((await rowsOf(r.sessionId)).map((x) => [x.programSetId, x]));
    expect(rows.get(r.ridden[4])!.avgPower).toBe(130);
    expect(rows.size).toBe(5);
    const got = await call("get_step_results", { workoutSessionId: r.sessionId });
    expect(got.data.steps.find((x: { key: string }) => x.key === "s5")).toMatchObject({ result: { avgPower: 130 } });

    // A session with no ride: logged against the old program, refused after it changed.
    const { program, slots } = await createStepProgram(me, bike, mockup);
    const session = await createSession(me, program.id, { date: TODAY, startTime: T0 });
    const first = await call("log_step_results", { workoutSessionId: session.id, steps: [{ key: "s1", status: "done", activeSeconds: 900 }, { key: "s5", status: "done", activeSeconds: 900 }], reason: "x" });
    expect(first.isError, first.raw).toBe(false);
    await mcpTools(registerProgramTools, me)("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, workout: threeRounds, reason: "More", expectedVersion: 1 });
    expect(await call("log_step_results", { workoutSessionId: session.id, steps: [{ key: "s5", status: "done", avgPower: 130 }], reason: "x" })).toMatchObject({
      isError: true,
      raw: expect.stringContaining("program changed"),
    });
  });

  it("writes only the steps it names, keeps the source of an unchanged value, and keeps a done step done", async () => {
    const r = await finishedRide();
    ok(await logWorkoutSet({ ...clockSave(r.sessionId, r.ridden[1], 2), avgPower: 141, sources: { avgPower: "typed" } }));
    const res = await mcpTools(registerEnduranceAppTools, me)("log_step_results", {
      workoutSessionId: r.sessionId,
      steps: [{ key: "s3#1", status: "partial", avgPower: 141 }],
      reason: "x",
    });
    expect(res.isError, res.raw).toBe(false);
    const rows = await rowsOf(r.sessionId);
    expect(rows).toHaveLength(5);
    const s2 = rows.find((x) => x.programSetId === r.ridden[1])!;
    expect([s2.avgPower, s2.stepStatus, s2.isCompleted, s2.sources]).toEqual([141, "done", true, { durationSeconds: "clock", avgPower: "typed" }]);
  });

  it("the guided player's save leaves ride numbers it does not send, and drops the source of what it replaces", async () => {
    const { program, slots } = await createStepProgram(me, bike, mockup);
    const planned = await plannedFor(program.id);
    const session = await createSession(me, program.id, { date: TODAY, startTime: T0, plannedSessionId: planned, source: "app" });
    const id = slots[0].setIds[0];
    ok(await logWorkoutSet({ ...clockSave(session.id, id, 1), avgPower: 124, maxHr: 150, sources: { durationSeconds: "clock", avgPower: "typed", maxHr: "typed" } }));
    await saveStepResults(me, { plannedSessionId: planned, steps: [{ key: "s1", status: "done", activeSeconds: 800 }] }, "player");
    const row = (await rowsOf(session.id)).find((x) => x.programSetId === id)!;
    expect([row.durationSeconds, row.avgPower, row.maxHr, row.sources]).toEqual([800, 124, 150, { avgPower: "typed", maxHr: "typed" }]);
  });

  it("says plainly that a gradient is no target in a set list too", async () => {
    const { slots } = await createStepProgram(me, bike, mockup);
    const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      sets: [{ setNumber: 1, stepKind: "work", durationSeconds: 600, targets: [{ metric: "gradient", anchor: "absolute", low: 6, high: 8 }] }],
      reason: "x",
      expectedVersion: 1,
    });
    expect(r).toMatchObject({ isError: true, raw: expect.stringContaining("gradient is never a target") });
  });
});
