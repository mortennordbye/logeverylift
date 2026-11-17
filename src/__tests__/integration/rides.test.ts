/**
 * Ride mode on the server (docs/plans/bike-ride-logger.md, 4.3): starting a
 * ride freezes its plan, events are owned, ordered and replay-safe, and a user
 * has one active ride.
 */
import { db } from "@/db";
import { athleteThresholds, programSets, rideEvents, rides, workoutSessions } from "@/db/schema";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { AUTO_END_AFTER_MS, RIDE_CONFLICT } from "@/lib/utils/ride-timeline";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const T0 = new Date("2026-11-17T17:00:00Z");
let me: string;
let bike: number;
let ids = 0;
const cid = () => `c${++ids}`;

const tempo = {
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 76, high: 85 } },
        { type: "recovery", end: { type: "time", seconds: 300 }, free: true },
      ],
    },
    { type: "cooldown", end: { type: "lap" } },
  ],
};

async function setFtp(userId: string, value: number) {
  await db.insert(athleteThresholds).values({ userId, kind: "ftp", value, measuredOn: "2026-11-01", source: "manual" });
}

/** A bike program with the tempo steps and an open session of it. */
async function rideSetup(userId = me) {
  const { program, slots } = await createStepProgram(userId, bike, tempo);
  const session = await createSession(userId, program.id);
  return { programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}

const start = async (s: { sessionId: number; programExerciseId: number }, clientId = cid()) => startRide({ ...s, mode: "indoor", clientId });

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  asUser(me);
});

afterEach(() => vi.useRealTimers());

describe("startRide", () => {
  it("freezes the plan with watts from the FTP now, drops the last recovery, and links each step to its set", async () => {
    await setFtp(me, 200);
    const s = await rideSetup();
    const view = ok(await start(s));
    expect(view.ride).toMatchObject({ status: "running", seq: 1, mode: "indoor", sessionId: s.sessionId, startedAt: T0.getTime() });
    expect(view.plan.steps.map((p) => p.programSetId)).toEqual([s.setIds[0], s.setIds[1], s.setIds[2], s.setIds[3], s.setIds[5]]);
    expect(view.plan.steps[0].power).toEqual({ from: 100, to: 140 });
    expect(view.plan.steps[1].power).toEqual({ from: 152, to: 170 });
    expect(view.events).toEqual([{ seq: 1, kind: "start", value: null, at: T0.getTime(), clientId: expect.any(String) }]);
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(session.rideMode).toBe("indoor");

    // A later FTP or program change does not touch the running ride (D9).
    await setFtp(me, 250);
    await db.update(programSets).set({ durationSeconds: 1200 }).where(eq(programSets.id, s.setIds[1]));
    const again = ok(await getRide({ rideId: view.ride.id }))!;
    expect(again.plan.steps[1]).toMatchObject({ seconds: 900, power: { from: 152, to: 170 } });
  });

  it("a retried start with the same client id returns the same ride", async () => {
    const s = await rideSetup();
    const first = ok(await start(s, "start-1"));
    const second = ok(await start(s, "start-1"));
    expect(second.ride.id).toBe(first.ride.id);
    expect(await db.select().from(rides).where(eq(rides.userId, me))).toHaveLength(1);
  });

  it("allows one active ride per user, and starts a new one once the old one has ended", async () => {
    const s = await rideSetup();
    const first = ok(await start(s));
    expect(await start(s)).toEqual({ success: false, error: "A ride is already running" });

    // Two hours after its planned end (and the lap step that never got its tap), it ends on its own.
    vi.setSystemTime(new Date(T0.getTime() + 45 * 60_000 + AUTO_END_AFTER_MS));
    const second = ok(await start(s));
    expect(second.ride.id).not.toBe(first.ride.id);
    const [old] = await db.select().from(rides).where(eq(rides.id, first.ride.id));
    expect(old).toMatchObject({ status: "ended_early", endedAt: new Date(T0.getTime() + 45 * 60_000) });
  });

  it("refuses another user's session or exercise, a strength exercise and a finished workout", async () => {
    const s = await rideSetup();
    const other = (await createUser({ enduranceEnabled: true })).id;
    asUser(other);
    expect(await start(s)).toEqual({ success: false, error: "Not found" });
    const theirs = await rideSetup(other);
    expect(await start({ sessionId: theirs.sessionId, programExerciseId: s.programExerciseId })).toEqual({ success: false, error: "Not found" });

    asUser(me);
    const run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
    const { program, slots } = await createStepProgram(me, run, { v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "lap" } }] });
    const runSession = await createSession(me, program.id);
    expect(await start({ sessionId: runSession.id, programExerciseId: slots[0].programExerciseId })).toEqual({ success: false, error: "Only a bike exercise has ride mode" });

    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, s.sessionId));
    expect(await start(s)).toEqual({ success: false, error: "This workout is finished" });
    expect(await db.select().from(rides).where(eq(rides.userId, me))).toHaveLength(0);
  });

  it("is only for users with endurance features on", async () => {
    const s = await rideSetup();
    const lifter = (await createUser()).id;
    asUser(lifter);
    expect(await start(s)).toEqual({ success: false, error: "Endurance features are not on for this account" });
  });
});

describe("sendRideEvent", () => {
  it("stores events in order with the server's time and the next seq", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    vi.setSystemTime(new Date(T0.getTime() + 120_000));
    const paused = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "pause", expectedSeq: 1 }));
    expect(paused.ride).toMatchObject({ status: "paused", seq: 2 });
    vi.setSystemTime(new Date(T0.getTime() + 180_000));
    const nudged = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "nudge", value: 5, expectedSeq: 2 }));
    expect(nudged.events.map((e) => [e.seq, e.kind, e.value, e.at - T0.getTime()])).toEqual([
      [1, "start", null, 0],
      [2, "pause", null, 120_000],
      [3, "nudge", 5, 180_000],
    ]);
    expect(nudged.serverNow).toBe(T0.getTime() + 180_000);
  });

  it("a replayed client id is a no-op, even with an old seq", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    const first = ok(await sendRideEvent({ rideId: ride.id, clientId: "skip-1", kind: "skip", expectedSeq: 1 }));
    const replay = ok(await sendRideEvent({ rideId: ride.id, clientId: "skip-1", kind: "skip", expectedSeq: 1 }));
    expect(replay.ride.seq).toBe(2);
    expect(replay.events).toEqual(first.events);
    expect(await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id))).toHaveLength(2);
  });

  it("answers a stale seq with a conflict and stores nothing", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "pause", expectedSeq: 1 }));
    // A second device still at seq 1.
    expect(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "skip", expectedSeq: 1 })).toEqual({ success: false, error: RIDE_CONFLICT });
    const fresh = ok(await getRide({ rideId: ride.id }))!;
    expect(fresh.ride.seq).toBe(2);
    expect(fresh.events.map((e) => e.kind)).toEqual(["start", "pause"]);
  });

  it("an offline event keeps its client time inside the ride, else gets the server's time", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    vi.setSystemTime(new Date(T0.getTime() + 600_000));
    const offline = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "skip", clientAt: T0.getTime() + 60_000, expectedSeq: 1 }));
    expect(offline.events[1].at).toBe(T0.getTime() + 60_000);
    const future = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "pause", clientAt: T0.getTime() + 900_000, expectedSeq: 2 }));
    expect(future.events[2].at).toBe(T0.getTime() + 600_000);
    const early = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "resume", clientAt: T0.getTime() - 1, expectedSeq: 3 }));
    expect(early.events[3].at).toBe(T0.getTime() + 600_000);
  });

  it("end before the last step stores the ride as ended early; then events are refused", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    vi.setSystemTime(new Date(T0.getTime() + 20 * 60_000));
    const ended = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect(ended.ride).toMatchObject({ status: "ended_early", endedAt: T0.getTime() + 20 * 60_000 });
    expect(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "pause", expectedSeq: 2 })).toEqual({ success: false, error: "The ride has ended" });
    expect(ok(await getRide({}))).toBeNull();
  });

  it("a heartbeat marks the ride alive without an event or a seq", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    vi.setSystemTime(new Date(T0.getTime() + 10_000));
    const beat = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "heartbeat", expectedSeq: 0 }));
    expect(beat.ride.seq).toBe(1);
    const [row] = await db.select().from(rides).where(eq(rides.id, ride.id));
    expect(row.heartbeatAt).toEqual(new Date(T0.getTime() + 10_000));
  });

  it("refuses a nudge that is not 5 W and another user's ride", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    expect((await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "nudge", value: 10, expectedSeq: 1 })).success).toBe(false);
    asUser((await createUser({ enduranceEnabled: true })).id);
    expect(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "pause", expectedSeq: 1 })).toEqual({ success: false, error: "Not found" });
    expect(await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq))).toHaveLength(1);
  });
});

describe("getRide", () => {
  it("finds the active ride with no id, and stores a ride whose last step ran out as finished", async () => {
    const plain = { v: 2, sport: "bike", name: "Short", steps: [{ type: "work", end: { type: "time", seconds: 300 } }] };
    const { program, slots } = await createStepProgram(me, bike, plain);
    const session = await createSession(me, program.id);
    const { ride } = ok(await start({ sessionId: session.id, programExerciseId: slots[0].programExerciseId }));
    expect(ok(await getRide({}))?.ride.id).toBe(ride.id);

    vi.setSystemTime(new Date(T0.getTime() + 301_000));
    expect(ok(await getRide({}))).toBeNull();
    const done = ok(await getRide({ rideId: ride.id }))!;
    expect(done.ride).toMatchObject({ status: "finished", endedAt: T0.getTime() + 300_000 });
  });

  it("does not show another user's ride", async () => {
    const s = await rideSetup();
    const { ride } = ok(await start(s));
    asUser((await createUser({ enduranceEnabled: true })).id);
    expect(await getRide({ rideId: ride.id })).toEqual({ success: false, error: "Not found" });
    expect(ok(await getRide({}))).toBeNull();
  });
});
