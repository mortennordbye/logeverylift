/**
 * Garmin fill of a run (docs/plans/run-logger.md, 4.8 and 4.9, step 7),
 * against a real database with stored FIT files: the synthetic treadmill,
 * outdoor and multisport files of src/__tests__/fixtures/fit (no real Garmin
 * data), parsed by the app's own parser. The fill gives a run only a run's
 * numbers (never a ride's), keeps the belt's distance, doubles the cadence,
 * corrects the mode, rewrites its Garmin fields on a re-sync, restores on
 * Undo, waits for a Pick when two runs match, and fills a ride and a run from
 * one multisport file with T2 from its transition.
 */
import { db } from "@/db";
import { athleteThresholds, garminActivities, garminActivityStreams, rides, workoutSets } from "@/db/schema";
import { pickRideGarminActivity, undoRideGarminFill } from "@/lib/actions/ride-garmin";
import { getRide, sendRideEvent, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { parseFit } from "@/lib/garmin/fit";
import { RunLog, fetchActivities } from "@/lib/garmin/sync";
import { fillRidesFromGarmin, rideGarminView } from "@/lib/ride-garmin";
import { runGarminView } from "@/lib/run-garmin";
import { runAfterView } from "@/lib/run-exercise-view";
import { runReport } from "@/lib/run-report";
import { rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { beltResults } from "@/lib/utils/run-screen";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MULTISPORT_START, OUTDOOR_START, RUN_BIKE_START, TREADMILL_START } from "../fixtures/fit/make-fit-fixtures";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const activityList = vi.fn();
vi.mock("@/lib/garmin/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/garmin/client")>()), fetchActivityList: () => activityList() }));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const fitFile = (name: string) => parseFit(readFileSync(join(__dirname, "../fixtures/fit", `${name}.fit`)));
const gmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** 300 s warm-up at 7.5 km/h, 600 s at 8.0 km/h in zone 2, 240 s cool-down by feel. */
const treadmillRun = {
  v: 2,
  sport: "run",
  name: "Easy",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 300 }, belt: 7.5 },
    { type: "work", end: { type: "time", seconds: 600 }, belt: 8, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    { type: "cooldown", end: { type: "time", seconds: 240 } },
  ],
};
/** 300 s warm-up, 1000 m at 3.28 to 3.38 m/s (about 300 s), 240 s cool-down. */
const kmRun = {
  v: 2,
  sport: "run",
  name: "Km",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 300 } },
    { type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "absolute", low: 3.28, high: 3.38 } },
    { type: "cooldown", end: { type: "time", seconds: 240 } },
  ],
};
const ride600 = {
  v: 2,
  sport: "bike",
  name: "Ride",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 300 } },
    { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", low: 75, high: 85 } },
  ],
};

let me: string;
let runEx: number;
let bikeEx: number;
let ids = 0;
const cid = () => `g${++ids}`;

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** Store a FIT file as the worker does, as a Garmin activity of `typeKey`. */
async function storeFit(id: number, name: string, typeKey: string, opts: { userId?: string; scaleDistance?: number } = {}) {
  const p = fitFile(name);
  const start = new Date(p.startTime!);
  const segs = (p.session?.segments ?? []) as { totalElapsedTime: number; totalDistance: number }[];
  const seconds = segs.reduce((a, s) => a + s.totalElapsedTime, 0);
  const meters = segs.reduce((a, s) => a + s.totalDistance, 0);
  const streams = opts.scaleDistance ? { ...p.streams, distance: p.streams.distance!.map((d) => (d === null ? null : d * opts.scaleDistance!)) } : p.streams;
  const userId = opts.userId ?? me;
  await db
    .insert(garminActivities)
    .values({
      userId,
      garminActivityId: id,
      startTimeLocal: new Date(start.getTime() + 3600_000),
      activityType: typeKey,
      data: { activityId: id, startTimeGMT: gmt(start), activityType: { typeKey }, duration: seconds, elapsedDuration: seconds, distance: meters },
      filesFetchedAt: new Date(),
    })
    .onConflictDoNothing();
  const values = {
    parserVersion: p.parserVersion,
    sport: p.sport,
    subSport: p.subSport,
    streams,
    laps: p.laps,
    sets: p.sets,
    timeInZone: p.timeInZone,
    session: p.session,
    lengths: p.lengths,
    events: p.events,
    parsedAt: new Date(),
  };
  await db
    .insert(garminActivityStreams)
    .values({ userId, garminActivityId: id, ...values })
    .onConflictDoUpdate({ target: [garminActivityStreams.userId, garminActivityStreams.garminActivityId], set: values });
}

/** Run a whole run (or ride) from `start` on its timeline and save each step as run mode does; `during` sends events after the start. */
async function runThrough(
  workout: unknown,
  exercise: number,
  mode: "indoor" | "outdoor",
  start: Date,
  during: (rideId: number, plan: RidePlan, seq: number) => Promise<number> = async (_, __, seq) => seq,
) {
  const { program, slots } = await createStepProgram(me, exercise, workout);
  const session = await createSession(me, program.id, { date: start.toISOString().slice(0, 10), startTime: start });
  vi.setSystemTime(start);
  const view = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode, clientId: cid() }));
  await during(view.ride.id, view.plan, view.ride.seq);
  const total = view.plan.steps.reduce((a, s) => a + (s.seconds ?? s.estSeconds), 0);
  vi.setSystemTime(new Date(start.getTime() + total * 1000 + 60_000));
  const [row] = await db.select().from(rides).where(eq(rides.id, view.ride.id));
  const { rideEvents } = await import("@/db/schema");
  const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, view.ride.id));
  const t = rideTimeline(row.plan as RidePlan, events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime(), stepKey: e.stepKey })), Date.now());
  expect(t.status).toBe("finished");
  const run = (row.plan as RidePlan).sport === "run";
  for (const [i, r] of t.steps.entries()) {
    const b = run && mode === "indoor" ? beltResults(r) : {};
    ok(
      await logWorkoutSet({
        sessionId: session.id,
        exerciseId: exercise,
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
      }),
    );
  }
  return { rideId: view.ride.id, sessionId: session.id, programExerciseId: slots[0].programExerciseId, steps: t.steps, plan: row.plan as RidePlan };
}

/** A belt tap in the run's second step, 100 s into it: 8.5 km/h. */
const beltTapInStep2 = (start: Date) => async (rideId: number, plan: RidePlan, seq: number) => {
  vi.setSystemTime(new Date(start.getTime() + 400_000));
  return ok(await sendRideEvent({ rideId, clientId: cid(), kind: "belt", value: 85, stepKey: plan.steps[1].key, expectedSeq: seq })).ride.seq;
};

const rowsOf = async (sessionId: number) => {
  const rows = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId));
  return rows.sort((a, b) => a.setNumber - b.setNumber);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TREADMILL_START);
  me = (await createUser({ enduranceEnabled: true, timeZone: "Europe/Oslo", role: "admin" })).id;
  runEx = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  bikeEx = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" },
  ]);
  asUser(me, "admin");
});
afterEach(() => vi.useRealTimers());

const at = (start: Date, s: number) => new Date(start.getTime() + s * 1000);
const later = (start: Date, s: number) => vi.setSystemTime(at(start, s));

describe("the fill loop keeps sports apart (integration 1)", () => {
  it("a bike activity never fills a run, and a run activity never fills a ride", async () => {
    const run = await runThrough(treadmillRun, runEx, "indoor", at(TREADMILL_START, 20));
    await storeFit(101, "treadmill", "indoor_cycling");
    later(TREADMILL_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(0);
    expect((await rowsOf(run.sessionId)).some((r) => Object.values(r.sources ?? {}).includes("garmin"))).toBe(false);

    const ride = await runThrough(ride600, bikeEx, "indoor", at(OUTDOOR_START, 0));
    await storeFit(102, "outdoor", "running");
    later(OUTDOOR_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(0);
    expect((await rowsOf(ride.sessionId)).every((r) => r.avgPower === null && r.avgHr === null)).toBe(true);
    expect((await runGarminView(me, ride.rideId)).state).toBe("none");
  });
});

describe("a treadmill run (integration 2)", () => {
  it("keeps the belt's distance, fills distance only on the step the belt never knew, doubles the cadence and never writes power", async () => {
    const r = await runThrough(treadmillRun, runEx, "indoor", at(TREADMILL_START, 20), beltTapInStep2(at(TREADMILL_START, 20)));
    expect(r.plan.steps[2].run?.belt).toBeNull();
    const before = await rowsOf(r.sessionId);
    await storeFit(201, "treadmill", "treadmill_running");
    later(TREADMILL_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(1);

    const rows = await rowsOf(r.sessionId);
    // Belt distances stay as the belt gave them: 7.5 km/h for 300 s, then 100 s at 8.0 and 500 s at 8.5.
    expect(rows[0].distanceMeters).toBe(before[0].distanceMeters);
    expect(rows[0].distanceMeters).toBeCloseTo(625, 0);
    expect(rows[1].distanceMeters).toBeCloseTo((8 / 3.6) * 100 + (8.5 / 3.6) * 500, 0);
    expect([rows[0].sources?.distanceMeters, rows[1].sources?.avgSpeed]).toEqual(["belt", "belt"]);
    // The cool-down ran by feel: Garmin's 1.6 m/s for 240 s.
    expect(rows[2].distanceMeters).toBeCloseTo(384, -1);
    expect(rows[2].sources).toMatchObject({ distanceMeters: "garmin", avgSpeed: "garmin" });
    for (const [i, hr] of [125, 145, 120].entries()) {
      expect(Math.abs(rows[i].avgHr! - hr)).toBeLessThanOrEqual(1);
      expect(rows[i].avgCadence).toBe(170);
      expect(rows[i].avgPower).toBeNull();
      expect(rows[i].climbM).toBeNull();
    }
    // The mode stays the treadmill.
    const [ride] = await db.select().from(rides).where(eq(rides.id, r.rideId));
    expect([ride.mode, (ride.plan as RidePlan).mode]).toEqual(["indoor", "indoor"]);

    // The page reads the active ride first, which settles one that has ended.
    ok(await getRide({}));
    const after = await runAfterView(me, r.programExerciseId);
    expect(after?.doneLine).toMatch(/Treadmill · from Garmin$/);
    expect(after?.garminWaiting).toBe(false);
    expect(after?.garmin.stream?.split).toBe("time");
    // Zones from the 1 s stream: warm-up and cool-down in zone 1, the steady step in zone 2 (145 of 180 is 81%: zone 1 too).
    expect(after?.garmin.stream?.numbers.hrZoneMinutes).toEqual([19, 0, 0, 0, 0]);
    expect(after?.garmin.stream?.chart?.power).toBeTruthy();
    const report = await runReport(me, ride);
    expect(report.numbers).toMatchObject({ stream: true, zonesFrom: "stream", distanceSource: "Distance from the belt and Garmin" });
    expect(report.garmin).toMatchObject({ state: "filled", garminActivityId: 201, split: "time" });
  });
});

describe("a re-sync, Undo and the declined pair (integration 3)", () => {
  it("a re-sync rewrites only fields still marked Garmin; Undo restores; a later re-sync never fills the declined pair", async () => {
    const r = await runThrough(treadmillRun, runEx, "indoor", at(TREADMILL_START, 20));
    await storeFit(301, "treadmill", "treadmill_running");
    later(TREADMILL_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(1);
    const first = await rowsOf(r.sessionId);
    // The runner types over one Garmin heart rate.
    await db.update(workoutSets).set({ avgHr: 133, sources: { ...first[2].sources, avgHr: "typed" } }).where(eq(workoutSets.id, first[2].id));

    // Garmin's treadmill calibration: the file comes again with 10% more distance.
    later(TREADMILL_START, 3000);
    await storeFit(301, "treadmill", "treadmill_running", { scaleDistance: 1.1 });
    later(TREADMILL_START, 3100);
    await fillRidesFromGarmin(me);
    const second = await rowsOf(r.sessionId);
    expect(second[2].distanceMeters).toBeCloseTo(first[2].distanceMeters! * 1.1, -1);
    expect(second[2].avgHr).toBe(133);
    // Belt distances never move.
    expect(second[0].distanceMeters).toBe(first[0].distanceMeters);

    ok(await undoRideGarminFill({ rideId: r.rideId }));
    const undone = await rowsOf(r.sessionId);
    expect([undone[2].distanceMeters, undone[2].avgSpeed, undone[2].avgCadence, undone[0].avgHr]).toEqual([null, null, null, null]);
    expect(undone[2].avgHr).toBe(133);
    expect(undone[0].sources).toEqual({ durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" });

    later(TREADMILL_START, 4000);
    await storeFit(301, "treadmill", "treadmill_running", { scaleDistance: 1.2 });
    later(TREADMILL_START, 4100);
    expect(await fillRidesFromGarmin(me)).toBe(0);
    expect((await rowsOf(r.sessionId))[2].distanceMeters).toBeNull();
    expect((await runGarminView(me, r.rideId)).state).toBe("refill");
  });
});

describe("Garmin's treadmill calibration (4.8)", () => {
  it("a run whose distance changed in the activity list gets its file fetched again; other changes do not", async () => {
    const record = (distance: number, name: string) => ({
      activityId: 701,
      activityName: name,
      startTimeLocal: "2026-11-17 17:00:00",
      startTimeGMT: "2026-11-17 16:00:00",
      activityType: { typeKey: "treadmill_running" },
      duration: 1170,
      distance,
    });
    const filesAt = async () => (await db.select({ at: garminActivities.filesFetchedAt }).from(garminActivities).where(and(eq(garminActivities.userId, me), eq(garminActivities.garminActivityId, 701))))[0].at;
    activityList.mockResolvedValue([record(2529, "Run")]);
    await fetchActivities("t", me, "2026-11-17", "2026-11-17", new RunLog());
    await db.update(garminActivities).set({ filesFetchedAt: new Date() }).where(and(eq(garminActivities.userId, me), eq(garminActivities.garminActivityId, 701)));
    activityList.mockResolvedValue([record(2529, "Treadmill run")]);
    await fetchActivities("t", me, "2026-11-17", "2026-11-17", new RunLog());
    expect(await filesAt()).not.toBeNull();
    activityList.mockResolvedValue([record(2800, "Treadmill run")]);
    await fetchActivities("t", me, "2026-11-17", "2026-11-17", new RunLog());
    expect(await filesAt()).toBeNull();
  });
});

describe("an outdoor run", () => {
  it("fills distance, pace, climbing and the doubled cadence by laps; an estimate step takes its Garmin lap time", async () => {
    const r = await runThrough(kmRun, runEx, "outdoor", OUTDOOR_START);
    expect(r.plan.steps[1].run?.rule).toBe("estimate");
    await storeFit(401, "outdoor", "running");
    later(OUTDOOR_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(1);
    const rows = await rowsOf(r.sessionId);
    // The first record has run a second already: Garmin's lap says 750.
    expect(rows[0].distanceMeters).toBeCloseTo(750, -1);
    expect(rows.slice(1).map((x) => x.distanceMeters)).toEqual([1000, 528]);
    expect(rows[1]).toMatchObject({ durationSeconds: 310, avgCadence: 170 });
    expect(rows[1].sources).toMatchObject({ durationSeconds: "garmin", distanceMeters: "garmin", avgSpeed: "garmin", climbM: "garmin" });
    expect(rows[1].avgSpeed).toBeCloseTo(1000 / 310, 2);
    expect(rows[1].climbM).toBeGreaterThan(10);
    // A time step keeps its clock time.
    expect([rows[0].durationSeconds, rows[0].sources?.durationSeconds]).toEqual([300, "clock"]);
    const view = await runGarminView(me, r.rideId);
    expect(view.stream?.split).toBe("laps");
    // 1000 m in 310 s is slower than 3.28 m/s: the pace is judged, and GAP and load come from the stream.
    expect(view.stream?.numbers.gapSPerKm).toBeGreaterThan(0);
    expect(view.stream?.numbers.load).toBeGreaterThan(0);
    expect(view.stream?.numbers.onTarget[r.plan.steps[1].programSetId]).not.toBeNull();
  });

  it("a run started on the treadmill that Garmin recorded outdoors with GPS: GPS distance wins, the belt stays stored, Undo puts back the belt and the mode", async () => {
    const tap = async (rideId: number, plan: RidePlan, seq: number) => {
      later(OUTDOOR_START, 100);
      return ok(await sendRideEvent({ rideId, clientId: cid(), kind: "belt", value: 90, stepKey: plan.steps[0].key, expectedSeq: seq })).ride.seq;
    };
    const r = await runThrough(kmRun, runEx, "indoor", OUTDOOR_START, tap);
    const before = await rowsOf(r.sessionId);
    expect(before[0].sources?.distanceMeters).toBe("belt");
    await storeFit(402, "outdoor", "running");
    later(OUTDOOR_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(1);
    const [ride] = await db.select().from(rides).where(eq(rides.id, r.rideId));
    expect([ride.mode, (ride.plan as RidePlan).mode]).toEqual(["outdoor", "outdoor"]);
    const rows = await rowsOf(r.sessionId);
    expect(rows[0].distanceMeters).toBeCloseTo(750, -1);
    expect(rows[0].sources).toMatchObject({ distanceMeters: "garmin", avgSpeed: "garmin" });
    // The belt events stay.
    const { rideEvents } = await import("@/db/schema");
    expect((await db.select().from(rideEvents).where(and(eq(rideEvents.rideId, r.rideId), eq(rideEvents.kind, "belt")))).length).toBe(1);

    ok(await undoRideGarminFill({ rideId: r.rideId }));
    const back = await rowsOf(r.sessionId);
    expect([back[0].distanceMeters, back[0].avgSpeed, back[0].sources?.distanceMeters, back[0].sources?.avgSpeed]).toEqual([
      before[0].distanceMeters,
      before[0].avgSpeed,
      "belt",
      "belt",
    ]);
    const [undone] = await db.select().from(rides).where(eq(rides.id, r.rideId));
    expect([undone.mode, (undone.plan as RidePlan).mode]).toEqual(["indoor", "indoor"]);
  });

  it("an outdoor run type without GPS keeps the run's mode", async () => {
    const r = await runThrough(treadmillRun, runEx, "indoor", at(TREADMILL_START, 20));
    await storeFit(403, "treadmill", "running");
    later(TREADMILL_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(1);
    const [ride] = await db.select().from(rides).where(eq(rides.id, r.rideId));
    expect(ride.mode).toBe("indoor");
  });
});

describe("two Garmin runs match (Pick)", () => {
  it("fills nothing until the runner picks one; the pick fills from that one", async () => {
    const r = await runThrough(kmRun, runEx, "outdoor", OUTDOOR_START);
    await storeFit(501, "outdoor", "running");
    await storeFit(502, "outdoor", "trail_running");
    later(OUTDOOR_START, 2000);
    expect(await fillRidesFromGarmin(me)).toBe(0);
    const view = await runGarminView(me, r.rideId);
    expect(view.state).toBe("pick");
    expect(view.candidates.map((c) => [c.garminActivityId, c.segment, c.meters])).toEqual([
      [501, 0, 2278],
      [502, 0, 2278],
    ]);
    ok(await pickRideGarminActivity({ rideId: r.rideId, garminActivityId: 502 }));
    expect((await runGarminView(me, r.rideId)).garminActivityId).toBe(502);
    expect((await rowsOf(r.sessionId))[1].distanceMeters).toBe(1000);
    const again = await pickRideGarminActivity({ rideId: r.rideId, garminActivityId: 501 });
    expect(again).toEqual({ success: false, error: "The run is already filled from Garmin" });
  });
});

describe("a multisport file (integration 4)", () => {
  it("fills the ride from its bike part and the run from its run part, and gives T2 from its transition", async () => {
    const ride = await runThrough(ride600, bikeEx, "outdoor", MULTISPORT_START);
    // The run starts 90 s after the ride on the app; Garmin's transition says 72 s.
    const run = await runThrough(kmRun, runEx, "outdoor", at(MULTISPORT_START, 690));
    await db.update(rides).set({ brickRideId: ride.rideId }).where(eq(rides.id, run.rideId));
    await storeFit(601, "multisport", "multi_sport");
    later(MULTISPORT_START, 3000);
    expect(await fillRidesFromGarmin(me)).toBe(2);

    const rideRows = await rowsOf(ride.sessionId);
    for (const x of rideRows) {
      expect(Math.abs(x.avgPower! - 150)).toBeLessThanOrEqual(1);
      expect(x.avgCadence).toBe(88);
    }
    const runRows = await rowsOf(run.sessionId);
    // The run's part: no power from the ride, cadence doubled, distance from GPS.
    expect(runRows.every((x) => x.avgPower === null && x.avgCadence === 170)).toBe(true);
    expect(runRows[0].distanceMeters).toBeGreaterThan(600);
    const fills = await db.select().from((await import("@/db/schema")).rideGarminFills).where(eq((await import("@/db/schema")).rideGarminFills.garminActivityId, 601));
    expect(fills.map((f) => [f.rideId, f.segment]).sort()).toEqual([
      [ride.rideId, 0],
      [run.rideId, 2],
    ].sort());

    ok(await getRide({}));
    const after = await runAfterView(me, run.programExerciseId);
    expect(after?.brick).toEqual({ rideSeconds: 600, t2Seconds: 72 });
    expect((await runGarminView(me, run.rideId)).t2Seconds).toBe(72);
  });
});

describe("step 7 review", () => {
  it("a ride filled from the bike part of a multisport file (segment 2) fills again after Undo, with the candidate the summary shows", async () => {
    const ride = await runThrough(ride600, bikeEx, "outdoor", at(RUN_BIKE_START, 910));
    await storeFit(901, "run-bike", "multi_sport");
    later(RUN_BIKE_START, 3000);
    expect(await fillRidesFromGarmin(me)).toBe(1);
    ok(await undoRideGarminFill({ rideId: ride.rideId }));
    const view = await rideGarminView(me, ride.rideId);
    expect(view.state).toBe("refill");
    const c = view.candidates[0];
    expect(c.segment).toBe(2);
    // As GarminFill sends it.
    const r = await pickRideGarminActivity({ rideId: ride.rideId, garminActivityId: c.garminActivityId, ...(c.segment !== undefined && { segment: c.segment }) });
    expect(r).toEqual({ success: true, data: null });
    expect((await rowsOf(ride.sessionId)).every((x) => x.avgPower !== null)).toBe(true);
  });

  it("two activities that hold the same multisport file are one match, not a Pick", async () => {
    const run = await runThrough(kmRun, runEx, "outdoor", at(MULTISPORT_START, 690));
    await storeFit(801, "multisport", "multi_sport");
    await storeFit(802, "multisport", "multi_sport");
    later(MULTISPORT_START, 3000);
    expect(await fillRidesFromGarmin(me)).toBe(1);
    expect((await runGarminView(me, run.rideId)).state).toBe("filled");
  });
});
