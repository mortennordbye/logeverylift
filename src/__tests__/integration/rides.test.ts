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

    // Two hours after its planned end (the lap step that never got its tap counts 10 min), it ends on its own.
    vi.setSystemTime(new Date(T0.getTime() + 55 * 60_000 + AUTO_END_AFTER_MS));
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
    const swim = (await createExercise({ name: `Swim ${Math.random()}`, category: "cardio", discipline: "swim" })).id;
    const { program, slots } = await createStepProgram(me, swim, { v: 2, sport: "swim", name: "Swim", steps: [{ type: "work", end: { type: "lap" } }] });
    const swimSession = await createSession(me, program.id);
    expect(await start({ sessionId: swimSession.id, programExerciseId: slots[0].programExerciseId })).toEqual({ success: false, error: "Only a bike or run exercise has ride mode" });

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

describe("review fixes", () => {
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
  async function program(steps: unknown[]) {
    const { program, slots } = await createStepProgram(me, bike, { v: 2, sport: "bike", name: "Ride", steps });
    const session = await createSession(me, program.id);
    return { sessionId: session.id, programExerciseId: slots[0].programExerciseId };
  }

  it("an outdoor ride of distance steps that runs 3 hours with heartbeats does not end on its own; an abandoned one does", async () => {
    const steps = [
      { type: "work", end: { type: "distance", meters: 10_000 } },
      { type: "work", end: { type: "distance", meters: 10_000 } },
    ];
    const used = await program(steps);
    const { ride } = ok(await startRide({ ...used, mode: "outdoor", clientId: cid() }));
    for (const s of [9000, 10_200]) {
      vi.setSystemTime(at(s));
      ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "heartbeat", expectedSeq: 1 }));
    }
    vi.setSystemTime(at(3 * 3600));
    expect(ok(await getRide({ rideId: ride.id }))!.ride.status).toBe("running");
    ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));

    vi.setSystemTime(T0);
    const left = await program(steps);
    const { ride: abandoned } = ok(await startRide({ ...left, mode: "outdoor", clientId: cid() }));
    // 2 × 10 km at 25 km/h is 48 min; 2 hours after that it ends.
    vi.setSystemTime(at(48 * 60 + 2 * 3600));
    expect(ok(await getRide({ rideId: abandoned.id }))!.ride).toMatchObject({ status: "ended_early", endedAt: T0.getTime() });
  });

  it("an unskip of the last step brings the finished ride back", async () => {
    const s = await program([
      { type: "work", end: { type: "time", seconds: 300 } },
      { type: "work", end: { type: "time", seconds: 300 } },
    ]);
    const { ride } = ok(await start(s));
    vi.setSystemTime(at(310));
    const skipped = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "skip", expectedSeq: 1 }));
    expect(skipped.ride.status).toBe("finished");
    vi.setSystemTime(at(313));
    const back = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "unskip", expectedSeq: 2 }));
    expect(back.ride).toMatchObject({ status: "running", endedAt: null });
  });

  it("an offline extend from inside the ride counts after the planned end", async () => {
    const s = await program([{ type: "work", end: { type: "time", seconds: 300 } }]);
    const { ride } = ok(await start(s));
    vi.setSystemTime(at(310));
    const r = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "extend", value: 60, clientAt: at(290).getTime(), expectedSeq: 1 }));
    expect(r.ride.status).toBe("running");
    expect(r.events[1].at).toBe(at(290).getTime());
  });

  it("a late offline replay does not rewrite what another device already saw", async () => {
    const s = await program([
      { type: "work", end: { type: "time", seconds: 900 } },
      { type: "work", end: { type: "time", seconds: 900 } },
    ]);
    const { ride } = ok(await start(s));
    // Device B is online and sends heartbeats; it saw step 1 end at 900 s.
    vi.setSystemTime(at(1190));
    ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "heartbeat", expectedSeq: 1 }));
    // Device A paused offline at 600 s and replays at 1200 s.
    vi.setSystemTime(at(1200));
    const r = ok(await sendRideEvent({ rideId: ride.id, clientId: cid(), kind: "pause", clientAt: at(600).getTime(), expectedSeq: 1 }));
    expect(r.events[1].at).toBe(at(1190).getTime());
    expect(r.ride.status).toBe("paused");
  });

  it("two starts with the same client id at once return the same ride", async () => {
    const s = await rideSetup();
    const [a, b] = await Promise.all([start(s, "same"), start(s, "same")]);
    expect(ok(a).ride.id).toBe(ok(b).ride.id);
  });
});
