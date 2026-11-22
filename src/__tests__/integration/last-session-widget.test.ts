/**
 * The "Last session" home widget's load (docs/plans/session-check.md,
 * decision 9), against a real database: the last day with done bike or run
 * sessions, one card per session in the day's order (a ride and a run on one
 * day are two), each judged over its work steps with its Garmin match; a user
 * reads only their own sessions.
 */
import { db } from "@/db";
import { garminActivities, garminActivityStreams, trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { loadLastSession } from "@/components/features/home/widgets/last-session/load";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

// Garmin is on for admins only when the key is set (src/lib/garmin/access.ts).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

/** A Tuesday; the cycle starts on the Monday before. */
const TODAY = "2026-11-17";
const MONDAY = "2026-11-16";

let me: string;
let other: string;
let activityId = 500;

const RIDE = {
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "absolute", low: 140, high: 149 } },
    { type: "cooldown", end: { type: "time", seconds: 300 } },
  ],
};
const RUN = {
  v: 2,
  sport: "run",
  name: "Run off bike",
  steps: [{ type: "work", end: { type: "time", seconds: 1200 }, cadence: { low: 155, high: 165 } }],
};

/** Garmin's activity of a day, 1 s samples with one lap per window. */
async function storeActivity(userId: string, day: string, hour: number, typeKey: string, name: string, windows: { seconds: number; power?: number; hr: number; cadence: number; speed?: number }[]) {
  const id = activityId++;
  const t0 = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const t: number[] = [];
  const power: number[] = [];
  const hr: number[] = [];
  const cadence: number[] = [];
  const distance: number[] = [];
  let meters = 0;
  for (const w of windows) {
    for (let k = 0; k < w.seconds; k++) {
      t.push(t.length);
      power.push(w.power ?? 0);
      hr.push(w.hr);
      cadence.push(w.cadence);
      meters += w.speed ?? 0;
      distance.push(meters);
    }
  }
  const end = t.length;
  const iso = (x: number) => new Date(t0.getTime() + x * 1000).toISOString();
  let from = 0;
  const laps = windows.map((w) => {
    const l = { startTime: iso(from), totalElapsedTime: w.seconds, totalTimerTime: w.seconds };
    from += w.seconds;
    return l;
  });
  await db.insert(garminActivities).values({
    userId,
    garminActivityId: id,
    startTimeLocal: t0,
    activityType: typeKey,
    data: { activityId: id, activityName: name, startTimeGMT: t0.toISOString().slice(0, 19).replace("T", " "), duration: end, elapsedDuration: end, distance: meters },
    filesFetchedAt: new Date(),
  });
  await db.insert(garminActivityStreams).values({
    userId,
    garminActivityId: id,
    parserVersion: 3,
    sport: typeKey === "running" ? "running" : "cycling",
    subSport: typeKey,
    streams: { t, power, hr, cadence, distance },
    laps,
    sets: [],
    timeInZone: [],
    session: { startTime: iso(0), totalElapsedTime: end },
    lengths: [],
    events: [],
  });
}

/** A weekday cycle from Monday: the ride on Monday, and on Tuesday the ride (slot 1) and the run (slot 2). */
async function weekdayCycle(userId: string) {
  asUser(userId, "admin");
  const bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  const run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  const ride = (await createStepProgram(userId, bike, RIDE)).program;
  const brick = (await createStepProgram(userId, run, RUN)).program;
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 2, status: "active", startDate: MONDAY }).returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: c.id, daySlot: 1, dayOfWeek: 1, programId: ride.id },
    { trainingCycleId: c.id, daySlot: 1, dayOfWeek: 2, programId: ride.id },
    { trainingCycleId: c.id, daySlot: 2, dayOfWeek: 2, programId: brick.id },
  ]);
  await getActiveCycleForUser();
  return { ride, brick };
}

const RIDE_WINDOWS = (power: number) => [
  { seconds: 600, power: 100, hr: 110, cadence: 85 },
  { seconds: 900, power, hr: 140, cadence: 88 },
  { seconds: 300, power: 90, hr: 115, cadence: 80 },
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T20:00:00Z`));
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC", role: "admin" })).id;
  other = (await createUser({ enduranceEnabled: true, timeZone: "UTC", role: "admin" })).id;
});
afterEach(() => vi.useRealTimers());

const ctx = (userId: string) => ({ userId, role: "admin", today: TODAY });

describe("loadLastSession", () => {
  it("shows the last day with a done ride or run, not an earlier one", async () => {
    const { ride } = await weekdayCycle(me);
    await storeActivity(me, MONDAY, 8, "indoor_cycling", "Monday Ride", RIDE_WINDOWS(145));
    asUser(me, "admin");
    const data = await loadLastSession(ctx(me));
    // Tuesday's sessions are not done (no activity yet), so Monday is the last day.
    expect(data?.cards.map((c) => c.title)).toEqual([`${ride.name} · Mon 16 Nov`]);
    const card = data!.cards[0];
    expect(card.match).toBe("Matched to Garmin · Monday Ride · 30 min");
    expect(card.rows[0]).toEqual({ label: "Power", value: "145 W", plan: "plan 140-149", mark: "in" });
    expect(card.time).toEqual({ label: "Time", value: "15:00", plan: "plan 15:00", mark: "in" });
    expect(card.href).toBe(`/planned/${card.plannedSessionId}/check`);
  });

  it("two sessions on one day are two cards, in the day's order", async () => {
    const { ride, brick } = await weekdayCycle(me);
    await storeActivity(me, MONDAY, 8, "indoor_cycling", "Monday Ride", RIDE_WINDOWS(145));
    await storeActivity(me, TODAY, 8, "indoor_cycling", "Indoor Cycling", RIDE_WINDOWS(160));
    // Garmin's run cadence is per foot: 76 is 152 spm.
    await storeActivity(me, TODAY, 9, "running", "Oslo Running", [{ seconds: 1200, hr: 148, cadence: 76, speed: 2.75 }]);
    asUser(me, "admin");
    const data = await loadLastSession(ctx(me));
    expect(data?.cards.map((c) => [c.title, c.match])).toEqual([
      [`${ride.name} · Tue 17 Nov`, "Matched to Garmin · Indoor Cycling · 30 min"],
      [`${brick.name} · Tue 17 Nov`, "Matched to Garmin · Oslo Running · 20 min · 3.3 km"],
    ]);
    expect(data!.cards[0].rows.map((r) => [r.label, r.value, r.mark])).toEqual([
      ["Power", "160 W", "over"],
      ["Heart rate", "140", "none"],
      ["Cadence", "88 rpm", "none"],
    ]);
    expect(data!.cards[1].rows.find((r) => r.label === "Cadence")).toEqual({ label: "Cadence", value: "152 spm", plan: "plan 155-165", mark: "under" });
  });

  it("reads only the user's own sessions", async () => {
    await weekdayCycle(me);
    await storeActivity(me, MONDAY, 8, "indoor_cycling", "Monday Ride", RIDE_WINDOWS(145));
    // The other user has a later done ride and run of their own.
    await weekdayCycle(other);
    await storeActivity(other, TODAY, 8, "indoor_cycling", "Their Ride", RIDE_WINDOWS(150));

    asUser(me, "admin");
    const mine = await loadLastSession(ctx(me));
    expect(mine?.cards.map((c) => c.match)).toEqual(["Matched to Garmin · Monday Ride · 30 min"]);

    asUser(other, "admin");
    const theirs = await loadLastSession(ctx(other));
    expect(theirs?.cards.map((c) => c.match)).toEqual(["Matched to Garmin · Their Ride · 30 min"]);
  });

  it("is null with no done ride or run in the last two weeks", async () => {
    await weekdayCycle(me);
    asUser(me, "admin");
    expect(await loadLastSession(ctx(me))).toBeNull();
  });

  it("is null when the endurance switch is off", async () => {
    await weekdayCycle(me);
    await storeActivity(me, MONDAY, 8, "indoor_cycling", "Monday Ride", RIDE_WINDOWS(145));
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    expect(await loadLastSession(ctx(me))).toBeNull();
  });
});
