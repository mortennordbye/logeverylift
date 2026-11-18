/**
 * Garmin fill of a ride (docs/plans/bike-ride-logger.md, 4.8 and step 7),
 * against a real database with a synthetic stored activity: the streams are
 * built here, no real FIT file. Lap and time splits fill each step with the
 * stream average of its window; typed values stay; Undo restores and blocks a
 * refill; two matches fill nothing until the rider picks; a late activity
 * fills only empty fields; the activity type corrects the mode; a user
 * without Garmin is never touched.
 */
import { db } from "@/db";
import { athleteThresholds, garminActivities, garminActivityStreams, rideGarminFills, rides, workoutSessions, workoutSets } from "@/db/schema";
import { pickRideGarminActivity, undoRideGarminFill } from "@/lib/actions/ride-garmin";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { fillRidesFromGarmin, rideGarminView } from "@/lib/ride-garmin";
import { rideReport } from "@/lib/ride-report";
import type { RidePlan } from "@/lib/utils/ride-timeline";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TODAY = "2026-11-17";
const T0 = new Date(`${TODAY}T16:00:00Z`);
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const gmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

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
const SECONDS = [900, 900, 300, 900, 900];
const WATTS = [124, 141, 92, 131, 118];
const HR = [128, 146, 132, 150, 140];

let me: string;
let bike: number;

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** A finished ride of the mockup with each step saved by the clock; `pause` pauses it from 1000 s to 1060 s. */
async function finishedRide({ pause = false, mode = "indoor" as "indoor" | "outdoor" } = {}) {
  const { program, slots } = await createStepProgram(me, bike, mockup);
  const session = await createSession(me, program.id, { date: TODAY, startTime: T0 });
  const ids = slots[0].setIds;
  const ridden = [ids[0], ids[1], ids[2], ids[3], ids[5]];
  vi.setSystemTime(T0);
  const v = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode, clientId: `start-${Math.random()}` }));
  let seq = v.ride.seq;
  if (pause) {
    vi.setSystemTime(at(1000));
    seq = ok(await sendRideEvent({ rideId: v.ride.id, clientId: "p", kind: "pause", expectedSeq: seq })).ride.seq;
    vi.setSystemTime(at(1060));
    seq = ok(await sendRideEvent({ rideId: v.ride.id, clientId: "r", kind: "resume", expectedSeq: seq })).ride.seq;
  }
  vi.setSystemTime(at(3900 + (pause ? 60 : 0) + 5));
  expect(ok(await getRide({ rideId: v.ride.id }))!.ride.status).toBe("finished");
  for (const [i, id] of ridden.entries()) {
    ok(
      await logWorkoutSet({
        sessionId: session.id,
        exerciseId: bike,
        setNumber: i + 1,
        programSetId: id,
        actualReps: 0,
        weightKg: 0,
        durationSeconds: SECONDS[i],
        restTimeSeconds: 0,
        isCompleted: true,
        stepStatus: "done",
        targetOffsetW: 0,
        extendedSeconds: 0,
        sources: { durationSeconds: "clock" },
      }),
    );
  }
  return { rideId: v.ride.id, sessionId: session.id, ridden };
}

type Win = { from: number; to: number };

/** Garmin's record of the ride: 1 s samples on the riders' real step windows (`truth`), with a gap for each timer pause. */
async function storeActivity(opts: {
  id: number;
  truth: Win[];
  start?: Date;
  typeKey?: string;
  laps?: Win[];
  pauses?: Win[];
  userId?: string;
}) {
  const start = opts.start ?? T0;
  const end = opts.truth.at(-1)!.to;
  const pauses = opts.pauses ?? [];
  const t: number[] = [];
  for (let s = 0; s < end; s++) if (!pauses.some((p) => s >= p.from && s < p.to)) t.push(s);
  const stepOf = (s: number) => opts.truth.findIndex((w) => s >= w.from && s < w.to);
  const power = t.map((s) => WATTS[stepOf(s)] + ((s * 37) % 21) - 10);
  const hr = t.map((s) => HR[stepOf(s)] + ((s * 13) % 7) - 3);
  const cadence = t.map((s) => 88 + (s % 5));
  const distance = t.map((s) => s * 8);
  const altitude = t.map((s) => 100 + Math.floor(s / 100));
  const userId = opts.userId ?? me;
  const typeKey = opts.typeKey ?? "indoor_cycling";
  await db.insert(garminActivities).values({
    userId,
    garminActivityId: opts.id,
    // Local time stored as UTC (Europe/Oslo is UTC+1 in November).
    startTimeLocal: new Date(start.getTime() + 3600_000),
    activityType: typeKey,
    data: { activityId: opts.id, startTimeGMT: gmt(start), activityType: { typeKey }, duration: end, elapsedDuration: end },
    filesFetchedAt: new Date(),
  });
  const iso = (s: number) => new Date(start.getTime() + s * 1000).toISOString();
  await db.insert(garminActivityStreams).values({
    userId,
    garminActivityId: opts.id,
    parserVersion: 3,
    sport: "cycling",
    subSport: typeKey === "indoor_cycling" ? "indoor_cycling" : "road",
    streams: { t, power, hr, cadence, distance, altitude },
    laps: (opts.laps ?? []).map((l) => ({ startTime: iso(l.from), totalElapsedTime: l.to - l.from, totalTimerTime: l.to - l.from })),
    sets: [],
    timeInZone: [],
    session: { startTime: iso(0), totalElapsedTime: end },
    lengths: [],
    events: pauses.flatMap((p) => [
      { timestamp: iso(p.from), event: "timer", eventType: "stop_all" },
      { timestamp: iso(p.to), event: "timer", eventType: "start" },
    ]),
  });
  return { t, power, hr };
}

/** The stream's plain mean over a window: what the fill must land within 1 of. */
function mean(t: number[], v: number[], w: Win) {
  const xs = v.filter((_, i) => t[i] >= w.from && t[i] < w.to);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Step windows one after the other from `offset`, in seconds. */
function windows(offset = 0, pause?: Win): Win[] {
  let a = offset;
  return SECONDS.map((s) => {
    let from = a;
    let to = a + s;
    if (pause && from >= pause.from) from += pause.to - pause.from;
    if (pause && to > pause.from) to += pause.to - pause.from;
    a += s;
    return { from, to };
  });
}

const rowsOf = async (sessionId: number) => db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "Europe/Oslo", role: "admin" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "ftp", value: 180, measuredOn: TODAY, source: "manual" },
    { userId: me, kind: "lthr_bike", value: 171, measuredOn: TODAY, source: "manual" },
  ]);
  asUser(me, "admin");
});
afterEach(() => vi.useRealTimers());

describe("Garmin fill", () => {
  it("by laps: each step gets the stream average of its lap within 1 W and 1 bpm, marked garmin", async () => {
    const r = await finishedRide();
    // The watch started 20 s before Start ride; the rider pressed lap at each step change.
    const truth = windows(20);
    const s = await storeActivity({ id: 1, truth, laps: truth });
    expect(await fillRidesFromGarmin(me)).toBe(1);

    const rows = await rowsOf(r.sessionId);
    for (const [i, id] of r.ridden.entries()) {
      const row = rows.find((x) => x.programSetId === id)!;
      expect(Math.abs(row.avgPower! - mean(s.t, s.power, truth[i]))).toBeLessThanOrEqual(1);
      expect(Math.abs(row.avgHr! - mean(s.t, s.hr, truth[i]))).toBeLessThanOrEqual(1);
      expect(row.maxHr).toBe(Math.max(...s.hr.filter((_, k) => s.t[k] >= truth[i].from && s.t[k] < truth[i].to)));
      expect(row.avgCadence).toBe(90);
      // Indoors: no distance, speed or climbing (D12).
      expect([row.distanceMeters, row.avgSpeed, row.climbM]).toEqual([null, null, null]);
      expect(row.sources).toEqual({ durationSeconds: "clock", avgPower: "garmin", avgHr: "garmin", maxHr: "garmin", avgCadence: "garmin" });
    }
    const view = await rideGarminView(me, r.rideId);
    expect(view.state).toBe("filled");
    expect(view.stream?.split).toBe("laps");
    // A second sync writes nothing more.
    expect(await fillRidesFromGarmin(me)).toBe(0);
  });

  it("by time: the timeline's steps on Garmin's timer time, skipping its pause", async () => {
    const r = await finishedRide({ pause: true });
    const pause = { from: 1000, to: 1060 };
    const truth = windows(0, pause);
    // One lap for the whole ride: not one per step, so the split is by time.
    const s = await storeActivity({ id: 2, truth, pauses: [pause], laps: [{ from: 0, to: truth.at(-1)!.to }] });
    expect(await fillRidesFromGarmin(me)).toBe(1);
    const rows = await rowsOf(r.sessionId);
    for (const [i, id] of r.ridden.entries()) {
      const row = rows.find((x) => x.programSetId === id)!;
      expect(Math.abs(row.avgPower! - mean(s.t, s.power, truth[i]))).toBeLessThanOrEqual(1);
      expect(Math.abs(row.avgHr! - mean(s.t, s.hr, truth[i]))).toBeLessThanOrEqual(1);
    }
    expect((await rideGarminView(me, r.rideId)).stream?.split).toBe("time");
  });

  it("typed and assistant values stay; only empty and clock fields fill", async () => {
    const r = await finishedRide();
    const [, two, three] = r.ridden;
    await db.update(workoutSets).set({ avgPower: 150, sources: { durationSeconds: "clock", avgPower: "typed" } }).where(eq(workoutSets.programSetId, two));
    await db.update(workoutSets).set({ avgHr: 120, sources: { durationSeconds: "clock", avgHr: "assistant" } }).where(eq(workoutSets.programSetId, three));
    await storeActivity({ id: 3, truth: windows() });
    await fillRidesFromGarmin(me);
    const rows = await rowsOf(r.sessionId);
    const a = rows.find((x) => x.programSetId === two)!;
    const b = rows.find((x) => x.programSetId === three)!;
    expect([a.avgPower, a.sources!.avgPower, a.sources!.avgHr]).toEqual([150, "typed", "garmin"]);
    expect([b.avgHr, b.sources!.avgHr, b.sources!.avgPower]).toEqual([120, "assistant", "garmin"]);
  });

  it("Undo restores what was there and marks the pair declined; a re-sync never fills it again", async () => {
    const r = await finishedRide();
    const two = r.ridden[1];
    await db.update(workoutSets).set({ avgPower: 150, sources: { durationSeconds: "clock", avgPower: "typed" } }).where(eq(workoutSets.programSetId, two));
    await storeActivity({ id: 4, truth: windows() });
    await fillRidesFromGarmin(me);
    // The rider types over one Garmin value before the undo: it stays.
    await db
      .update(workoutSets)
      .set({ maxHr: 170, sources: { durationSeconds: "clock", avgPower: "garmin", avgHr: "garmin", maxHr: "typed", avgCadence: "garmin" } })
      .where(eq(workoutSets.programSetId, r.ridden[0]));

    ok(await undoRideGarminFill({ rideId: r.rideId }));
    const rows = await rowsOf(r.sessionId);
    const first = rows.find((x) => x.programSetId === r.ridden[0])!;
    expect([first.avgPower, first.avgHr, first.maxHr, first.avgCadence]).toEqual([null, null, 170, null]);
    expect(first.sources).toEqual({ durationSeconds: "clock", maxHr: "typed" });
    const t = rows.find((x) => x.programSetId === two)!;
    expect([t.avgPower, t.avgHr, t.sources]).toEqual([150, null, { durationSeconds: "clock", avgPower: "typed" }]);
    const [fill] = await db.select().from(rideGarminFills).where(eq(rideGarminFills.rideId, r.rideId));
    expect(fill.declined).toBe(true);

    expect(await fillRidesFromGarmin(me)).toBe(0);
    expect((await rowsOf(r.sessionId)).find((x) => x.programSetId === r.ridden[2])!.avgPower).toBeNull();
    expect((await rideGarminView(me, r.rideId)).state).toBe("none");
    // A second undo finds nothing.
    expect((await undoRideGarminFill({ rideId: r.rideId })).success).toBe(false);
  });

  it("two matching activities fill nothing; the summary offers Pick, and a pick fills", async () => {
    const r = await finishedRide();
    await storeActivity({ id: 5, truth: windows() });
    await storeActivity({ id: 6, truth: [{ from: 0, to: 1800 }], start: at(1200) });
    expect(await fillRidesFromGarmin(me)).toBe(0);
    expect((await rowsOf(r.sessionId)).every((x) => x.avgPower === null)).toBe(true);
    const view = await rideGarminView(me, r.rideId);
    expect(view.state).toBe("pick");
    expect(view.candidates.map((c) => c.garminActivityId)).toEqual([5, 6]);

    ok(await pickRideGarminActivity({ rideId: r.rideId, garminActivityId: 5 }));
    expect((await rideGarminView(me, r.rideId)).state).toBe("filled");
    expect((await rowsOf(r.sessionId)).filter((x) => r.ridden.includes(x.programSetId!)).every((x) => x.avgPower !== null)).toBe(true);
    expect((await pickRideGarminActivity({ rideId: r.rideId, garminActivityId: 6 })).success).toBe(false);
  });

  it("matches with 5 min tolerance only", async () => {
    const r = await finishedRide();
    // Starts 6 min after the ride ended.
    await storeActivity({ id: 7, truth: [{ from: 0, to: 1800 }], start: at(3900 + 360) });
    expect(await fillRidesFromGarmin(me)).toBe(0);
    // One that starts 4 min after the end still matches.
    await storeActivity({ id: 8, truth: windows(), start: at(3900 + 240) });
    expect(await fillRidesFromGarmin(me)).toBe(1);
    expect((await rideGarminView(me, r.rideId)).garminActivityId).toBe(8);
  });

  it("a late activity, days after the rider typed the watts, fills only the empty fields", async () => {
    const r = await finishedRide();
    for (const [i, id] of r.ridden.entries())
      await db.update(workoutSets).set({ avgPower: WATTS[i] + 3, sources: { durationSeconds: "clock", avgPower: "typed" } }).where(eq(workoutSets.programSetId, id));
    vi.setSystemTime(new Date(T0.getTime() + 2 * 86_400_000));
    await storeActivity({ id: 9, truth: windows() });
    expect(await fillRidesFromGarmin(me)).toBe(1);
    for (const [i, row] of (await rowsOf(r.sessionId)).filter((x) => r.ridden.includes(x.programSetId!)).sort((a, b) => a.setNumber - b.setNumber).entries()) {
      expect(row.avgPower).toBe(WATTS[i] + 3);
      expect(row.sources!.avgPower).toBe("typed");
      expect(row.sources!.avgHr).toBe("garmin");
    }
  });

  it("the activity type corrects the mode; outdoors it fills distance, speed and climbing; Undo puts the mode back", async () => {
    const r = await finishedRide({ mode: "indoor" });
    await storeActivity({ id: 10, truth: windows(), typeKey: "road_biking" });
    await fillRidesFromGarmin(me);
    const [ride] = await db.select().from(rides).where(eq(rides.id, r.rideId));
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, r.sessionId));
    expect([ride.mode, (ride.plan as RidePlan).mode, session.rideMode]).toEqual(["outdoor", "outdoor", "outdoor"]);
    const first = (await rowsOf(r.sessionId)).find((x) => x.programSetId === r.ridden[0])!;
    expect(first.distanceMeters).toBe(7192);
    expect(first.avgSpeed).toBeCloseTo(8, 1);
    expect(first.climbM).toBeGreaterThan(0);

    ok(await undoRideGarminFill({ rideId: r.rideId }));
    const [after] = await db.select().from(rides).where(eq(rides.id, r.rideId));
    const [s2] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, r.sessionId));
    expect([after.mode, (after.plan as RidePlan).mode, s2.rideMode]).toEqual(["indoor", "indoor", "indoor"]);
  });

  it("a user without Garmin access is never touched", async () => {
    await db.update((await import("@/db/schema")).users).set({ role: "user" }).where(eq((await import("@/db/schema")).users.id, me));
    asUser(me);
    const r = await finishedRide();
    await storeActivity({ id: 11, truth: windows() });
    expect(await fillRidesFromGarmin(me)).toBe(0);
    expect((await rowsOf(r.sessionId)).every((x) => x.avgPower === null && x.avgHr === null)).toBe(true);
    expect((await rideGarminView(me, r.rideId)).state).toBe("none");
    expect((await undoRideGarminFill({ rideId: r.rideId })).success).toBe(false);
  });

  it("get_ride gives the stream numbers once filled", async () => {
    const r = await finishedRide();
    expect((await rideReport(me, { workoutSessionId: r.sessionId }))!.numbers.stream).toBe(false);
    await storeActivity({ id: 12, truth: windows() });
    await fillRidesFromGarmin(me);
    const rep = (await rideReport(me, { workoutSessionId: r.sessionId }))!;
    expect(rep.numbers.stream).toBe(true);
    expect(rep.numbers.np).toBeGreaterThan(rep.numbers.avgPower!);
    expect(rep.numbers.intensityFactor).toBeCloseTo(rep.numbers.np! / 180, 2);
    expect(rep.numbers.load).toMatchObject({ method: "power", estimated: false });
    expect(rep.numbers.heartRateZoneMinutes!.length).toBeGreaterThan(0);
    expect(rep.numbers.drift).toMatchObject({ steady: expect.any(Boolean) });
    expect(rep.numbers.timeOnTarget).toHaveLength(5);
    expect(rep.garmin).toMatchObject({ state: "filled", garminActivityId: 12, split: "time" });
  });
});
