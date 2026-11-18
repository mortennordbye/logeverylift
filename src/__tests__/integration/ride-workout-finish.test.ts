/**
 * Finishing a workout ends its ride (docs/plans/bike-ride-logger.md, 4.3 and
 * section 9): the ride stores an `end` at the server's time, its done steps
 * stay, the steps not ridden are not done, its alerts go, and a new ride can
 * start. A ride whose workout was finished another way reads as ended too.
 */
import { db } from "@/db";
import { athleteThresholds, pushSubscriptions, ridePushes, rideEvents, rides, workoutSessions, workoutSets } from "@/db/schema";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { env } from "@/lib/env";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { workoutToRows } from "@/lib/utils/program-steps";
import { asc, eq } from "drizzle-orm";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

const T0 = new Date("2026-11-17T17:00:00Z").getTime();
const at = (s: number) => T0 + s * 1000;
const KEYS = webpush.generateVAPIDKeys();
let me: string;
let bike: number;
let squat: number;
let ids = 0;
const cid = () => `f${++ids}`;

const tempo = {
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 76, high: 85 } },
    { type: "cooldown", end: { type: "time", seconds: 300 } },
  ],
};

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** A program with a strength exercise and the tempo ride, and an open session of it. */
async function setup() {
  const parsed = parseWorkout(tempo);
  if (!parsed.ok) throw new Error("tempo");
  const steps = workoutToRows(parsed.workout).map((r) => ({ ...r, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
  const { program, slots } = await createProgram(me, [
    { exerciseId: squat, sets: [{}, {}] },
    { exerciseId: bike, sets: steps },
  ]);
  const session = await createSession(me, program.id);
  return { programId: program.id, programExerciseId: slots[1].programExerciseId, setIds: slots[1].setIds, sessionId: session.id };
}

const stepLog = (s: { sessionId: number; setIds: number[] }, i: number, seconds: number) => ({
  sessionId: s.sessionId,
  exerciseId: bike,
  setNumber: i + 1,
  programSetId: s.setIds[i],
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

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  Object.assign(env, { VAPID_PUBLIC_KEY: KEYS.publicKey, VAPID_PRIVATE_KEY: KEYS.privateKey, VAPID_SUBJECT: "mailto:test@example.com" });
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  squat = (await createExercise({ name: `Squat ${Math.random()}` })).id;
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
  await db.insert(pushSubscriptions).values({ userId: me, endpoint: `https://fcm.googleapis.com/fcm/send/${Math.random()}`, p256dh: "BNcR", auth: "tBHI" });
  asUser(me);
});
afterEach(() => {
  vi.useRealTimers();
  Object.assign(env, { VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined });
});

describe("finishing the workout of a live ride", () => {
  it("a paused ride ends at the server's time; the done step stays, the rest is not done, a new ride can start", async () => {
    const s = await setup();
    const view = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    // The warm-up ends on the clock and saves; the rider pauses in the work step.
    vi.setSystemTime(at(700));
    ok(await logWorkoutSet(stepLog(s, 0, 600)));
    ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "pause", expectedSeq: 1 }));

    vi.setSystemTime(at(1000));
    ok(await completeWorkoutSession({ sessionId: s.sessionId }));

    const [ride] = await db.select().from(rides).where(eq(rides.id, view.ride.id));
    expect(ride.status).toBe("ended_early");
    expect(ride.endedAt?.getTime()).toBe(at(1000));
    const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, view.ride.id)).orderBy(asc(rideEvents.seq));
    expect(events.map((e) => [e.seq, e.kind])).toEqual([
      [1, "start"],
      [2, "pause"],
      [3, "end"],
    ]);
    expect(events[2].at.getTime()).toBe(at(1000));
    expect(ride.seq).toBe(3);

    // The done warm-up stays; the steps never ridden are not marked done.
    const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId));
    const bySet = new Map(sets.map((x) => [x.programSetId, x]));
    expect(bySet.get(s.setIds[0])).toMatchObject({ stepStatus: "done", durationSeconds: 600 });
    for (const id of s.setIds.slice(1)) expect(bySet.get(id)?.stepStatus ?? null).not.toBe("done");
    const [w] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(w.endedEarly).toBe(true);

    // No active ride is left, and a new workout can ride again.
    expect(ok(await getRide({}))).toBeNull();
    const next = await createSession(me, s.programId);
    const again = ok(await startRide({ sessionId: next.id, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    expect(again.ride.status).toBe("running");
  });

  it("a running ride's alerts are removed, and later taps get 'The ride has ended'", async () => {
    const s = await setup();
    const view = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    expect((await db.select().from(ridePushes).where(eq(ridePushes.rideId, view.ride.id))).length).toBeGreaterThan(0);

    vi.setSystemTime(at(300));
    ok(await completeWorkoutSession({ sessionId: s.sessionId }));
    expect(await db.select().from(ridePushes).where(eq(ridePushes.rideId, view.ride.id))).toEqual([]);

    // A phone behind reads the ride again (a conflict), then its tap is refused.
    expect(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "skip", expectedSeq: 1 })).toMatchObject({ success: false });
    const tap = await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "skip", expectedSeq: 2 });
    expect(tap).toEqual({ success: false, error: "The ride has ended" });
    const unskip = await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "unskip", expectedSeq: 2 });
    expect(unskip).toEqual({ success: false, error: "The ride has ended" });
  });

  it("a ride whose workout was closed another way (the stale sweep) reads as ended, and startRide is not blocked", async () => {
    const s = await setup();
    const view = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(at(200));
    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, s.sessionId));

    const read = ok(await getRide({ rideId: view.ride.id }));
    expect(read.ride.status).toBe("ended_early");
    expect(read.events.at(-1)).toMatchObject({ kind: "end", at: at(200) });

    const next = await createSession(me, s.programId);
    vi.setSystemTime(at(250));
    ok(await startRide({ sessionId: next.id, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
  });
});
