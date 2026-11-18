/**
 * Ride mode's saves on the server (docs/plans/bike-ride-logger.md, 4.3 and
 * 4.5): each step saves once per session and program set, with its status,
 * offset, extension and sources; a ride ended early marks its workout, and an
 * ended-early key session does not count as done.
 */
import { db } from "@/db";
import { plannedSessions, trainingCycles, workoutSessions, workoutSets } from "@/db/schema";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { sessionCompliance } from "@/lib/session-compliance";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const TODAY = "2026-11-17";
const T0 = new Date(`${TODAY}T12:00:00Z`);
let me: string;
let bike: number;
let ids = 0;
const cid = () => `r${++ids}`;

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

async function setup(sessionOverrides: Partial<typeof workoutSessions.$inferInsert> = {}) {
  const { program, slots } = await createStepProgram(me, bike, ride);
  const session = await createSession(me, program.id, { date: TODAY, ...sessionOverrides });
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, setIds: slots[0].setIds, sessionId: session.id };
}

/** What ride mode sends for a step that ended (stepLogPayload in src/lib/utils/ride-screen.ts). */
const stepLog = (s: { sessionId: number; setIds: number[] }, i: number, extra: Record<string, unknown> = {}) => ({
  sessionId: s.sessionId,
  exerciseId: bike,
  setNumber: i + 1,
  programSetId: s.setIds[i],
  actualReps: 0,
  weightKg: 0,
  durationSeconds: 600,
  restTimeSeconds: 0,
  isCompleted: true,
  stepStatus: "done",
  targetOffsetW: 0,
  extendedSeconds: 0,
  sources: { durationSeconds: "clock" },
  ...extra,
});

const at = (seconds: number) => T0.getTime() + seconds * 1000;
const session = async (id: number) => (await db.select().from(workoutSessions).where(eq(workoutSessions.id, id)))[0];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("saving a step", () => {
  it("one row per session and program set: a second save (reload, another phone, a replay) rewrites it", async () => {
    const s = await setup();
    ok(await logWorkoutSet(stepLog(s, 0)));
    ok(await logWorkoutSet(stepLog(s, 0)));
    // The step was skipped on another device after all.
    ok(await logWorkoutSet(stepLog(s, 1, { stepStatus: "skipped", isCompleted: false, durationSeconds: 30 })));
    ok(await logWorkoutSet(stepLog(s, 1, { stepStatus: "partial", durationSeconds: 400, targetOffsetW: -10, extendedSeconds: 60 })));

    const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId)).orderBy(workoutSets.setNumber);
    expect(rows.map((r) => [r.programSetId, r.stepStatus, r.isCompleted, r.durationSeconds, r.targetOffsetW, r.extendedSeconds, r.sources])).toEqual([
      [s.setIds[0], "done", true, 600, 0, 0, { durationSeconds: "clock" }],
      [s.setIds[1], "partial", true, 400, -10, 60, { durationSeconds: "clock" }],
    ]);
    expect(rows.every((r) => r.plannedStep != null)).toBe(true);
  });

  it("a skipped step saves as skipped and not completed", async () => {
    const s = await setup();
    ok(await logWorkoutSet(stepLog(s, 0, { stepStatus: "skipped", isCompleted: false, durationSeconds: 0 })));
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId));
    expect([row.stepStatus, row.isCompleted]).toEqual(["skipped", false]);
  });

  it("a save from the set list keeps the ride's offset, extension and sources", async () => {
    const s = await setup();
    ok(await logWorkoutSet(stepLog(s, 1, { targetOffsetW: 5, extendedSeconds: 120 })));
    const plain: Record<string, unknown> = { ...stepLog(s, 1), durationSeconds: 1000 };
    for (const k of ["stepStatus", "targetOffsetW", "extendedSeconds", "sources"]) delete plain[k];
    ok(await logWorkoutSet(plain));
    const [row] = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId));
    expect([row.stepStatus, row.durationSeconds, row.targetOffsetW, row.extendedSeconds, row.sources]).toEqual(["done", 1000, 5, 120, { durationSeconds: "clock" }]);
  });

  it("refuses an offset past ±50 W and an unknown source", async () => {
    const s = await setup();
    expect((await logWorkoutSet(stepLog(s, 0, { targetOffsetW: 55 }))).success).toBe(false);
    expect((await logWorkoutSet(stepLog(s, 0, { sources: { durationSeconds: "guess" } }))).success).toBe(false);
    // Sources name result fields only.
    expect((await logWorkoutSet(stepLog(s, 0, { sources: { notes: "clock" } }))).success).toBe(false);
    expect((await logWorkoutSet(stepLog(s, 0, { sources: { durationSeconds: "clock", avgPower: "typed" } }))).success).toBe(true);
  });
});

describe("the end of a ride", () => {
  it("ended early: the workout keeps ended_early; finishing it keeps the done steps", async () => {
    const s = await setup();
    const v = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(new Date(at(700)));
    const ended = ok(await sendRideEvent({ rideId: v.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    expect(ended.ride.status).toBe("ended_early");
    expect((await session(s.sessionId)).endedEarly).toBe(true);

    ok(await logWorkoutSet(stepLog(s, 0)));
    ok(await logWorkoutSet(stepLog(s, 1, { stepStatus: "partial", durationSeconds: 100 })));
    ok(await completeWorkoutSession({ sessionId: s.sessionId, endTime: new Date(at(700)).toISOString() }));
    const done = await session(s.sessionId);
    expect([done.isCompleted, done.endedEarly, done.endTime?.getTime()]).toEqual([true, true, at(700)]);
    expect(await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId))).toHaveLength(2);
  });

  it("finished: the last step ran out, so the ride is finished and not ended early", async () => {
    const s = await setup();
    const v = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(new Date(at(1800 + 5)));
    expect(ok(await getRide({ rideId: v.ride.id }))!.ride.status).toBe("finished");
    expect((await session(s.sessionId)).endedEarly).toBe(false);
  });

  it("skipping the last step finishes the ride: not ended early", async () => {
    const s = await setup();
    const v = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(new Date(at(1600)));
    const skipped = ok(await sendRideEvent({ rideId: v.ride.id, clientId: cid(), kind: "skip", expectedSeq: 1 }));
    expect(skipped.ride.status).toBe("finished");
    expect((await session(s.sessionId)).endedEarly).toBe(false);
  });
});

describe("compliance", () => {
  async function plannedToday(programId: number, priority: "key" | "support") {
    const [cycle] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-16", sessionsGeneratedAt: new Date() }).returning();
    const [row] = await db.insert(plannedSessions).values({ userId: me, cycleId: cycle.id, date: TODAY, programId, priority }).returning();
    return row.id;
  }

  async function rideAndEnd(early: boolean, priority: "key" | "support") {
    const s = await setup();
    const plannedId = await plannedToday(s.programId, priority);
    await db.update(workoutSessions).set({ plannedSessionId: plannedId }).where(eq(workoutSessions.id, s.sessionId));
    const v = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: cid() }));
    vi.setSystemTime(new Date(at(early ? 700 : 1805)));
    if (early) ok(await sendRideEvent({ rideId: v.ride.id, clientId: cid(), kind: "end", expectedSeq: 1 }));
    else ok(await getRide({ rideId: v.ride.id }));
    ok(await logWorkoutSet(stepLog(s, 0)));
    ok(await completeWorkoutSession({ sessionId: s.sessionId }));
    const rows = await sessionCompliance(me, TODAY, TODAY);
    return rows.find((r) => r.id === plannedId)!;
  }

  it("a finished ride makes the key session done", async () => {
    expect((await rideAndEnd(false, "key")).state).toBe("done");
  });

  it("a ride ended early does not make a key session done", async () => {
    const row = await rideAndEnd(true, "key");
    expect(row.priority).toBe("key");
    expect([row.state, row.loggedSessionId]).toEqual(["planned", null]);
  });

  it("a ride ended early still counts for a session that is not key", async () => {
    const row = await rideAndEnd(true, "support");
    expect(row.state).toBe("done");
  });
});
