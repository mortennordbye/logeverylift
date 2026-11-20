/**
 * The assistant's tools for runs (docs/plans/run-logger.md, step 5):
 * edit_program_exercise writes belt, incline, outdoor and the run test;
 * get_ride reads a run from run mode with the numbers of 4.9 that need no
 * stream; log_step_results and get_step_results carry belt values and their
 * sources. Clock: Fri 2026-11-20 17:00 UTC.
 */
import { db } from "@/db";
import { athleteThresholds, programSets, workoutSets } from "@/db/schema";
import { sendRideEvent, setRideEndReason, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { registerEnduranceAppTools } from "@/lib/mcp/tools/endurance-app";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { beltResults } from "@/lib/utils/run-screen";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { workoutToRows } from "@/lib/utils/program-steps";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const T0 = new Date("2026-11-20T17:00:00Z");
let me: string;
let bike: number;
let run: number;
let ids = 0;
const cid = () => `m${++ids}`;

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/**
 * Warm-up 10 min at 8 km/h and 1%, 6 x (30 s at 13 km/h, 90 s at 7 km/h),
 * 10 min in heart rate zone 2 (belt 8.2 km/h from the zone), and a 5 min
 * cool-down with no target (belt by feel). Keys s1, s3#1, s4#1 ... s4#6, s5, s6.
 */
const treadmillRun = {
  v: 2,
  sport: "run",
  name: "Base with strides",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, belt: 8, incline: 1 },
    { type: "repeat", count: 6, steps: [{ type: "work", end: { type: "time", seconds: 30 }, belt: 13 }, { type: "recovery", end: { type: "time", seconds: 90 }, belt: 7 }] },
    { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    { type: "cooldown", end: { type: "time", seconds: 300 } },
  ],
};
const RUN_SECONDS = 600 + 6 * 120 + 600 + 300;

/** Run mode's save of each step the timeline ended, with the belt numbers on a treadmill. */
async function saveSteps(sessionId: number, view: { plan: RidePlan; events: Parameters<typeof rideTimeline>[1] }, extra: (key: string) => Record<string, unknown> = () => ({})) {
  const t = rideTimeline(view.plan, view.events, Date.now());
  for (const [i, r] of t.steps.entries()) {
    const b = view.plan.mode === "indoor" ? beltResults(r) : {};
    ok(
      await logWorkoutSet({
        sessionId,
        exerciseId: run,
        setNumber: i + 1,
        programSetId: r.programSetId,
        actualReps: 0,
        weightKg: 0,
        durationSeconds: r.activeSeconds,
        restTimeSeconds: 0,
        isCompleted: r.status !== "skipped",
        stepStatus: r.status,
        targetOffsetW: 0,
        extendedSeconds: 0,
        ...b,
        sources: { durationSeconds: "clock", ...(b.distanceMeters !== undefined && { distanceMeters: "belt", avgSpeed: "belt" }) },
        ...extra(r.key),
      }),
    );
  }
}

/** A treadmill run of treadmillRun with the belt tapped to 9.0 km/h after 1 min, run to its end and saved. */
async function treadmillDone() {
  const { program, slots } = await createStepProgram(me, run, treadmillRun);
  const session = await createSession(me, program.id);
  const view = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
  // The 5 s count before the clock runs (step 3).
  const start = rideTimeline(view.plan, view.events, Date.now()).startedAt!;
  vi.setSystemTime(new Date(start + 60_000));
  const tap = ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "belt", value: 90, stepKey: "s1", expectedSeq: view.ride.seq }));
  vi.setSystemTime(new Date(start + RUN_SECONDS * 1000 + 1000));
  await saveSteps(session.id, tap);
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, sessionId: session.id, rideId: view.ride.id, setIds: slots[0].setIds };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
  ]);
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("edit_program_exercise with run steps", () => {
  it("writes belt, incline, an outdoor target and the run test from a tree, and get_program reads them back", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { program, slots } = await createStepProgram(me, run, { v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const outdoor = { metric: "hr", anchor: "lthr", low: 85, high: 89 };
    const test = {
      v: 2,
      sport: "run",
      name: "30 min test",
      test: "30min",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 900 }, belt: 8.5, incline: 1, note: "3 x 1 min pickups" },
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "rpe", anchor: "absolute", low: 10, high: 10 }, belt: 10, incline: 1.5, outdoor },
        { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "rpe", anchor: "absolute", low: 10, high: 10 }, belt: 10.5, incline: 1.5 },
      ],
    };
    const r = await call("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, workout: test, reason: "Run test", expectedVersion: 1 });
    expect(r.isError, r.raw).toBe(false);

    const got = (await call("get_program", { programId: program.id })).data.programExercises[0];
    expect(got.rideTest).toBe("30min");
    expect(got.programSets.map((s: Record<string, unknown>) => [s.beltKmh, s.inclinePercent, s.outdoorTarget, s.note])).toEqual([
      [8.5, 1, null, "3 x 1 min pickups"],
      [10, 1.5, outdoor, null],
      [10.5, 1.5, null, null],
    ]);
  });

  it("writes belt and incline from a set list, and refuses them on a bike and a ramp or free spin on a run", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { slots } = await createStepProgram(me, run, { v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const r = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      sets: [
        { setNumber: 1, stepKind: "work", durationSeconds: 30, beltKmh: 13, inclinePercent: 0.5 },
        { setNumber: 2, stepKind: "recovery", durationSeconds: 90, beltKmh: 7 },
      ],
      reason: "Strides",
      expectedVersion: 1,
    });
    expect(r.isError, r.raw).toBe(false);
    const stored = await db.select().from(programSets).where(eq(programSets.programExerciseId, slots[0].programExerciseId));
    expect(stored.filter((s) => s.deletedAt === null).sort((a, b) => a.setNumber - b.setNumber).map((s) => [s.beltKmh, s.inclinePercent])).toEqual([
      [13, 0.5],
      [7, null],
    ]);

    const b = await createStepProgram(me, bike, { v: 2, sport: "bike", name: "Spin", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const onBike = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: b.slots[0].programExerciseId,
      workout: { v: 2, sport: "bike", name: "Spin", steps: [{ type: "work", end: { type: "time", seconds: 600 }, belt: 9 }] },
      reason: "Spin",
      expectedVersion: 1,
    });
    expect(onBike.isError).toBe(true);
    expect(onBike.raw).toMatch(/belt is only for run steps/);
    const ramp = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      workout: { v: 2, sport: "run", name: "Ramp", steps: [{ type: "work", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 } }] },
      reason: "Ramp",
      expectedVersion: 2,
    });
    expect(ramp.isError).toBe(true);
    expect(ramp.raw).toMatch(/ramp is only for bike steps/);
  });
});

describe("get_ride on a run", () => {
  it("reads a treadmill run: plan and done belts with their sources, distance from the belt, GAP and the run_gap load, and no stream numbers yet", async () => {
    const r = await treadmillDone();
    const call = mcpTools(registerEnduranceAppTools, me);
    const got = await call("get_ride", { workoutSessionId: r.sessionId });
    expect(got.isError, got.raw).toBe(false);
    const ride = got.data.ride;
    expect(ride).toMatchObject({ sport: "run", rideId: r.rideId, mode: "indoor", modeName: "Treadmill", surface: null, status: "finished", endReason: null, brick: null, garmin: null });
    expect(ride.plan).toMatchObject({ thresholdPace: "5:39 /km", lthrRun: 180, seconds: RUN_SECONDS, openSteps: false });
    expect(ride.steps.map((s: { key: string }) => s.key)).toEqual(["s1", ...Array.from({ length: 6 }, (_, i) => [`s3#${i + 1}`, `s4#${i + 1}`]).flat(), "s5", "s6"]);

    const [warm, stride] = ride.steps;
    expect(warm.planned).toMatchObject({ rule: "time", beltKmh: 8, beltFrom: "step", inclinePercent: 1 });
    // 1 min at 8.0 and 9 min at 9.0 km/h: 1483 m, 8.9 km/h on average.
    expect(warm.done).toMatchObject({ status: "done", seconds: 600, distanceMeters: 1483, beltKmh: 8.9, inclinePercent: 1, sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" } });
    expect(stride.block).not.toBeNull();
    expect(stride.planned).toMatchObject({ beltKmh: 13 });
    const zone = ride.steps.at(-2);
    expect(zone.planned).toMatchObject({ beltKmh: 8.2, beltFrom: "zone", target: "HR under 160" });
    expect(ride.steps.at(-1).planned).toMatchObject({ beltKmh: null });
    expect(ride.steps.at(-1).done).toMatchObject({ distanceMeters: null, beltKmh: null });

    expect(ride.numbers).toMatchObject({ seconds: RUN_SECONDS, distanceSource: "Distance from the belt", stream: false, drift: null, timeOnTarget: null, zonesFrom: "steps" });
    expect(ride.numbers.distanceMeters).toBeGreaterThan(3000);
    expect(ride.numbers.gapSPerKm).toBeLessThanOrEqual(ride.numbers.paceSPerKm);
    // The cool-down ran by feel, so distance covers under 90% of the time: no pace load, and no effort given.
    expect(ride.numbers.load).toBeNull();
  });

  it("reads an outdoor run on trail that ended early with its reason, by its program exercise", async () => {
    const { program, slots } = await createStepProgram(me, run, treadmillRun);
    const session = await createSession(me, program.id);
    const view = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "outdoor", surface: "trail", clientId: cid() }));
    vi.setSystemTime(new Date(T0.getTime() + 5 * 60_000));
    const ended = ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "end", expectedSeq: view.ride.seq }));
    await saveSteps(session.id, ended, () => ({ avgHr: 150, sources: { durationSeconds: "clock", avgHr: "typed" } }));
    ok(await setRideEndReason({ rideId: view.ride.id, reason: "pain" }));

    const call = mcpTools(registerEnduranceAppTools, me);
    const ride = (await call("get_ride", { programExerciseId: slots[0].programExerciseId })).data.ride;
    expect(ride).toMatchObject({ sport: "run", mode: "outdoor", modeName: "Outdoor", surface: "trail", status: "ended_early", endReason: "pain" });
    expect(ride.steps[0].planned).not.toHaveProperty("beltKmh");
    expect(ride.steps[0].planned).toHaveProperty("outdoor");
    expect(ride.steps[0].done).toMatchObject({ status: "partial", avgHr: 150, sources: { avgHr: "typed" } });
    expect(ride.steps[0].done).not.toHaveProperty("beltKmh");
    // Outdoors GAP needs the stream; no distance, so no pace load.
    expect(ride.numbers).toMatchObject({ gapSPerKm: null, distanceMeters: null, stream: false });
  });

  it("in a session with a ride and a run reads the later one, and the ride with its program exercise", async () => {
    const s = await brickSession();
    const call = mcpTools(registerEnduranceAppTools, me);
    expect((await call("get_ride", { workoutSessionId: s.sessionId })).data.ride).toMatchObject({ sport: "run", programExerciseId: s.runPe });
    expect((await call("get_ride", { workoutSessionId: s.sessionId, programExerciseId: s.bikePe })).data.ride).toMatchObject({ sport: "bike", programExerciseId: s.bikePe });
    expect((await call("get_ride", {})).raw).toMatch(/Send workoutSessionId or programExerciseId/);
  });
});

/** A program with a ride then a run in one session, each started and ended (a brick in one program). */
async function brickSession() {
  const ride = { v: 2, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", zone: 2 } }] };
  const runW = { v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 }, belt: 9 }] };
  const rows = (w: unknown) => {
    const p = parseWorkout(w);
    if (!p.ok) throw new Error("bad workout");
    return workoutToRows(p.workout as Workout).map((x) => ({ ...x, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
  };
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 180, measuredOn: "2026-11-01", source: "manual" });
  const { program, slots } = await createProgram(me, [
    { exerciseId: bike, sets: rows(ride) },
    { exerciseId: run, sets: rows(runW) },
  ]);
  const session = await createSession(me, program.id);
  const b = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
  vi.setSystemTime(new Date(T0.getTime() + 60_000));
  ok(await sendRideEvent({ rideId: b.ride.id, clientId: cid(), kind: "end", expectedSeq: b.ride.seq }));
  vi.setSystemTime(new Date(T0.getTime() + 2 * 60_000));
  const r = ok(await startRide({ sessionId: session.id, programExerciseId: slots[1].programExerciseId, mode: "indoor", clientId: cid() }));
  vi.setSystemTime(new Date(T0.getTime() + 4 * 60_000));
  ok(await sendRideEvent({ rideId: r.ride.id, clientId: cid(), kind: "end", expectedSeq: r.ride.seq }));
  return { sessionId: session.id, bikePe: slots[0].programExerciseId, runPe: slots[1].programExerciseId, bikeSets: slots[0].setIds, runSets: slots[1].setIds };
}

describe("log_step_results and get_step_results on a run", () => {
  it("write a belt and an incline where the belt gave none, keep the belt's numbers, and read them back with their sources", async () => {
    const r = await treadmillDone();
    const call = mcpTools(registerEnduranceAppTools, me);
    const w = await call("log_step_results", {
      workoutSessionId: r.sessionId,
      steps: [
        // The cool-down ran by feel: no belt value yet.
        { key: "s6", status: "done", beltKmh: 6, inclinePercent: 0.5, avgHr: 140 },
        // The warm-up's belt and incline are the belt's.
        { key: "s1", status: "done", beltKmh: 10, inclinePercent: 2 },
      ],
      reason: "From the runner",
    });
    expect(w.isError, w.raw).toBe(false);
    expect(w.data.kept).toEqual([
      {
        key: "s1",
        fields: [
          { field: "distanceMeters", by: "belt" },
          { field: "avgSpeed", by: "belt" },
          { field: "inclinePercent", by: "belt" },
        ],
      },
    ]);
    const [cool] = await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, r.sessionId), eq(workoutSets.programSetId, r.setIds.at(-1)!)));
    // 5 min at 6 km/h is 500 m.
    expect(cool).toMatchObject({ distanceMeters: 500, inclinePercent: 0.5, avgHr: 140, sources: { durationSeconds: "clock", distanceMeters: "assistant", avgSpeed: "assistant", avgHr: "assistant" } });
    expect(cool.avgSpeed).toBeCloseTo(6 / 3.6, 4);

    const got = await call("get_step_results", { workoutSessionId: r.sessionId });
    expect(got.isError, got.raw).toBe(false);
    const byKey = new Map(got.data.steps.map((s: { key: string }) => [s.key, s]));
    expect(byKey.get("s1")).toMatchObject({
      planned: { belt: { kmh: 8, inclinePercent: 1 } },
      result: { beltKmh: 8.9, inclinePercent: 1, distanceMeters: 1483 },
      sources: { distanceMeters: "belt", avgSpeed: "belt" },
    });
    expect(byKey.get("s6")).toMatchObject({ planned: { belt: { kmh: null, inclinePercent: null } }, result: { beltKmh: 6, inclinePercent: 0.5 }, sources: { avgSpeed: "assistant" } });

    // With the cool-down's distance, the run has a pace load.
    const ride = (await mcpTools(registerEnduranceAppTools, me)("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(ride.numbers).toMatchObject({ distanceSource: "Distance from the belt and the assistant", load: { method: "run_gap", estimated: true } });
    expect(ride.steps.at(-1).done).toMatchObject({ beltKmh: 6, inclinePercent: 0.5, distanceMeters: 500 });
  });

  it("refuses a belt on an outdoor run and a belt with a speed", async () => {
    const { program, slots } = await createStepProgram(me, run, treadmillRun);
    const session = await createSession(me, program.id);
    const view = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "outdoor", clientId: cid() }));
    vi.setSystemTime(new Date(T0.getTime() + 5 * 60_000));
    ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "end", expectedSeq: view.ride.seq }));
    const call = mcpTools(registerEnduranceAppTools, me);
    const outdoor = await call("log_step_results", { workoutSessionId: session.id, steps: [{ key: "s1", status: "done", beltKmh: 9 }], reason: "x" });
    expect(outdoor.isError).toBe(true);
    expect(outdoor.raw).toMatch(/only for the steps of a treadmill run from run mode; this is an outdoor run/);
    const both = await call("log_step_results", { workoutSessionId: session.id, steps: [{ key: "s1", status: "done", beltKmh: 9, avgSpeed: 2.5 }], reason: "x" });
    expect(both.isError).toBe(true);
    expect(both.raw).toMatch(/send beltKmh or avgSpeed, not both/);
  });

  it("in a session with a ride and a run keys each step with its exercise's place", async () => {
    const s = await brickSession();
    const call = mcpTools(registerEnduranceAppTools, me);
    const plain = await call("log_step_results", { workoutSessionId: s.sessionId, steps: [{ key: "s1", status: "done", avgHr: 150 }], reason: "x" });
    expect(plain.isError).toBe(true);
    expect(plain.raw).toMatch(/start it with its exercise's place \((e2:s1 or e1:s1|e1:s1 or e2:s1)\)/);
    const placed = await call("log_step_results", { workoutSessionId: s.sessionId, steps: [{ key: "e2:s1", status: "done", activeSeconds: 120, beltKmh: 9.5 }], reason: "x" });
    expect(placed.isError, placed.raw).toBe(false);
    const got = (await call("get_step_results", { workoutSessionId: s.sessionId })).data;
    expect(got.steps.find((x: { key: string }) => x.key === "e2:s1")).toMatchObject({ planned: { belt: { kmh: 9 } }, result: { beltKmh: 9.5, distanceMeters: 317 } });
  });
});
