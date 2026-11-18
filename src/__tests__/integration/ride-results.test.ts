/**
 * Ride results on the server (docs/plans/bike-ride-logger.md, 4.5 and 4.6,
 * step 4): the results table saves through logWorkoutSet with sources, never
 * loses what another source wrote without the rider typing over it, and the
 * ride's load reaches appSessionLoads once.
 */
import { db } from "@/db";
import { athleteThresholds, workoutSessions, workoutSets } from "@/db/schema";
import { getRide, startRide } from "@/lib/actions/rides";
import { getActiveSessionCompletedProgramSetIds, logWorkoutSet, unlogWorkoutSet } from "@/lib/actions/workout-sets";
import { buildDailyMetrics, type ActivityInput } from "@/lib/garmin/analytics/daily";
import { appSessionLoads } from "@/lib/training-load";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const TODAY = "2026-11-17";
const T0 = new Date(`${TODAY}T12:00:00Z`);
let me: string;
let bike: number;

/** The mockup ride: 5 steps once the last recovery is dropped (6 program sets). */
const mockup = {
  v: 2,
  sport: "bike",
  name: "Upper endurance 2 x 15",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } },
        { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
      ],
    },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
  ],
};

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

async function setup() {
  const { program, slots } = await createStepProgram(me, bike, mockup);
  const session = await createSession(me, program.id, { date: TODAY, startTime: T0 });
  // Program sets of the ridden steps: the 5th set is the dropped recovery.
  const setIds = slots[0].setIds;
  return { programId: program.id, programExerciseId: slots[0].programExerciseId, sessionId: session.id, ridden: [setIds[0], setIds[1], setIds[2], setIds[3], setIds[5]], setIds };
}

const base = (sessionId: number, programSetId: number, setNumber: number, seconds = 900) => ({
  sessionId,
  exerciseId: bike,
  setNumber,
  programSetId,
  actualReps: 0,
  weightKg: 0,
  durationSeconds: seconds,
  restTimeSeconds: 0,
  isCompleted: true,
  stepStatus: "done",
  targetOffsetW: 0,
  extendedSeconds: 0,
});
/** Ride mode's save of a step when it ends (stepLogPayload). */
const clockSave = (sessionId: number, id: number, n: number, seconds = 900) => ({ ...base(sessionId, id, n, seconds), sources: { durationSeconds: "clock" } });
const row = async (sessionId: number, programSetId: number) =>
  (await db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId))).find((r) => r.programSetId === programSetId)!;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 180, measuredOn: TODAY, source: "manual" });
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("saving ride results", () => {
  it("typed numbers and the effort save marked typed; the clock's later save of the step keeps them", async () => {
    const s = await setup();
    const id = s.ridden[1];
    ok(await logWorkoutSet(clockSave(s.sessionId, id, 2)));
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 2), avgPower: 141, avgHr: 150, maxHr: 165, avgCadence: 90, rpe: 6, sources: { avgPower: "typed", avgHr: "typed", maxHr: "typed", avgCadence: "typed" } }));
    // A reload of ride mode, or another phone, saves the step again.
    ok(await logWorkoutSet(clockSave(s.sessionId, id, 2)));
    const r = await row(s.sessionId, id);
    expect([r.avgPower, r.avgHr, r.maxHr, r.avgCadence, r.rpe, r.durationSeconds]).toEqual([141, 150, 165, 90, 6, 900]);
    expect(r.sources).toEqual({ durationSeconds: "clock", avgPower: "typed", avgHr: "typed", maxHr: "typed", avgCadence: "typed" });
    // The effort taken away in the table.
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 2), rpe: null, sources: {} }));
    expect((await row(s.sessionId, id)).rpe).toBeNull();
  });

  it("outdoor fields: distance, speed and climbing; a field sent as null is cleared with its source", async () => {
    const s = await setup();
    const id = s.ridden[0];
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 1), distanceMeters: 7500, avgSpeed: 8.3, climbM: 120, sources: { distanceMeters: "typed", avgSpeed: "typed", climbM: "typed" } }));
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 1), climbM: null, sources: {} }));
    ok(await logWorkoutSet(clockSave(s.sessionId, id, 1)));
    const r = await row(s.sessionId, id);
    expect([r.distanceMeters, r.avgSpeed, r.climbM]).toEqual([7500, 8.3, null]);
    expect(r.sources).toEqual({ durationSeconds: "clock", distanceMeters: "typed", avgSpeed: "typed" });
  });

  it("a Garmin value stays until the rider types over it; then it is typed", async () => {
    const s = await setup();
    const id = s.ridden[1];
    ok(await logWorkoutSet(clockSave(s.sessionId, id, 2)));
    // What step 7's Garmin fill writes.
    await db.update(workoutSets).set({ avgPower: 138, avgHr: 149, sources: { durationSeconds: "clock", avgPower: "garmin", avgHr: "garmin" } }).where(eq(workoutSets.programSetId, id));
    // The table sends only what the rider changed: the effort, then a typed watt value.
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 2), rpe: 7, sources: {} }));
    let r = await row(s.sessionId, id);
    expect([r.avgPower, r.avgHr, r.rpe, r.sources]).toEqual([138, 149, 7, { durationSeconds: "clock", avgPower: "garmin", avgHr: "garmin" }]);
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 2), avgPower: 141, sources: { avgPower: "typed" } }));
    r = await row(s.sessionId, id);
    expect([r.avgPower, r.avgHr, r.rpe]).toEqual([141, 149, 7]);
    expect(r.sources).toEqual({ durationSeconds: "clock", avgPower: "typed", avgHr: "garmin" });
  });

  it("refuses a number out of range", async () => {
    const s = await setup();
    expect((await logWorkoutSet({ ...base(s.sessionId, s.ridden[0], 1), avgHr: 400, sources: {} })).success).toBe(false);
    expect((await logWorkoutSet({ ...base(s.sessionId, s.ridden[0], 1), avgPower: -1, sources: {} })).success).toBe(false);
  });
});

describe("the ride's load in appSessionLoads", () => {
  const WATTS = [124, 141, 92, 131, 118];
  const SECONDS = [900, 900, 300, 900, 900];

  async function finishedRide(power: boolean, rpe: number | null) {
    const s = await setup();
    for (const [i, id] of s.ridden.entries()) {
      ok(
        await logWorkoutSet({
          ...base(s.sessionId, id, i + 1, SECONDS[i]),
          ...(power && { avgPower: WATTS[i] }),
          ...(rpe !== null && { rpe }),
          sources: power ? { durationSeconds: "clock", avgPower: "typed" } : { durationSeconds: "clock" },
        }),
      );
    }
    await db.update(workoutSessions).set({ isCompleted: true, endTime: new Date(T0.getTime() + 3900_000) }).where(eq(workoutSessions.id, s.sessionId));
    return s;
  }

  it("power on every step and an FTP: the estimated power load (54 for the mockup ride), once", async () => {
    const s = await finishedRide(true, 6);
    const loads = (await appSessionLoads(me, TODAY, TODAY)).filter((l) => l.id === s.sessionId);
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ sport: "bike", method: "bike_power", durationS: 3900 });
    expect(Math.round(loads[0].load!)).toBe(54);
  });

  it("an ended-early ride counts its ridden steps only; a skipped step adds nothing", async () => {
    const s = await setup();
    ok(await logWorkoutSet({ ...base(s.sessionId, s.ridden[0], 1), avgPower: 124, sources: { avgPower: "typed" } }));
    ok(await logWorkoutSet({ ...base(s.sessionId, s.ridden[1], 2, 30), stepStatus: "skipped", isCompleted: false, sources: { durationSeconds: "clock" } }));
    await db.update(workoutSessions).set({ isCompleted: true, endedEarly: true }).where(eq(workoutSessions.id, s.sessionId));
    const [l] = (await appSessionLoads(me, TODAY, TODAY)).filter((x) => x.id === s.sessionId);
    expect(l.method).toBe("bike_power");
    expect(l.load).toBeCloseTo(0.25 * (124 / 180) ** 2 * 100, 5);
  });

  it("effort only: minutes x RPE x 0.22; nothing: no load, listed", async () => {
    const effort = await finishedRide(false, 6);
    const none = await finishedRide(false, null);
    const loads = await appSessionLoads(me, TODAY, TODAY);
    const e = loads.find((l) => l.id === effort.sessionId)!;
    expect(e.method).toBe("srpe");
    expect(e.load).toBeCloseTo(65 * 6 * 0.22, 5);
    expect(loads.find((l) => l.id === none.sessionId)).toMatchObject({ load: null, method: "none", reason: "needs_rpe" });
  });

  it("with a Garmin ride of the same day the app ride adds nothing to the Garmin series", async () => {
    const s = await finishedRide(true, 6);
    const app = (await appSessionLoads(me, null, TODAY)).filter((l) => l.sport === "bike");
    // As runGarminMetricsStep hands app sessions to the daily series (src/lib/garmin/metrics-job.ts).
    const appEndurance = app.map((l) => ({ sessionId: l.id, day: l.date, sport: "bike" as const, durationS: l.durationS, load: l.load, method: l.method === "bike_power" ? ("power" as const) : ("srpe" as const) }));
    const garminRide: ActivityInput = { garminActivityId: 1, day: TODAY, sport: "bike", load: 57, loadMethod: "power", startMs: T0.getTime(), endMs: T0.getTime() + 3912_000, bands: { low: 3000, mid: 900, high: 0 } };
    const days = [{ date: TODAY, hrvMs: null, garminHrvLow: null, garminHrvHigh: null, restingHr: null, sleep: null }];
    const [withGarmin] = buildDailyMetrics({ start: TODAY, end: TODAY, activities: [garminRide], strengthSessions: [], appEndurance, days });
    expect(withGarmin.entries.map((e) => [e.source, e.load])).toEqual([["garmin", 57]]);
    const [appOnly] = buildDailyMetrics({ start: TODAY, end: TODAY, activities: [], strengthSessions: [], appEndurance, days });
    expect(appOnly.entries).toHaveLength(1);
    expect(appOnly.entries[0]).toMatchObject({ source: "logeverylift", id: s.sessionId, method: "power" });
  });
});

describe("review fixes", () => {
  it("a step write over 12 hours is refused", async () => {
    const s = await setup();
    expect((await logWorkoutSet({ ...base(s.sessionId, s.ridden[0], 1, 12 * 3600 + 1), sources: { durationSeconds: "typed" } })).success).toBe(false);
    expect((await logWorkoutSet({ ...base(s.sessionId, s.ridden[0], 1, 12 * 3600), sources: { durationSeconds: "typed" } })).success).toBe(true);
  });

  it("an edit after an FTP change keeps the step as planned, so the load stays", async () => {
    const s = await setup();
    const WATTS = [124, 141, 92, 131, 118];
    const SECONDS = [900, 900, 300, 900, 900];
    for (const [i, id] of s.ridden.entries()) ok(await logWorkoutSet({ ...base(s.sessionId, id, i + 1, SECONDS[i]), avgPower: WATTS[i], sources: { durationSeconds: "clock", avgPower: "typed" } }));
    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, s.sessionId));
    const before = (await appSessionLoads(me, TODAY, TODAY)).find((l) => l.id === s.sessionId)!.load;
    // A retest the next day, then the rider adds an effort to the ride.
    await db.update(athleteThresholds).set({ value: 250 }).where(and(eq(athleteThresholds.userId, me), eq(athleteThresholds.kind, "ftp")));
    for (const [i, id] of s.ridden.entries()) ok(await logWorkoutSet({ ...base(s.sessionId, id, i + 1, SECONDS[i]), rpe: 6, sources: {} }));
    const r = await row(s.sessionId, s.ridden[0]);
    expect((r.plannedStep as { thresholds: { ftp: number } }).thresholds.ftp).toBe(180);
    expect((await appSessionLoads(me, TODAY, TODAY)).find((l) => l.id === s.sessionId)!.load).toBeCloseTo(before!, 6);
  });

  it("a bulk log or un-log (the workout list's ring) never touches a ride's step rows", async () => {
    const s = await setup();
    const id = s.ridden[0];
    ok(await logWorkoutSet({ ...base(s.sessionId, id, 1), avgPower: 124, sources: { durationSeconds: "clock", avgPower: "typed" } }));
    const plain = { sessionId: s.sessionId, exerciseId: bike, setNumber: 1, programSetId: id, actualReps: 0, weightKg: 0, durationSeconds: 60, restTimeSeconds: 0, isCompleted: true, bulk: true };
    ok(await logWorkoutSet(plain));
    expect([(await row(s.sessionId, id)).durationSeconds, (await row(s.sessionId, id)).avgPower]).toEqual([900, 124]);
    ok(await unlogWorkoutSet({ sessionId: s.sessionId, exerciseId: bike, setNumber: 1, programSetId: id, bulk: true }));
    expect(await row(s.sessionId, id)).toBeDefined();
    // A row with neither still logs in bulk.
    ok(await logWorkoutSet({ ...plain, programSetId: s.ridden[1], setNumber: 2 }));
    expect((await row(s.sessionId, s.ridden[1])).durationSeconds).toBe(60);
  });

  it("a finished ride writes its dropped last recovery as not done, and every set reads as handled", async () => {
    const s = await setup();
    const v = ok(await startRide({ sessionId: s.sessionId, programExerciseId: s.programExerciseId, mode: "indoor", clientId: "start-1" }));
    vi.setSystemTime(new Date(T0.getTime() + 3900_000 + 5_000));
    expect(ok(await getRide({ rideId: v.ride.id }))!.ride.status).toBe("finished");
    const dropped = await row(s.sessionId, s.setIds[4]);
    expect([dropped.stepStatus, dropped.isCompleted, dropped.durationSeconds]).toEqual(["not_done", false, null]);
    // The ride's own step saves (ride mode) land as usual.
    for (const [i, id] of s.ridden.entries()) ok(await logWorkoutSet(clockSave(s.sessionId, id, i + 1, [900, 900, 300, 900, 900][i])));
    expect(ok(await getActiveSessionCompletedProgramSetIds(s.sessionId)).sort()).toEqual([...s.setIds].sort());
    // A second read writes nothing more.
    ok(await getRide({ rideId: v.ride.id }));
    expect((await db.select().from(workoutSets).where(eq(workoutSets.sessionId, s.sessionId))).length).toBe(6);
    // The load and summary see 5 ridden steps.
    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, s.sessionId));
    expect((await appSessionLoads(me, TODAY, TODAY)).find((l) => l.id === s.sessionId)!.durationS).toBe(3900);
  });
});
