/**
 * Run mode on the server (docs/plans/run-logger.md, step 3): the treadmill's
 * 5 s count, the brick link from the planned pair, each step's belt numbers
 * with their source (a typed value stays), a late belt that moves them, the
 * end reason, and the done run that takes Start run's place.
 */
import { db } from "@/db";
import { athleteThresholds, plannedSessions, rides, trainingCycles, users, workoutSessions, workoutSets } from "@/db/schema";
import { getRide, sendRideEvent, setRideEndReason, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { brickRideOf, brickRideView, brickRunOf } from "@/lib/run-brick";
import { runAfterView } from "@/lib/run-exercise-view";
import { getStepResults } from "@/lib/step-results";
import { rideTimeline, type RideStepResult } from "@/lib/utils/ride-timeline";
import { beltResults } from "@/lib/utils/run-screen";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const T0 = new Date("2026-11-20T17:00:00Z");
const MIN = 60_000;
let me: string;
let bike: number;
let run: number;
let ids = 0;
const cid = () => `m${++ids}`;
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** A treadmill run: 1 min at 8 km/h, then 1 min at 10 km/h. */
const twoSteps = {
  v: 2,
  sport: "run",
  name: "Two steps",
  steps: [
    { type: "work", end: { type: "time", seconds: 60 }, belt: 8, incline: 1 },
    { type: "work", end: { type: "time", seconds: 60 }, belt: 10 },
  ],
};
const ride = { v: 2, sport: "bike", name: "Brick ride", steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "power", anchor: "ftp", zone: 2 } }] };

async function runSetup(userId = me) {
  const { program, slots } = await createStepProgram(userId, run, twoSteps);
  const session = await createSession(userId, program.id);
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}
async function rideSetup(userId = me) {
  const { program, slots } = await createStepProgram(userId, bike, ride);
  const session = await createSession(userId, program.id);
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}

/** Today's brick: the ride program, then the run program linked to it. */
async function plannedBrick(rideProgramId: number, runProgramId: number) {
  const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Brick block", durationWeeks: 4, status: "active", startDate: "2026-11-16", sessionsGeneratedAt: new Date() }).returning();
  const [p] = await db.insert(plannedSessions).values({ userId: me, cycleId: cycle.id, date: "2026-11-20", programId: rideProgramId, position: 1 }).returning();
  await db.insert(plannedSessions).values({ userId: me, cycleId: cycle.id, date: "2026-11-20", programId: runProgramId, position: 2, brickParentId: p.id });
}

/** What run mode saves when a treadmill step ends (RunMode's saveStep). */
function stepSave(s: { sessionId: number; setIds: number[] }, index: number, r: Pick<RideStepResult, "activeSeconds" | "distanceM" | "inclinePct" | "avgSpeed">) {
  const b = beltResults(r);
  return {
    sessionId: s.sessionId,
    exerciseId: run,
    setNumber: index + 1,
    programSetId: s.setIds[index],
    actualReps: 0,
    weightKg: 0,
    durationSeconds: r.activeSeconds,
    restTimeSeconds: 0,
    isCompleted: true,
    stepStatus: "done" as const,
    targetOffsetW: 0,
    extendedSeconds: 0,
    ...b,
    sources: { durationSeconds: "clock" as const, distanceMeters: "belt" as const, avgSpeed: "belt" as const },
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true })).id;
  await db.update(users).set({ timeZone: "Europe/Oslo" }).where(eq(users.id, me));
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" },
  ]);
  asUser(me);
});

afterEach(() => vi.useRealTimers());

describe("the treadmill count (4.3)", () => {
  it("a treadmill run with the count starts its clock 5 s after the tap; outdoors there is no count", async () => {
    const s = await runSetup();
    const view = ok(await startRide({ ...s, mode: "indoor", countIn: true, clientId: cid() }));
    expect(view.ride.startedAt).toBe(T0.getTime() + 5000);
    expect(view.events[0]).toMatchObject({ kind: "start", at: T0.getTime() + 5000 });
    // During the count the first step has run nothing.
    const t = rideTimeline(view.plan, view.events, T0.getTime() + 3000);
    expect(t.current).toMatchObject({ index: 0, activeSeconds: 0, remainingSeconds: 62 });

    const o = await runSetup();
    later(10_000);
    ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    const out = ok(await startRide({ ...o, mode: "outdoor", countIn: true, clientId: cid() }));
    expect(out.ride.startedAt).toBe(T0.getTime() + 10_000);
  });
});

describe("each step saves its belt numbers (4.7)", () => {
  it("a step's meters, speed and incline save with source belt; a typed distance stays when the belt saves again", async () => {
    const s = await runSetup();
    const { ride: r } = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    later(2 * MIN + 1000);
    const view = ok(await getRide({ rideId: r.id }))!;
    const t = rideTimeline(view.plan, view.events, Date.now());
    expect(t.steps.map((x) => [x.distanceM, x.inclinePct])).toEqual([
      [133, 1],
      [167, 1],
    ]);
    ok(await logWorkoutSet(stepSave(s, 0, t.steps[0])));
    const [row] = await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, s.sessionId), eq(workoutSets.programSetId, s.setIds[0])));
    // 8.0 km/h is 2.222 m/s: the belt's speed, not the rounded 133 m over 60 s.
    expect(row).toMatchObject({ distanceMeters: 133, avgSpeed: 2.222, inclinePercent: 1, sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" } });

    // The runner types 150 m; a later save from the belt keeps it.
    await db.update(workoutSets).set({ distanceMeters: 150, sources: { durationSeconds: "clock", distanceMeters: "typed", avgSpeed: "belt" } }).where(eq(workoutSets.id, row.id));
    ok(await logWorkoutSet(stepSave(s, 0, { ...t.steps[0], distanceM: 140, avgSpeed: 140 / 60 })));
    const [after] = await db.select().from(workoutSets).where(eq(workoutSets.id, row.id));
    expect(after).toMatchObject({ distanceMeters: 150, sources: { distanceMeters: "typed", avgSpeed: "belt" } });
    expect(after.avgSpeed).toBeCloseTo(140 / 60, 2);
  });

  it("a late offline belt event moves the meters of a step already saved", async () => {
    const s = await runSetup();
    const { ride: r } = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    // The phone is offline: no heartbeat reaches the server.
    later(61 * 1000);
    const v1 = ok(await getRide({ rideId: r.id }))!;
    const t1 = rideTimeline(v1.plan, v1.events, Date.now());
    ok(await logWorkoutSet(stepSave(s, 0, t1.steps[0])));
    // A belt of 12 km/h tapped at 30 s offline reaches the server now.
    later(70 * 1000);
    ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "belt", value: 120, stepKey: v1.plan.steps[0].key, clientAt: T0.getTime() + 30_000, expectedSeq: 1 }));
    const [row] = await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, s.sessionId), eq(workoutSets.programSetId, s.setIds[0])));
    // 30 s at 8 km/h and 30 s at 12 km/h: 10 km/h.
    expect(row.distanceMeters).toBe(167);
    expect(row.avgSpeed).toBeCloseTo(10 / 3.6, 3);
  });
});

describe("a client's belt source", () => {
  it("is taken only for distance and speed: a heart rate marked belt is refused", async () => {
    const s = await runSetup();
    const { ride: r } = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    later(61_000);
    const v = ok(await getRide({ rideId: r.id }))!;
    const t = rideTimeline(v.plan, v.events, Date.now());
    const res = await logWorkoutSet({ ...stepSave(s, 0, t.steps[0]), avgHr: 140, sources: { durationSeconds: "clock", avgHr: "belt" } });
    expect(res.success).toBe(false);
    expect(await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId))).toEqual([]);
  });

  it("is refused on a bike step", async () => {
    const b = await rideSetup();
    ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    later(61_000);
    const res = await logWorkoutSet({
      sessionId: b.sessionId, exerciseId: bike, setNumber: 1, programSetId: b.setIds[0], actualReps: 0, weightKg: 0, durationSeconds: 60, restTimeSeconds: 0,
      isCompleted: true, stepStatus: "done", distanceMeters: 500, sources: { durationSeconds: "clock", distanceMeters: "belt" },
    });
    expect(res.success).toBe(false);
  });
});

describe("the end reason (R15)", () => {
  it("is set on a run that ended early, and on nothing else", async () => {
    const s = await runSetup();
    const { ride: r } = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    expect(await setRideEndReason({ rideId: r.id, reason: "pain" })).toEqual({ success: false, error: "Not found" });
    later(30 * 1000);
    ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    ok(await setRideEndReason({ rideId: r.id, reason: "pain" }));
    expect((await db.select().from(rides).where(eq(rides.id, r.id)))[0].endReason).toBe("pain");
    ok(await setRideEndReason({ rideId: r.id, reason: null }));
    expect((await db.select().from(rides).where(eq(rides.id, r.id)))[0].endReason).toBeNull();

    asUser((await createUser()).id);
    expect(await setRideEndReason({ rideId: r.id, reason: "time" })).toEqual({ success: false, error: "Not found" });
  });
});

describe("a run that has ended", () => {
  it("shows its summary, not Start run: runAfterView gives it once the run ended, and null while it runs", async () => {
    const s = await runSetup();
    const { ride: r } = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    later(30 * 1000);
    expect(await runAfterView(me, s.programExerciseId)).toBeNull();
    ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect(await runAfterView(me, s.programExerciseId)).toMatchObject({
      rideId: r.id,
      status: "ended_early",
      doneLine: "Ended early 18:00 · Treadmill",
      kept: "Step 1 is saved",
      endReason: null,
      // The step the app has not saved yet shows its belt numbers from the timeline.
      logs: { [s.setIds[0]]: { status: "partial", durationSeconds: 30, distanceMeters: 67, inclinePercent: 1, sources: { distanceMeters: "belt", avgSpeed: "belt" } } },
      beltEvents: false,
      brick: null,
    });
  });
});

describe("the brick (4.7)", () => {
  it("links the run to the ride of the planned pair, hands the ride over to the run, and gives T2", async () => {
    const b = await rideSetup();
    // Another ride today that is not the brick's.
    const other = await rideSetup();
    const r = await runSetup();
    await plannedBrick(b.programId, r.programId);
    expect(await brickRideView(me, r.programId)).toBeNull();

    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    expect(await brickRideView(me, r.programId)).toEqual({ rideId: br.id, live: true, t2From: null });
    expect(await brickRunOf(me, br.id)).toEqual({ href: `/programs/${r.programId}/workout/exercises/${r.programExerciseId}`, started: false });

    later(10 * MIN);
    ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    // The other ride starts and ends after the brick's ride: the brick still reads its own.
    const { ride: or } = ok(await startRide({ ...other, mode: "indoor", clientId: cid() }));
    later(11 * MIN);
    ok(await sendRideEvent({ rideId: or.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect(await brickRideView(me, r.programId)).toEqual({ rideId: br.id, live: false, t2From: T0.getTime() + 10 * MIN });

    later(12 * MIN);
    const run1 = ok(await startRide({ ...r, mode: "outdoor", clientId: cid() }));
    expect(run1.ride.brickRideId).toBe(br.id);
    expect(await brickRunOf(me, br.id)).toMatchObject({ started: true });

    // Over 60 min after the ride, T2 does not show.
    later(80 * MIN);
    expect((await brickRideView(me, r.programId))?.t2From).toBeNull();
  });

  it("a ride of the brick's program yesterday evening is not today's brick ride", async () => {
    vi.setSystemTime(new Date("2026-11-19T20:00:00Z"));
    const b = await rideSetup();
    const r = await runSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(new Date("2026-11-19T20:10:00Z"));
    ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    // 10 h later it is the next day in Oslo; today's ride has not started.
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
    await plannedBrick(b.programId, r.programId);
    expect(await brickRideOf(me, r.programId)).toBeNull();
  });

  it("a run in no brick links to no ride", async () => {
    const b = await rideSetup();
    const r = await runSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    later(10 * MIN);
    ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect(ok(await startRide({ ...r, mode: "indoor", clientId: cid() })).ride.brickRideId).toBeNull();
    expect(await brickRunOf(me, br.id)).toBeNull();
  });
});

describe("the run links today's planned session (bike 4.5, R16)", () => {
  it("a run started on a workout the screen opened without the planned session links it, so its step results show on the session page", async () => {
    const s = await runSetup();
    const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Run block", durationWeeks: 4, status: "active", startDate: "2026-11-16", sessionsGeneratedAt: new Date() }).returning();
    const [p] = await db.insert(plannedSessions).values({ userId: me, cycleId: cycle.id, date: "2026-11-20", programId: s.programId, position: 1 }).returning();
    const v = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    const [session] = await db.select({ plannedSessionId: workoutSessions.plannedSessionId }).from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(session.plannedSessionId).toBe(p.id);
    later(61 * MIN / 60);
    ok(await logWorkoutSet(stepSave(s, 0, rideTimeline(v.plan, v.events, Date.now()).steps[0])));
    expect((await getStepResults(me, { plannedSessionId: p.id }))?.rows.length).toBeGreaterThan(0);
  });

  it("a run whose program has two planned sessions today links neither", async () => {
    const s = await runSetup();
    const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Run block", durationWeeks: 4, status: "active", startDate: "2026-11-16", sessionsGeneratedAt: new Date() }).returning();
    await db.insert(plannedSessions).values([1, 2].map((position) => ({ userId: me, cycleId: cycle.id, date: "2026-11-20", programId: s.programId, position })));
    ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    const [session] = await db.select({ plannedSessionId: workoutSessions.plannedSessionId }).from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(session.plannedSessionId).toBeNull();
  });
});

describe("the ride links today's planned session (bike 4.5)", () => {
  it("a ride started on a workout the screen opened without the planned session links it", async () => {
    const s = await rideSetup();
    const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Bike block", durationWeeks: 4, status: "active", startDate: "2026-11-16", sessionsGeneratedAt: new Date() }).returning();
    const [p] = await db.insert(plannedSessions).values({ userId: me, cycleId: cycle.id, date: "2026-11-20", programId: s.programId, position: 1 }).returning();
    ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    const [session] = await db.select({ plannedSessionId: workoutSessions.plannedSessionId, rideMode: workoutSessions.rideMode }).from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(session).toEqual({ plannedSessionId: p.id, rideMode: "indoor" });
  });

  it("a ride whose program has two planned sessions today links neither", async () => {
    const s = await rideSetup();
    const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Bike block", durationWeeks: 4, status: "active", startDate: "2026-11-16", sessionsGeneratedAt: new Date() }).returning();
    await db.insert(plannedSessions).values([1, 2].map((position) => ({ userId: me, cycleId: cycle.id, date: "2026-11-20", programId: s.programId, position })));
    ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    const [session] = await db.select({ plannedSessionId: workoutSessions.plannedSessionId }).from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(session.plannedSessionId).toBeNull();
  });
});
