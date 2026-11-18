/**
 * "Ride again" after a ride that ended early (docs/plans/bike-ride-logger.md,
 * section 9): a new ride of the same exercise on the same workout, through
 * startRide with `again`. The earlier ride's saved steps stay. A finished
 * ride, or a ride of another exercise, gives no restart.
 */
import { db } from "@/db";
import { athleteThresholds, rides, workoutSessions, workoutSets } from "@/db/schema";
import { sendRideEvent, startRide } from "@/lib/actions/rides";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const T0 = new Date("2026-11-17T17:00:00Z").getTime();
const at = (s: number) => T0 + s * 1000;
let me: string;
let bike: number;
let ids = 0;
const cid = () => `a${++ids}`;

const ride = {
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

/** A one-exercise ride that ended early in its work step, its warm-up saved and its workout finished, as ride mode leaves it. */
async function endedEarly() {
  const { program, slots } = await createStepProgram(me, bike, ride);
  const session = await createSession(me, program.id);
  const s = { sessionId: session.id, programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, programId: program.id };
  const first = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "outdoor", clientId: cid() }));
  vi.setSystemTime(at(700));
  ok(
    await logWorkoutSet({
      sessionId: s.sessionId,
      exerciseId: bike,
      setNumber: 1,
      programSetId: s.setIds[0],
      actualReps: 0,
      weightKg: 0,
      durationSeconds: 600,
      restTimeSeconds: 0,
      isCompleted: true,
      stepStatus: "done",
      targetOffsetW: 0,
      extendedSeconds: 0,
      sources: { durationSeconds: "clock" },
    }),
  );
  const end = ok(await sendRideEvent({ rideId: first.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
  expect(end.ride.status).toBe("ended_early");
  ok(await completeWorkoutSession({ sessionId: s.sessionId, endTime: new Date(at(700)).toISOString() }));
  return { ...s, firstId: first.ride.id };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("Ride again", () => {
  it("starts a new ride on the same workout, which opens again; the earlier steps stay", async () => {
    const s = await endedEarly();
    vi.setSystemTime(at(900));
    // Without `again` the finished workout takes no ride.
    expect(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "outdoor", clientId: cid() })).toEqual({
      success: false,
      error: "This workout is finished",
    });

    const again = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "outdoor", clientId: cid(), again: true }));
    expect(again.ride).toMatchObject({ sessionId: s.sessionId, status: "running" });
    expect(again.ride.id).not.toBe(s.firstId);
    const [w] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, s.sessionId));
    expect(w).toMatchObject({ isCompleted: false, endTime: null });
    const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId));
    expect(sets.find((x) => x.programSetId === s.setIds[0])).toMatchObject({ stepStatus: "done", durationSeconds: 600 });
    const [old] = await db.select().from(rides).where(eq(rides.id, s.firstId));
    expect(old.status).toBe("ended_early");
  });

  it("a finished ride gives no restart", async () => {
    const { program, slots } = await createStepProgram(me, bike, ride);
    const session = await createSession(me, program.id);
    ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(at(1900));
    ok(await completeWorkoutSession({ sessionId: session.id }));
    expect(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid(), again: true })).toEqual({
      success: false,
      error: "This workout is finished",
    });
  });
});
