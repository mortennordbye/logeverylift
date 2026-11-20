/**
 * The run threshold test (docs/plans/run-logger.md, 4.10, step 8): the
 * assistant writes the app's templates with edit_program_exercise runTest, a
 * test run freezes its test, get_ride gives the proposed LTHR and pace, Save
 * on the summary (saveRunThreshold) adds the rows through addThreshold, a
 * running session keeps its frozen plan (section 7 integration 10), and a test
 * does not start within 7 days of being sick. Clock: Wed 2026-11-18 12:00 UTC.
 */
import { db } from "@/db";
import { athleteThresholds, illnessPeriods, programExercises, programSets, rides, users } from "@/db/schema";
import { saveRunThreshold } from "@/lib/actions/run-test";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { registerEnduranceAppTools } from "@/lib/mcp/tools/endurance-app";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { runAfterView, runExerciseView } from "@/lib/run-exercise-view";
import { thresholdValues } from "@/lib/session-compliance";
import { rideTimeline } from "@/lib/utils/ride-timeline";
import { beltResults } from "@/lib/utils/run-screen";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const TODAY = "2026-11-18";
const T0 = new Date(`${TODAY}T12:00:00Z`);
const MIN = 60_000;
let me: string;
let other: string;
let run: number;
let bike: number;
let ids = 0;
const cid = () => `t${++ids}`;

function ok<T>(r: { success: true; data: T } | { success: false; error: string; fieldErrors?: unknown }): T {
  if (!r.success) throw new Error(`${r.error} ${JSON.stringify(r.fieldErrors ?? "")}`);
  return r.data;
}

const easy = { v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] };
/** 10 min at 130% of threshold speed: its belt reads the threshold pace on a treadmill. */
const fast = { v: 2, sport: "run", name: "Fast", steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "pace", anchor: "threshold_pace", low: 130, high: 130 } }] };

const rows = (userId = me) =>
  db.select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, userId), eq(athleteThresholds.source, "test"), isNull(athleteThresholds.deletedAt)));

/** A run slot the assistant turned into the run test, and its sets in run order. */
async function testSlot(mode: "treadmill" | "outdoor" = "treadmill") {
  const { program, slots } = await createStepProgram(me, run, easy);
  const programExerciseId = slots[0].programExerciseId;
  const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", { operation: "update", programExerciseId, runTest: mode, reason: "Run test", expectedVersion: 1 });
  expect(r.isError, r.raw).toBe(false);
  const sets = await db.select().from(programSets).where(eq(programSets.programExerciseId, programExerciseId)).orderBy(asc(programSets.setNumber));
  return { programId: program.id, programExerciseId, sets };
}

/**
 * A treadmill test run from start to end: the belt up to 11.5 km/h 1 min into
 * the 10 min step, each step saved as run mode saves it, the 20 min step's
 * heart rate typed in the results table (176) and effort 9.
 */
async function treadmillTest(opts: { hr?: number } = {}) {
  const slot = await testSlot();
  const session = await createSession(me, slot.programId, { date: TODAY, startTime: T0 });
  const view = ok(await startRide({ sessionId: session.id, programExerciseId: slot.programExerciseId, mode: "indoor", clientId: cid() }));
  expect(view.plan.test).toBe("30min");
  vi.setSystemTime(new Date(T0.getTime() + 16 * MIN));
  ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "belt", value: 115, stepKey: view.plan.steps[7].key, expectedSeq: 1 }));
  vi.setSystemTime(new Date(T0.getTime() + 56 * MIN));
  const r = ok(await getRide({ rideId: view.ride.id }))!;
  const t = rideTimeline(r.plan, r.events, Date.now());
  expect(t.status).toBe("finished");
  for (const [i, step] of t.steps.entries()) {
    const b = beltResults(step);
    ok(
      await logWorkoutSet({
        sessionId: session.id,
        exerciseId: run,
        setNumber: i + 1,
        programSetId: step.programSetId,
        actualReps: 0,
        weightKg: 0,
        durationSeconds: step.activeSeconds,
        restTimeSeconds: 0,
        isCompleted: true,
        stepStatus: step.status,
        targetOffsetW: 0,
        extendedSeconds: 0,
        ...b,
        ...(i === 8 && { avgHr: opts.hr ?? 176, rpe: 9 }),
        sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt", ...(i === 8 && { avgHr: "typed" }) },
      }),
    );
  }
  return { ...slot, sessionId: session.id, rideId: view.ride.id };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  other = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 320, measuredOn: "2026-10-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-10-01", source: "manual" },
  ]);
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("edit_program_exercise runTest", () => {
  it("writes the treadmill template with its test, and get_program reads it back", async () => {
    const { programId, sets } = await testSlot("treadmill");
    expect(sets.map((s) => s.durationSeconds)).toEqual([540, 60, 60, 60, 60, 60, 60, 600, 1200, 600]);
    expect(sets.map((s) => s.stepKind)).toEqual(["warmup", "work", "recovery", "work", "recovery", "work", "recovery", "work", "work", "cooldown"]);
    expect(Number(sets[7].beltKmh)).toBe(10);
    const got = (await mcpTools(registerProgramTools, me)("get_program", { programId })).data.programExercises[0];
    expect(got.rideTest).toBe("30min");
  });

  it("writes the outdoor template with no belt", async () => {
    const { programExerciseId, sets } = await testSlot("outdoor");
    expect(sets.every((s) => s.beltKmh === null)).toBe(true);
    const [pe] = await db.select({ rideTest: programExercises.rideTest }).from(programExercises).where(eq(programExercises.id, programExerciseId));
    expect(pe.rideTest).toBe("30min");
  });

  it("refuses runTest with sets, a tree or ftpTest, and on a bike slot", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { slots } = await createStepProgram(me, run, easy);
    const both = await call("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, runTest: "outdoor", workout: easy, reason: "x", expectedVersion: 1 });
    expect(both.isError).toBe(true);
    expect(both.raw).toContain("send one of sets, workout, ftpTest or runTest");
    const bikeProgram = await createStepProgram(me, bike, { v: 2, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const onBike = await call("edit_program_exercise", { operation: "update", programExerciseId: bikeProgram.slots[0].programExerciseId, runTest: "treadmill", reason: "x", expectedVersion: 1 });
    expect(onBike.isError).toBe(true);
  });
});

describe("a run test", () => {
  it("get_ride proposes LTHR and the pace of the whole 30 min, and Save adds both rows once", async () => {
    const r = await treadmillTest();
    const call = mcpTools(registerEnduranceAppTools, me);
    const before = (await call("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(before.thresholdTest).toMatchObject({
      test: "30min",
      proposedLthr: 176,
      proposedThresholdPace: "5:14 /km",
      currentLthr: 180,
      currentThresholdPace: "5:20 /km",
      band: "save",
      valid: true,
      failedChecks: [],
      saved: false,
      measuredOn: TODAY,
      protocol: "run_30min",
    });

    expect(ok(await saveRunThreshold({ rideId: r.rideId }))).toMatchObject({ lthr: 176 });
    const stored = await rows();
    expect(stored.map((x) => [x.kind, x.protocol, x.measuredOn, x.testData])).toEqual(
      expect.arrayContaining([
        ["lthr_run", "run_30min", TODAY, { avgHrLast20: 176 }],
        ["run_threshold_pace", "run_30min", TODAY, { distance30Meters: 5725 }],
      ]),
    );
    const th = await thresholdValues(me);
    expect(th.lthr_run).toBe(176);
    // 1 min at 10.0 and 29 min at 11.5 km/h.
    expect(th.run_threshold_pace).toBeCloseTo(5725 / 1800, 6);

    // Saved: a second Save adds nothing; the run keeps its frozen thresholds.
    ok(await saveRunThreshold({ rideId: r.rideId }));
    expect(await rows()).toHaveLength(2);
    const after = (await call("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(after.thresholdTest).toMatchObject({ saved: true, currentLthr: 176, currentThresholdPace: "5:14 /km" });
    expect(after.plan.lthrRun).toBe(180);
    expect((await runAfterView(me, r.programExerciseId))?.thresholdTest).toMatchObject({ saved: true });
  });

  it("10: a threshold save during a running session leaves its frozen plan unchanged; the next run reads the new value", async () => {
    const test = await treadmillTest();
    // Another run starts: 130% of 5:20 /km is 14.6, so 14.5 km/h.
    const { program, slots } = await createStepProgram(me, run, fast);
    const session = await createSession(me, program.id, { date: TODAY, startTime: new Date() });
    const live = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    expect(live.plan.steps[0].run?.belt).toBe(145);
    const [frozen] = await db.select({ plan: rides.plan }).from(rides).where(eq(rides.id, live.ride.id));

    ok(await saveRunThreshold({ rideId: test.rideId }));

    const [still] = await db.select({ plan: rides.plan }).from(rides).where(eq(rides.id, live.ride.id));
    expect(still.plan).toEqual(frozen.plan);
    const now = ok(await getRide({ rideId: live.ride.id }))!;
    expect(now.plan.steps[0].run?.belt).toBe(145);
    expect(now.plan.thresholds.run_threshold_pace).toBeCloseTo(1000 / 320, 6);
    // Every other % target reads the new pace: 130% of 5:14 /km is 14.9, so 15.0 km/h.
    const sets = await db.select().from(programSets).where(eq(programSets.programExerciseId, slots[0].programExerciseId));
    const view = await runExerciseView(me, slots[0].programExerciseId, "Fast", sets as never);
    expect(view?.treadmill.rows[0].detail).toBe("Belt 15.0 km/h");
  });

  it("a test with no heart rate and no belt tap gives nothing; a running test cannot be saved", async () => {
    const slot = await testSlot();
    const session = await createSession(me, slot.programId, { date: TODAY, startTime: T0 });
    const view = ok(await startRide({ sessionId: session.id, programExerciseId: slot.programExerciseId, mode: "indoor", clientId: cid() }));
    expect(await saveRunThreshold({ rideId: view.ride.id })).toMatchObject({ success: false, error: "The run is still running" });
    vi.setSystemTime(new Date(T0.getTime() + 56 * MIN));
    expect(await saveRunThreshold({ rideId: view.ride.id })).toMatchObject({ success: false, error: "This run gives no threshold" });
    expect(await rows()).toHaveLength(0);
  });

  it("refuses another user's run and endurance off", async () => {
    const r = await treadmillTest();
    asUser(other);
    expect(await saveRunThreshold({ rideId: r.rideId })).toMatchObject({ success: false, error: "Not found" });
    expect(await rows(other)).toHaveLength(0);
    asUser(me);
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    expect(await saveRunThreshold({ rideId: r.rideId })).toMatchObject({ success: false, error: "Endurance features are not on for this account" });
    expect(await rows()).toHaveLength(0);
  });

  it("a heart rate far from the current LTHR says retest; the values still save", async () => {
    const r = await treadmillTest({ hr: 165 });
    const ride = (await mcpTools(registerEnduranceAppTools, me)("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(ride.thresholdTest).toMatchObject({ proposedLthr: 165, band: "retest" });
    ok(await saveRunThreshold({ rideId: r.rideId }));
    expect((await thresholdValues(me)).lthr_run).toBe(165);
  });
});

describe("the start check after being sick", () => {
  it("refuses the test while sick or within 7 days after; a plain run starts", async () => {
    const slot = await testSlot();
    const session = await createSession(me, slot.programId, { date: TODAY, startTime: T0 });
    await db.insert(illnessPeriods).values({ userId: me, startedOn: "2026-11-08", endedOn: "2026-11-12" });
    expect(await startRide({ sessionId: session.id, programExerciseId: slot.programExerciseId, mode: "indoor", clientId: cid() })).toMatchObject({
      success: false,
      error: "Wait 7 days after being sick",
    });
    expect((await runExerciseView(me, slot.programExerciseId, "Test", slot.sets as never, "30min"))?.test).toEqual({ sick: true });

    const plain = await createStepProgram(me, run, easy);
    const s2 = await createSession(me, plain.program.id, { date: TODAY, startTime: T0 });
    ok(await startRide({ sessionId: s2.id, programExerciseId: plain.slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
  });

  it("starts 7 days after the last sick day", async () => {
    const slot = await testSlot();
    const session = await createSession(me, slot.programId, { date: TODAY, startTime: T0 });
    await db.insert(illnessPeriods).values({ userId: me, startedOn: "2026-11-05", endedOn: "2026-11-11" });
    expect((await runExerciseView(me, slot.programExerciseId, "Test", slot.sets as never, "30min"))?.test).toEqual({ sick: false });
    ok(await startRide({ sessionId: session.id, programExerciseId: slot.programExerciseId, mode: "indoor", clientId: cid() }));
  });
});
