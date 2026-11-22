/**
 * The run after it is run (docs/plans/run-logger.md, step 4): the belts and
 * easy pace of the runner's own runs reach the next run's frozen plan, a run's
 * logged steps give a pace load per step (method run_gap), the summary reads
 * the brick's ride and T2, and "Run again" after an early end starts a new run
 * on the same workout.
 */
import { db } from "@/db";
import { athleteThresholds, rides, users, workoutSessions, workoutSets } from "@/db/schema";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { rideAfterView } from "@/lib/bike-exercise-view";
import { runAfterView } from "@/lib/run-exercise-view";
import { runPlanHistory } from "@/lib/run-history";
import { appSessionLoads } from "@/lib/training-load";
import { rideTimeline } from "@/lib/utils/ride-timeline";
import { beltResults } from "@/lib/utils/run-screen";
import { runPaceLoad } from "@/lib/utils/training-load";
import { workoutToRows } from "@/lib/utils/program-steps";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";
import { registerAthleteProfileTools } from "@/lib/mcp/tools/athlete-profile";

const T0 = new Date("2026-11-20T17:00:00Z");
const MIN = 60_000;
let me: string;
let run: number;
let bike: number;
let ids = 0;
const cid = () => `r${++ids}`;
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** A steady 12 min in heart rate zone 2, with no belt written: its belt comes from the zone, or from history. */
const steady = { v: 2, sport: "run", name: "Steady", steps: [{ type: "work", end: { type: "time", seconds: 720 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] };
/** 2 km in zone 2: outdoors it ends on the time the runner's easy pace gives. */
const easyKm = { v: 2, sport: "run", name: "Easy 2 km", steps: [{ type: "work", end: { type: "distance", meters: 2000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] };
/** 10 min at 8 km/h and 3%, then 10 min at 10 km/h (the incline carries over, 4.2). */
const twoSteps = {
  v: 2,
  sport: "run",
  name: "Two steps",
  steps: [
    { type: "work", end: { type: "time", seconds: 600 }, belt: 8, incline: 3 },
    { type: "work", end: { type: "time", seconds: 600 }, belt: 10 },
  ],
};

async function setup(workout: unknown, exercise = run) {
  const { program, slots } = await createStepProgram(me, exercise, workout);
  const session = await createSession(me, program.id);
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}

/** Run a whole run on its timeline and save each step as run mode does, then finish its workout. */
async function runThrough(s: Awaited<ReturnType<typeof setup>>, mode: "indoor" | "outdoor", seconds: number, extra: (i: number) => Record<string, unknown> = () => ({})) {
  const view = ok(await startRide({ ...s, mode, clientId: cid() }));
  vi.setSystemTime(new Date(Date.now() + seconds * 1000 + 1000));
  const t = rideTimeline(view.plan, view.events, Date.now());
  for (const [i, r] of t.steps.entries()) {
    const b = mode === "indoor" ? beltResults(r) : {};
    ok(
      await logWorkoutSet({
        sessionId: s.sessionId,
        exerciseId: run,
        setNumber: i + 1,
        programSetId: r.programSetId,
        actualReps: 0,
        weightKg: 0,
        durationSeconds: r.activeSeconds,
        restTimeSeconds: 0,
        isCompleted: true,
        stepStatus: r.status,
        targetOffsetW: 0,
        extendedSeconds: 0,
        ...b,
        sources: { durationSeconds: "clock", ...(b.distanceMeters !== undefined && { distanceMeters: "belt", avgSpeed: "belt" }) },
        ...extra(i),
      }),
    );
  }
  ok(await completeWorkoutSession({ sessionId: s.sessionId, endTime: new Date().toISOString() }));
  return view.ride;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true })).id;
  await db.update(users).set({ timeZone: "Europe/Oslo" }).where(eq(users.id, me));
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
  ]);
  asUser(me);
});

afterEach(() => vi.useRealTimers());

describe("the runner's own runs reach the next plan (4.2, 4.3)", () => {
  it("a heart rate step's belt is the median belt of 2 done treadmill steps in its zone; an outdoor distance step runs on the easy pace", async () => {
    // With no history: the slow end of the zone 2 pace (8.2 km/h), and the zone 2 pace outdoors.
    const first = await setup(steady);
    const before = ok(await startRide({ ...first, mode: "indoor", clientId: cid() }));
    expect(before.plan.steps[0].run).toMatchObject({ belt: 82, beltFrom: "zone" });
    ok(await sendRideEvent({ rideId: before.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));

    // Two treadmill runs at 8.6 and 9.0 km/h with Garmin's heart rate in zone 2 (155 of 180).
    for (const kmh of [8.6, 9]) {
      const s = await setup(steady);
      const r = await runThrough(s, "indoor", 720);
      await db.update(workoutSets).set({ avgSpeed: kmh / 3.6, avgHr: 155, sources: { durationSeconds: "clock", avgSpeed: "belt", distanceMeters: "belt", avgHr: "garmin" } }).where(eq(workoutSets.sessionId, s.sessionId));
      expect(r.sport).toBe("run");
      later(30 * MIN * (kmh === 9 ? 2 : 1));
    }
    // Two easy outdoor runs: 2.5 and 2.7 m/s at heart rate 150, distance from Garmin.
    for (const speed of [2.5, 2.7]) {
      const s = await setup(steady);
      await runThrough(s, "outdoor", 720, () => ({ avgHr: 150, sources: { durationSeconds: "clock", avgHr: "typed" } }));
      await db.update(workoutSets).set({ distanceMeters: Math.round(speed * 720), sources: { durationSeconds: "clock", distanceMeters: "garmin", avgHr: "typed" } }).where(eq(workoutSets.sessionId, s.sessionId));
      later(30 * MIN * (speed === 2.5 ? 3 : 4));
    }
    const history = await runPlanHistory(me, 180);
    expect(history.history.map((h) => Math.round(h.beltKmh * 10) / 10).sort()).toEqual([8.6, 9]);
    expect(history.easySpeed).toBeCloseTo(2.6, 3);
    // The coach reads the same belts with their heart rate (docs/plans/strict-targets.md, decision 7).
    const profile = await mcpTools((s, u) => registerAthleteProfileTools(s, u, undefined, { endurance: true }), me)("get_athlete_profile");
    expect(profile.data.treadmillBelts).toEqual({
      days: 42,
      belts: [expect.objectContaining({ beltKmh: 8.6, avgHr: 155, minutes: 12 }), expect.objectContaining({ beltKmh: 9, avgHr: 155, minutes: 12 })],
    });

    const next = await setup(steady);
    const v = ok(await startRide({ ...next, mode: "indoor", clientId: cid() }));
    expect(v.plan.steps[0].run).toMatchObject({ belt: 88, beltFrom: "history" });
    ok(await sendRideEvent({ rideId: v.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));

    const out = await setup(easyKm);
    const o = ok(await startRide({ ...out, mode: "outdoor", clientId: cid() }));
    expect(o.plan.steps[0]).toMatchObject({ seconds: Math.round(2000 / 2.6), run: { rule: "estimate" } });
  });

  it("leaves out another user's steps, typed heart rates on a treadmill and steps on Trail or snow", async () => {
    const s = await setup(steady);
    await runThrough(s, "indoor", 720, () => ({ avgHr: 155, sources: { durationSeconds: "clock", avgSpeed: "belt", distanceMeters: "belt", avgHr: "typed" } }));
    later(30 * MIN);
    const t = await setup(steady);
    const view = ok(await startRide({ ...t, mode: "outdoor", surface: "trail", clientId: cid() }));
    later(30 * MIN + 721_000);
    ok(await logWorkoutSet({ sessionId: t.sessionId, exerciseId: run, setNumber: 1, programSetId: t.setIds[0], actualReps: 0, weightKg: 0, durationSeconds: 720, restTimeSeconds: 0, isCompleted: true, stepStatus: "done", targetOffsetW: 0, extendedSeconds: 0, distanceMeters: 1800, avgHr: 150, sources: { durationSeconds: "clock" } }));
    expect(view.ride.surface).toBe("trail");
    const other = (await createUser({ enduranceEnabled: true })).id;
    expect(await runPlanHistory(other, 180)).toEqual({ history: [], easySpeed: null });
    expect(await runPlanHistory(me, 180)).toEqual({ history: [], easySpeed: null });
  });
});

describe("the load of a run (4.9)", () => {
  it("a treadmill run's steps give a pace load per step from GAP, method run_gap; Trail or snow does not", async () => {
    const s = await setup(twoSteps);
    await runThrough(s, "indoor", 1200, () => ({ rpe: 5 }));
    const [row] = await appSessionLoads(me, null, null, { sessionIds: [s.sessionId] });
    const thr = (1000 / 339) * 3.6;
    // 3% counts as 2% on both steps: Minetti's Cr(0.02) / Cr(0) = 4.0082 / 3.6.
    const expected = (600 / 3600) * ((8 * 1.11338) / thr) ** 2 * 100 + (600 / 3600) * ((10 * 1.11338) / thr) ** 2 * 100;
    expect(row).toMatchObject({ sport: "run", method: "run_gap", durationS: 1200 });
    expect(row.load).toBeCloseTo(expected, 0);

    later(60 * MIN);
    const t = await setup(twoSteps);
    await runThrough(t, "outdoor", 1200, () => ({ rpe: 5, distanceMeters: 1500, sources: { durationSeconds: "clock", distanceMeters: "typed" } }));
    const [road] = await appSessionLoads(me, null, null, { sessionIds: [t.sessionId] });
    expect(road.method).toBe("run_gap");
    await db.update(rides).set({ surface: "trail" }).where(eq(rides.sessionId, t.sessionId));
    const [trail] = await appSessionLoads(me, null, null, { sessionIds: [t.sessionId] });
    expect(trail.method).toBe("srpe");
  });
});

describe("the summary of a brick run (section 5)", () => {
  it("reads the linked ride's time and T2", async () => {
    const ride = { v: 2, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", zone: 2 } }] };
    const b = await setup(ride, bike);
    const r = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    later(5 * MIN);
    ok(await sendRideEvent({ rideId: r.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    later(5 * MIN + 72_000);
    const s = await setup(twoSteps);
    const v = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    // The planned brick pair sets the link (step 3); here it is set straight.
    await db.update(rides).set({ brickRideId: r.ride.id }).where(eq(rides.id, v.ride.id));
    later(5 * MIN + 72_000 + 60_000);
    ok(await sendRideEvent({ rideId: v.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect((await runAfterView(me, s.programExerciseId))?.brick).toEqual({ rideSeconds: 300, t2Seconds: 72 });
  });
});

describe("Run again (section 5)", () => {
  it("after an early end starts a new run on the same workout, which opens again", async () => {
    const s = await setup(twoSteps);
    const first = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    later(2 * MIN);
    ok(await sendRideEvent({ rideId: first.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    ok(await completeWorkoutSession({ sessionId: s.sessionId, endTime: new Date().toISOString() }));
    expect((await runAfterView(me, s.programExerciseId))?.status).toBe("ended_early");

    later(3 * MIN);
    const again = ok(await startRide({ ...s, mode: "indoor", countIn: true, again: true, clientId: cid() }));
    expect(again.ride).toMatchObject({ sport: "run", status: "running", programExerciseId: s.programExerciseId, sessionId: s.sessionId });
    const [session] = await db.select().from(workoutSessions).where(and(eq(workoutSessions.id, s.sessionId), eq(workoutSessions.userId, me)));
    expect(session.isCompleted).toBe(false);
  });
});

describe("step 4 review", () => {
  it("(1) a plain treadmill run's incline is time-weighted: one short steep set does not grade-adjust the whole run", async () => {
    const { program } = await createStepProgram(me, run, steady);
    const session = await createSession(me, program.id);
    const set = (setNumber: number, seconds: number, meters: number, inclinePercent: number) => ({
      sessionId: session.id, exerciseId: run, setNumber, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: seconds, distanceMeters: meters, inclinePercent, isCompleted: true, rpe: 5,
    });
    await db.insert(workoutSets).values([set(1, 3420, 9500, 0), set(2, 180, 500, 8)]);
    await db.update(workoutSessions).set({ isCompleted: true, endTime: new Date(T0.getTime() + 3600_000) }).where(eq(workoutSessions.id, session.id));
    const [row] = await appSessionLoads(me, null, null, { sessionIds: [session.id] });
    // 0.4% on average: flat on a treadmill, so the load of 10 km in 60 min at threshold 5:39 /km.
    const flat = runPaceLoad({ seconds: 3600, meters: 10000 }, 1000 / 339)!.load;
    expect(row.method).toBe("run_pace");
    expect(row.load).toBeCloseTo(flat, 1);
  });

  it("(3) distances spread from a typed total are left out of the easy pace", async () => {
    for (const k of [0, 1]) {
      const s = await setup(steady);
      await runThrough(s, "outdoor", 720, () => ({ distanceMeters: 1900, avgHr: 150, sources: { durationSeconds: "clock", distanceMeters: "typed", avgHr: "typed" } }));
      later(30 * MIN * (k + 1));
    }
    expect((await runPlanHistory(me, 180)).easySpeed).toBeNull();
  });

  it("(4) after Run again, the summary lists only the second run's steps", async () => {
    // Three steps: an end on the last step would be a finished run.
    const s = await setup({ ...twoSteps, steps: [...twoSteps.steps, { type: "cooldown", end: { type: "time", seconds: 300 }, belt: 6 }] });
    const first = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    // Run 1 runs the first step and 2 min of the second, then ends.
    later(12 * MIN);
    const t1 = rideTimeline(first.plan, first.events, Date.now());
    ok(await logWorkoutSet({ sessionId: s.sessionId, exerciseId: run, setNumber: 1, programSetId: s.setIds[0], actualReps: 0, weightKg: 0, durationSeconds: 600, restTimeSeconds: 0, isCompleted: true, stepStatus: "done", targetOffsetW: 0, extendedSeconds: 0, sources: { durationSeconds: "clock" } }));
    expect(t1.steps.length).toBe(1);
    ok(await sendRideEvent({ rideId: first.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    ok(await logWorkoutSet({ sessionId: s.sessionId, exerciseId: run, setNumber: 2, programSetId: s.setIds[1], actualReps: 0, weightKg: 0, durationSeconds: 120, restTimeSeconds: 0, isCompleted: true, stepStatus: "partial", targetOffsetW: 0, extendedSeconds: 0, sources: { durationSeconds: "clock" } }));
    ok(await completeWorkoutSession({ sessionId: s.sessionId, endTime: new Date().toISOString() }));
    // Run 2 ends after 1 min of the first step.
    later(15 * MIN);
    const second = ok(await startRide({ ...s, mode: "indoor", again: true, clientId: cid() }));
    later(16 * MIN);
    ok(await sendRideEvent({ rideId: second.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    const after = (await runAfterView(me, s.programExerciseId))!;
    expect(after.rideId).toBe(second.ride.id);
    expect(Object.keys(after.logs).map(Number)).toEqual([s.setIds[0]]);
    expect(after.logs[s.setIds[0]]).toMatchObject({ status: "partial", durationSeconds: 60 });
  });

  it("(4) after Ride again, the ride summary lists only the second ride's steps", async () => {
    const ride = { v: 2, sport: "bike", name: "Ride", steps: [
      { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", zone: 2 } },
      { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", zone: 3 } },
      { type: "cooldown", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
    ] };
    await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
    const s = await setup(ride, bike);
    const first = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    later(12 * MIN);
    for (const [i, sec, status] of [[0, 600, "done"], [1, 120, "partial"]] as const) {
      ok(await logWorkoutSet({ sessionId: s.sessionId, exerciseId: bike, setNumber: i + 1, programSetId: s.setIds[i], actualReps: 0, weightKg: 0, durationSeconds: sec, restTimeSeconds: 0, isCompleted: true, stepStatus: status, targetOffsetW: 0, extendedSeconds: 0, sources: { durationSeconds: "clock" } }));
    }
    ok(await sendRideEvent({ rideId: first.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    ok(await completeWorkoutSession({ sessionId: s.sessionId, endTime: new Date().toISOString() }));
    later(15 * MIN);
    const second = ok(await startRide({ ...s, mode: "indoor", again: true, clientId: cid() }));
    later(16 * MIN);
    ok(await sendRideEvent({ rideId: second.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    const after = (await rideAfterView(me, s.programExerciseId))!;
    expect(after.rideId).toBe(second.ride.id);
    expect(Object.keys(after.logs).map(Number)).toEqual([s.setIds[0]]);
  });
});

describe("final review", () => {
  /** A row of a step, as stored. */
  const rowOf = async (sessionId: number, programSetId: number) =>
    (await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, sessionId), eq(workoutSets.programSetId, programSetId))))[0];

  it("(1) saving the results table with only a heart rate keeps a treadmill step's incline", async () => {
    const s = await setup({ ...twoSteps, steps: [{ type: "work", end: { type: "time", seconds: 600 }, belt: 8, incline: 1.5 }] });
    await runThrough(s, "indoor", 600);
    expect((await rowOf(s.sessionId, s.setIds[0])).inclinePercent).toBe(1.5);
    // The results table sends only what the runner changed (resultPayloads): here one heart rate.
    ok(
      await logWorkoutSet({
        sessionId: s.sessionId, exerciseId: run, setNumber: 1, programSetId: s.setIds[0], actualReps: 0, weightKg: 0, durationSeconds: 600, restTimeSeconds: 0,
        isCompleted: true, stepStatus: "done", targetOffsetW: 0, extendedSeconds: 0, avgHr: 150, sources: { avgHr: "typed" },
      }),
    );
    const row = await rowOf(s.sessionId, s.setIds[0]);
    expect(row.inclinePercent).toBe(1.5);
    expect(row.avgHr).toBe(150);
  });

  it("(2) a finished run does not clear the ended early of a ride on the same workout", async () => {
    const rideTree = { v: 2, sport: "bike", name: "Ride", steps: [
      { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", zone: 2 } },
      { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", zone: 3 } },
    ] };
    await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
    const rows = (tree: unknown) => {
      const p = parseWorkout(tree);
      if (!p.ok) throw new Error("bad tree");
      return workoutToRows(p.workout).map((r) => ({ ...r, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
    };
    const { program, slots } = await createProgram(me, [{ exerciseId: bike, sets: rows(rideTree) }, { exerciseId: run, sets: rows(twoSteps) }]);
    const session = await createSession(me, program.id);
    const r = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    later(5 * MIN);
    expect(ok(await sendRideEvent({ rideId: r.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 })).ride.status).toBe("ended_early");
    const ended = async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id)))[0].endedEarly;
    expect(await ended()).toBe(true);
    later(6 * MIN);
    const v = ok(await startRide({ sessionId: session.id, programExerciseId: slots[1].programExerciseId, mode: "indoor", clientId: cid() }));
    later(6 * MIN + 1201_000);
    expect(ok(await getRide({ rideId: v.ride.id }))!.ride.status).toBe("finished");
    expect(await ended()).toBe(true);
  });

  it("(3) a late belt of a run that auto ended is refused once Run again has started, and leaves the new run's rows", async () => {
    // Step 2 is 1 km by feel: with no belt it waits, so the run can auto end in it.
    const s = await setup({ ...twoSteps, steps: [twoSteps.steps[0], { type: "work", end: { type: "distance", meters: 1000 } }] });
    const first = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    // The phone goes offline; step 1 is saved at its end, then the run auto ends 2 h after its planned end.
    later(601_000);
    const t1 = rideTimeline(first.plan, first.events, Date.now());
    ok(await logWorkoutSet({ sessionId: s.sessionId, exerciseId: run, setNumber: 1, programSetId: s.setIds[0], actualReps: 0, weightKg: 0, durationSeconds: 600, restTimeSeconds: 0, isCompleted: true, stepStatus: "done", targetOffsetW: 0, extendedSeconds: 0, ...beltResults(t1.steps[0]), sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" } }));
    later(1200_000 + 125 * MIN);
    const ended = ok(await getRide({ rideId: first.ride.id }))!;
    expect(ended.ride.status).toBe("ended_early");
    // Run again on the same workout: its step 1 at 8 km/h.
    const second = ok(await startRide({ ...s, mode: "indoor", again: true, clientId: cid() }));
    later(1200_000 + 125 * MIN + 601_000);
    const t2 = rideTimeline(second.plan, second.events, Date.now());
    ok(await logWorkoutSet({ sessionId: s.sessionId, exerciseId: run, setNumber: 1, programSetId: s.setIds[0], actualReps: 0, weightKg: 0, durationSeconds: 600, restTimeSeconds: 0, isCompleted: true, stepStatus: "done", targetOffsetW: 0, extendedSeconds: 0, ...beltResults(t2.steps[0]), sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" } }));
    const before = await rowOf(s.sessionId, s.setIds[0]);
    expect(before.distanceMeters).toBe(1333);
    // The first run's belt of 12 km/h tapped at 5 min reaches the server now.
    const res = await sendRideEvent({ rideId: first.ride.id, clientId: cid(), kind: "belt", value: 120, stepKey: first.plan.steps[0].key, clientAt: T0.getTime() + 300_000, expectedSeq: ended.ride.seq });
    expect(res).toEqual({ success: false, error: "The ride has ended" });
    expect((await rowOf(s.sessionId, s.setIds[0])).distanceMeters).toBe(1333);
  });
});
