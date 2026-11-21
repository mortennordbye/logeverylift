/**
 * A run on the ride server (docs/plans/run-logger.md, step 0 and 4.3): startRide
 * on a run exercise freezes a run plan, "End ride and start run" ends the
 * active ride and starts the run in one action, and once a later session has
 * started, no event makes an earlier one live again.
 */
import { db } from "@/db";
import { athleteThresholds, rideEvents, rides, workoutSessions } from "@/db/schema";
import { sendRideEvent, startRide } from "@/lib/actions/rides";
import { liveRideOnSession, rideStepSnapshot } from "@/lib/ride-plan-db";
import { saveSessionStepResults } from "@/lib/program-step-results";
import { settle } from "@/lib/ride-settle";
import { rideTimeline } from "@/lib/utils/ride-timeline";
import { workoutSets } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { workoutToRows } from "@/lib/utils/program-steps";

const T0 = new Date("2026-11-20T17:00:00Z");
const MIN = 60_000;
let me: string;
let bike: number;
let run: number;
let ids = 0;
const cid = () => `c${++ids}`;
const later = (ms: number) => vi.setSystemTime(new Date(T0.getTime() + ms));

/** "2 Base · Run": warm-up 10 min Z1, steady 50 min Z2, strides 6 × 30 s with 1:30 easy, cool-down 3 min walk. */
const base = {
  v: 2,
  sport: "run",
  name: "2 Base · Run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
    { type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 }, incline: 1 },
    { type: "repeat", count: 6, steps: [{ type: "work", end: { type: "time", seconds: 30 }, belt: 13 }, { type: "recovery", end: { type: "time", seconds: 90 }, belt: 7 }] },
    { type: "cooldown", end: { type: "distance", meters: 300 }, target: { metric: "rpe", anchor: "absolute", low: 1, high: 2 } },
  ],
};
const ride = {
  v: 2,
  sport: "bike",
  name: "Brick ride",
  steps: [
    { type: "work", end: { type: "time", seconds: 1800 }, target: { metric: "power", anchor: "ftp", zone: 2 } },
    { type: "cooldown", end: { type: "time", seconds: 600 } },
  ],
};

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

async function runSetup(userId = me) {
  const { program, slots } = await createStepProgram(userId, run, base);
  const session = await createSession(userId, program.id);
  return { programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}
async function rideSetup(userId = me) {
  const { program, slots } = await createStepProgram(userId, bike, ride);
  const session = await createSession(userId, program.id);
  return { programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
  ]);
  asUser(me);
});

afterEach(() => vi.useRealTimers());

describe("startRide on a run", () => {
  it("freezes a run plan on the treadmill with belts, inclines and end rules, and keeps the session's ride mode", async () => {
    const s = await runSetup();
    const view = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    expect(view.ride).toMatchObject({ sport: "run", mode: "indoor", surface: null, status: "running" });
    expect(view.plan).toMatchObject({ v: 2, sport: "run", mode: "indoor" });
    // Every step runs, the recovery after the last stride too.
    expect(view.plan.steps.map((p) => p.programSetId)).toEqual(s.setIds);
    expect(view.plan.steps.map((p) => [p.run?.rule, p.run?.belt, p.run?.incline])).toEqual([
      ["time", 76, null],
      ["time", 82, 10],
      ...Array.from({ length: 6 }, () => [["time", 130, null], ["time", 70, null]]).flat(),
      ["belt_distance", 55, null],
    ]);
    expect(view.plan.steps[2].run?.block).not.toBeNull();
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(session.rideMode).toBeNull();
  });

  it("outdoors stores the surface, Road when none is given", async () => {
    const s = await runSetup();
    const view = ok(await startRide({ ...s, mode: "outdoor", surface: "trail", clientId: cid() }));
    expect(view.ride).toMatchObject({ sport: "run", mode: "outdoor", surface: "trail" });
    expect(view.plan.surface).toBe("trail");
    expect(view.plan.steps.at(-1)?.run).toMatchObject({ rule: "estimate", belt: null });
  });

  it("records belt and incline events with their step key, an end with its reason, and refuses the other sport's events", async () => {
    const s = await runSetup();
    const { ride: r } = ok(await startRide({ ...s, mode: "indoor", clientId: cid() }));
    later(MIN);
    const belt = ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "belt", value: 85, stepKey: "s1", expectedSeq: 1 }));
    expect(belt.events.at(-1)).toMatchObject({ kind: "belt", value: 85, stepKey: "s1" });
    expect(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "belt", value: 300, expectedSeq: 2 })).toMatchObject({ success: false, error: "Invalid input" });
    expect(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "nudge", value: 5, expectedSeq: 2 })).toEqual({ success: false, error: "Invalid input" });
    ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "incline", value: -15, expectedSeq: 2 }));
    later(2 * MIN);
    const ended = ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "end", reason: "pain", expectedSeq: 3 }));
    expect(ended.ride).toMatchObject({ status: "ended_early", endReason: "pain" });

    const b = await rideSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    expect(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "belt", value: 80, expectedSeq: 1 })).toEqual({ success: false, error: "Invalid input" });
    expect(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "skip", value: 1, expectedSeq: 1 })).toEqual({ success: false, error: "Invalid input" });
  });

  it("a step of the run saves with a run snapshot, and a bike step of the same session with a bike one", async () => {
    const [b, r] = [parseWorkout(ride), parseWorkout(base)].map((p) => (p.ok ? p.workout : null)) as Workout[];
    const rows = (w: Workout) => workoutToRows(w).map((x) => ({ ...x, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
    const { program, slots } = await createProgram(me, [
      { exerciseId: bike, sets: rows(b) },
      { exerciseId: run, sets: rows(r) },
    ]);
    const session = await createSession(me, program.id);
    ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    later(40 * MIN);
    ok(await startRide({ sessionId: session.id, programExerciseId: slots[1].programExerciseId, mode: "indoor", clientId: cid() }));
    expect(await rideStepSnapshot(db, me, session.id, slots[1].setIds[1])).toMatchObject({ sport: "run", step: { incline: 1 } });
    expect(await rideStepSnapshot(db, me, session.id, slots[0].setIds[0])).toMatchObject({ sport: "bike" });
  });
});

describe("End ride and start run", () => {
  it("without the option a running ride blocks the run; with it the ride ends and the run starts in one action", async () => {
    const b = await rideSetup();
    const r = await runSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    later(10 * MIN);
    expect(await startRide({ ...r, mode: "indoor", clientId: cid() })).toEqual({ success: false, error: "A ride is already running" });

    const view = ok(await startRide({ ...r, mode: "indoor", clientId: "run-1", endActive: true }));
    expect(view.ride).toMatchObject({ sport: "run", status: "running" });
    const [old] = await db.select().from(rides).where(eq(rides.id, br.id));
    expect(old).toMatchObject({ status: "ended_early", endedAt: new Date(T0.getTime() + 10 * MIN) });
    const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, br.id)).orderBy(asc(rideEvents.seq));
    expect(events.map((e) => [e.kind, e.clientId])).toEqual([
      ["start", expect.any(String)],
      ["end", "run-1:end-active"],
    ]);
    // A retry of the same start is the same run, and ends nothing again.
    expect(ok(await startRide({ ...r, mode: "indoor", clientId: "run-1", endActive: true })).ride.id).toBe(view.ride.id);
  });

  it("a ride whose stored status is stale is settled as finished, with no end added", async () => {
    const b = await rideSetup();
    const r = await runSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    // The ride's 40 min ran out; its row still says running.
    later(45 * MIN);
    expect((await db.select().from(rides).where(eq(rides.id, br.id)))[0].status).toBe("running");
    ok(await startRide({ ...r, mode: "indoor", clientId: cid(), endActive: true }));
    const [old] = await db.select().from(rides).where(eq(rides.id, br.id));
    expect(old).toMatchObject({ status: "finished", endedAt: new Date(T0.getTime() + 40 * MIN) });
    expect(await db.select().from(rideEvents).where(and(eq(rideEvents.rideId, br.id), eq(rideEvents.kind, "end")))).toHaveLength(0);
  });
});

describe("an earlier session after a later one started", () => {
  it("refuses an event that would make the ride live again, while the run runs and after it ended", async () => {
    const b = await rideSetup();
    const r = await runSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    // The rider skips the cool-down: the ride is finished.
    later(30 * MIN + 5000);
    ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "skip", expectedSeq: 1 }));
    later(31 * MIN);
    const { ride: rr } = ok(await startRide({ ...r, mode: "indoor", clientId: cid() }));
    // A queued unskip from the bike screen arrives now.
    expect(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "unskip", expectedSeq: 2 })).toEqual({ success: false, error: "The ride has ended" });
    later(32 * MIN);
    ok(await sendRideEvent({ rideId: rr.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "unskip", expectedSeq: 2 })).toEqual({ success: false, error: "The ride has ended" });
    expect((await db.select().from(rides).where(eq(rides.id, br.id)))[0].status).toBe("finished");
  });

  it("with no later session the same unskip still opens the ride again, as before", async () => {
    const b = await rideSetup();
    const { ride: br } = ok(await startRide({ ...b, mode: "indoor", clientId: cid() }));
    later(30 * MIN + 5000);
    ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "skip", expectedSeq: 1 }));
    later(31 * MIN);
    const back = ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "unskip", expectedSeq: 2 }));
    expect(back.ride.status).toBe("running");
  });
});

/** A treadmill run of 1 min at 8 km/h, then 200 m at 8 km/h (90 s). */
const short = {
  v: 2,
  sport: "run",
  name: "Short",
  steps: [
    { type: "work", end: { type: "time", seconds: 60 }, belt: 8 },
    { type: "work", end: { type: "distance", meters: 200 }, belt: 8 },
  ],
};

describe("step 0 review", () => {
  it("takes a late offline belt event after the run ended on server time, and the step's meters count it", async () => {
    const { program, slots } = await createStepProgram(me, run, short);
    const session = await createSession(me, program.id);
    const { ride: r } = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    // Offline from the start; the run ended on its own at 150 s.
    later(10 * MIN);
    const res = await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "belt", value: 100, stepKey: "s2", clientAt: T0.getTime() + 90_000, expectedSeq: 1 });
    expect(res).toMatchObject({ success: true });
    const [stored] = await db.select().from(rideEvents).where(and(eq(rideEvents.rideId, r.id), eq(rideEvents.kind, "belt")));
    expect(stored).toMatchObject({ value: 100, stepKey: "s2", at: new Date(T0.getTime() + 90_000) });
    const [row] = await db.select().from(rides).where(eq(rides.id, r.id));
    const view = await settle(db, row, Date.now());
    const t = rideTimeline(view.plan, view.events, view.serverNow);
    // 30 s at 8 km/h is 67 m; the last 133 m at 10 km/h take 48 s.
    expect(view.ride.status).toBe("finished");
    expect(t.steps[1]).toMatchObject({ distanceM: 200, endedAt: T0.getTime() + 138_000 });
  });

  it("reads a run as live by the same timeline as settle, step keys included", async () => {
    const { program, slots } = await createStepProgram(me, run, short);
    const session = await createSession(me, program.id);
    const { ride: r } = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    // A belt 0 meant for step 1, replayed while step 2 runs: it is ignored, so step 2 still ends at 150 s.
    later(100_000);
    ok(await sendRideEvent({ rideId: r.id, clientId: cid(), kind: "belt", value: 0, stepKey: "s1", clientAt: T0.getTime() + 70_000, expectedSeq: 1 }));
    later(200_000);
    const [row] = await db.select().from(rides).where(eq(rides.id, r.id));
    expect(row.status).toBe("running");
    expect(await liveRideOnSession(db, me, session.id)).toBeNull();
    expect((await settle(db, row, Date.now())).ride.status).toBe("finished");
  });

  it("log_step_results on a session with a ride then a run writes the ride's keys to the ride", async () => {
    const [b, r] = [parseWorkout(ride), parseWorkout(base)].map((p) => (p.ok ? p.workout : null)) as Workout[];
    const rows = (w: Workout) => workoutToRows(w).map((x) => ({ ...x, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
    const { program, slots } = await createProgram(me, [
      { exerciseId: bike, sets: rows(b) },
      { exerciseId: run, sets: rows(r) },
    ]);
    const session = await createSession(me, program.id);
    const { ride: br } = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    later(MIN);
    ok(await sendRideEvent({ rideId: br.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    later(2 * MIN);
    const { ride: rr } = ok(await startRide({ sessionId: session.id, programExerciseId: slots[1].programExerciseId, mode: "indoor", clientId: cid() }));
    later(3 * MIN);
    ok(await sendRideEvent({ rideId: rr.id, clientId: cid(), kind: "end", expectedSeq: 1 }));

    // Both plans have an s1: a key without its exercise's place is refused, with the way to name it.
    await expect(saveSessionStepResults(me, session.id, { steps: [{ key: "s1", status: "done", avgPower: 150 }] })).rejects.toThrow(/e1:s1/);
    await saveSessionStepResults(me, session.id, { steps: [{ key: "e1:s1", status: "done", activeSeconds: 60, avgPower: 150 }] });
    const [set] = await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, session.id), eq(workoutSets.programSetId, slots[0].setIds[0])));
    expect(set).toMatchObject({ avgPower: 150, plannedStep: expect.objectContaining({ sport: "bike" }) });
    expect(await db.select().from(workoutSets).where(and(eq(workoutSets.sessionId, session.id), eq(workoutSets.programSetId, slots[1].setIds[0])))).toHaveLength(0);
  });
});
