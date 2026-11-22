/**
 * The step page's data (docs/plans/session-check.md, decisions 7 and 8),
 * against a real database: an app ride filled from Garmin is judged step by
 * step with its match line; a run done on the watch alone is split into the
 * planned steps by its laps, or by the planned times; a user never reads
 * another user's session.
 */
import { db } from "@/db";
import { athleteThresholds, garminActivities, garminActivityStreams, trainingCycleSlots, trainingCycles, plannedSessions } from "@/db/schema";
import { getRide, startRide } from "@/lib/actions/rides";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { fillRidesFromGarmin } from "@/lib/ride-garmin";
import { hasSessionCheck, plannedSessionCheck, workoutSessionCheck } from "@/lib/session-check";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

// Garmin is on for admins only when the key is set (src/lib/garmin/access.ts).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TODAY = "2026-11-17";
const T0 = new Date(`${TODAY}T16:00:00Z`);
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const gmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

let me: string;
let other: string;

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** Garmin's record: 1 s samples, each window with its own numbers; laps on the windows when asked. */
async function storeActivity(opts: {
  userId: string;
  id: number;
  typeKey: string;
  name: string;
  windows: { seconds: number; power?: number; hr: number; cadence: number; speed?: number }[];
  laps: boolean;
}) {
  const end = opts.windows.reduce((a, w) => a + w.seconds, 0);
  const t: number[] = [];
  const power: number[] = [];
  const hr: number[] = [];
  const cadence: number[] = [];
  const distance: number[] = [];
  let s = 0;
  let meters = 0;
  for (const w of opts.windows) {
    for (let k = 0; k < w.seconds; k++, s++) {
      t.push(s);
      power.push(w.power ?? 0);
      hr.push(w.hr);
      cadence.push(w.cadence);
      meters += w.speed ?? 0;
      distance.push(meters);
    }
  }
  const iso = (x: number) => new Date(T0.getTime() + x * 1000).toISOString();
  let from = 0;
  const laps = opts.windows.map((w) => {
    const l = { startTime: iso(from), totalElapsedTime: w.seconds, totalTimerTime: w.seconds };
    from += w.seconds;
    return l;
  });
  const [row] = await db
    .insert(garminActivities)
    .values({
      userId: opts.userId,
      garminActivityId: opts.id,
      // Local time stored as UTC (the users are on UTC here).
      startTimeLocal: T0,
      activityType: opts.typeKey,
      data: { activityId: opts.id, activityName: opts.name, startTimeGMT: gmt(T0), duration: end, elapsedDuration: end, distance: meters },
      filesFetchedAt: new Date(),
    })
    .returning();
  await db.insert(garminActivityStreams).values({
    userId: opts.userId,
    garminActivityId: opts.id,
    parserVersion: 3,
    sport: opts.typeKey === "running" ? "running" : "cycling",
    subSport: opts.typeKey,
    streams: { t, power, hr, cadence, distance },
    laps: opts.laps ? laps : [{ startTime: iso(0), totalElapsedTime: end, totalTimerTime: end }],
    sets: [],
    timeInZone: [],
    session: { startTime: iso(0), totalElapsedTime: end },
    lengths: [],
    events: [],
  });
  return row.id;
}

const TEMPO = {
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "absolute", low: 140, high: 149 }, cadence: { low: 85, high: 95 } },
    { type: "cooldown", end: { type: "time", seconds: 300 } },
  ],
};
const SECONDS = [600, 900, 300];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC", role: "admin" })).id;
  other = (await createUser({ enduranceEnabled: true, timeZone: "UTC", role: "admin" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "ftp", value: 200, measuredOn: TODAY, source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: TODAY, source: "manual" },
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: TODAY, source: "manual" },
  ]);
  asUser(me, "admin");
});
afterEach(() => vi.useRealTimers());

describe("an app ride", () => {
  /** A finished ride of TEMPO, each step saved by the clock. */
  async function finishedRide() {
    const bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
    const { program, slots } = await createStepProgram(me, bike, TEMPO);
    const session = await createSession(me, program.id, { date: TODAY, startTime: T0 });
    const v = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: `start-${Math.random()}` }));
    vi.setSystemTime(at(1800 + 5));
    expect(ok(await getRide({ rideId: v.ride.id }))!.ride.status).toBe("finished");
    for (const [i, id] of slots[0].setIds.entries()) {
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
    return session.id;
  }

  it("judges each step from the Garmin fill and names the activity and the split", async () => {
    const sessionId = await finishedRide();
    // Before Garmin: the app's own numbers, times only.
    const before = await workoutSessionCheck(me, sessionId);
    expect(before?.parts).toHaveLength(1);
    expect(before?.parts[0].match).toEqual({ kind: "app" });
    expect(before?.parts[0].steps.map((s) => [s.title, s.time.value, s.time.mark])).toEqual([
      ["Warm-up", "10:00", "in"],
      ["Work", "15:00", "in"],
      ["Cool-down", "5:00", "in"],
    ]);

    await storeActivity({
      userId: me,
      id: 71,
      typeKey: "indoor_cycling",
      name: "Indoor Cycling",
      laps: true,
      windows: [
        { seconds: 600, power: 110, hr: 120, cadence: 90 },
        { seconds: 900, power: 156, hr: 145, cadence: 80 },
        { seconds: 300, power: 90, hr: 125, cadence: 88 },
      ],
    });
    expect(await fillRidesFromGarmin(me)).toBe(1);
    const view = await workoutSessionCheck(me, sessionId);
    expect(view?.title).toBe(`${(await db.query.programs.findFirst({ where: (p, { eq: e }) => e(p.userId, me) }))!.name} · Tue 17 Nov`);
    const part = view!.parts[0];
    expect(part.match).toEqual({ kind: "garmin", name: "Indoor Cycling", split: "laps", watchOnly: false });
    expect(part.steps[1].rows.map((r) => [r.label, r.value, r.plan, r.mark])).toEqual([
      ["Power", "156 W", "140-149", "over"],
      ["Cadence", "80 rpm", "85-95", "under"],
    ]);
    expect(part.steps[0].rows).toEqual([]);
    expect(await hasSessionCheck(me, sessionId)).toBe(true);
  });

  it("another user reads nothing of it", async () => {
    const sessionId = await finishedRide();
    expect(await workoutSessionCheck(other, sessionId)).toBeNull();
    expect(await hasSessionCheck(other, sessionId)).toBe(false);
  });
});

describe("a run done on the watch alone", () => {
  const RUN = {
    v: 2,
    sport: "run",
    name: "Steady run",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 600 } },
      { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "hr", anchor: "lthr", zone: 2 }, cadence: { low: 160, high: 170 } },
      { type: "cooldown", end: { type: "time", seconds: 300 } },
    ],
  };

  /** Today's planned session of a weekday cycle that runs RUN; Garmin's run of today matches it. */
  async function plannedRun(laps: boolean) {
    const run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
    const { program } = await createStepProgram(me, run, RUN);
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 2, status: "active", startDate: "2026-11-16" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, daySlot: 1, dayOfWeek: 2, programId: program.id });
    await getActiveCycleForUser();
    const [p] = await db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, c.id), eq(plannedSessions.date, TODAY), isNull(plannedSessions.deletedAt)));
    // Garmin's run cadence is per foot: 81 is 162 spm.
    const windows = laps
      ? [
          { seconds: 620, hr: 130, cadence: 78, speed: 2.5 },
          { seconds: 1180, hr: 150, cadence: 81, speed: 3 },
          { seconds: 300, hr: 128, cadence: 76, speed: 2.4 },
        ]
      : [{ seconds: 2100, hr: 150, cadence: 81, speed: 3 }];
    await storeActivity({ userId: me, id: laps ? 81 : 82, typeKey: "running", name: "Oslo Running", laps, windows });
    return p.id;
  }

  it("splits the activity by its laps when there is one lap per step, and judges each step", async () => {
    const id = await plannedRun(true);
    const view = await plannedSessionCheck(me, id);
    expect(view?.parts).toHaveLength(1);
    const part = view!.parts[0];
    expect(part.match).toEqual({ kind: "garmin", name: "Oslo Running", split: "laps", watchOnly: true });
    expect(part.steps.map((s) => [s.title, s.time.value])).toEqual([
      ["Warm-up", "10:20"],
      ["Steady", "19:40"],
      ["Cool-down", "5:00"],
    ]);
    expect(part.steps[1].rows.map((r) => [r.label, r.value, r.plan, r.mark])).toEqual([
      ["Heart rate", "150", "under 162", "in"],
      ["Cadence", "162 spm", "160-170", "in"],
    ]);
  });

  it("splits by the planned step times when the lap count differs", async () => {
    const id = await plannedRun(false);
    const part = (await plannedSessionCheck(me, id))!.parts[0];
    expect(part.match).toMatchObject({ split: "time", watchOnly: true });
    expect(part.steps.map((s) => s.time.value)).toEqual(["10:00", "20:00", "5:00"]);
  });

  it("another user reads nothing of it", async () => {
    const id = await plannedRun(true);
    expect(await plannedSessionCheck(other, id)).toBeNull();
  });
});
