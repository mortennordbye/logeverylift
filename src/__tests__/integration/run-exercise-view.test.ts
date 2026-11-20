/**
 * The run exercise screen's data (docs/plans/run-logger.md, step 2): the mode
 * a run opens in (R4) from the user's runs, and the run as the screen shows
 * it, with Resume while a run is live.
 */
import { db } from "@/db";
import { athleteThresholds, garminActivities, rides, users } from "@/db/schema";
import { startRide } from "@/lib/actions/rides";
import { defaultRunModeFor, runExerciseView } from "@/lib/run-exercise-view";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_RUN } from "@/__tests__/fixtures/base-run";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";
import { programSets } from "@/db/schema";

// Garmin access needs the key on the server (and a Premium account).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const T0 = new Date("2026-11-20T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
let me: string;
let run: number;
let n = 0;

async function runSlot(userId = me) {
  const { program, slots } = await createStepProgram(userId, run, BASE_RUN);
  return { programId: program.id, programExerciseId: slots[0].programExerciseId };
}

/** A finished run of the user on that exercise, started `daysAgo` days before T0. */
async function pastRun(programExerciseId: number, mode: "indoor" | "outdoor", daysAgo: number, sport: "run" | "bike" = "run") {
  const { programId } = await runSlot();
  const session = await createSession(me, programId);
  const startedAt = new Date(T0.getTime() - daysAgo * DAY);
  await db.insert(rides).values({ userId: me, sessionId: session.id, programExerciseId, sport, mode, status: "finished", plan: { v: 2, sport, mode, name: "x", thresholds: {}, steps: [] }, seq: 1, startedAt, endedAt: startedAt });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true })).id;
  await db.update(users).set({ timeZone: "Europe/Oslo" }).where(eq(users.id, me));
  run = (await createExercise({ name: `Run ${++n} ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  asUser(me);
});

afterEach(() => vi.useRealTimers());

describe("defaultRunModeFor (R4)", () => {
  it("with no runs: the month, a treadmill in November", async () => {
    const { programExerciseId } = await runSlot();
    expect(await defaultRunModeFor(me, programExerciseId)).toBe("indoor");
  });

  it("takes the mode of most runs in the last 4 weeks, leaving out rides and older runs", async () => {
    const { programExerciseId } = await runSlot();
    const other = await runSlot();
    await pastRun(other.programExerciseId, "outdoor", 3);
    await pastRun(other.programExerciseId, "outdoor", 10);
    await pastRun(other.programExerciseId, "indoor", 40);
    await pastRun(other.programExerciseId, "indoor", 41);
    await pastRun(other.programExerciseId, "indoor", 42);
    await pastRun(other.programExerciseId, "indoor", 2, "bike");
    expect(await defaultRunModeFor(me, programExerciseId)).toBe("outdoor");
  });

  it("the last run of this exercise wins over the rest", async () => {
    const { programExerciseId } = await runSlot();
    const other = await runSlot();
    await pastRun(other.programExerciseId, "outdoor", 1);
    await pastRun(other.programExerciseId, "outdoor", 2);
    await pastRun(programExerciseId, "indoor", 60);
    expect(await defaultRunModeFor(me, programExerciseId)).toBe("indoor");
  });
});

describe("defaultRunModeFor from Garmin (R4)", () => {
  /** A Garmin activity of the user, `daysAgo` days before T0. */
  const activity = (id: number, type: string, daysAgo: number) =>
    db.insert(garminActivities).values({ userId: me, garminActivityId: id, startTimeLocal: new Date(T0.getTime() - daysAgo * DAY), activityType: type, data: {} });

  it("with no app runs, a user with Garmin gets the mode of most Garmin runs in 4 weeks; rides and older runs do not count", async () => {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, me));
    const { programExerciseId } = await runSlot();
    await activity(9000 + n * 10 + 1, "running", 2);
    await activity(9000 + n * 10 + 2, "trail_running", 9);
    await activity(9000 + n * 10 + 3, "treadmill_running", 5);
    await activity(9000 + n * 10 + 4, "indoor_cycling", 1);
    await activity(9000 + n * 10 + 5, "indoor_cycling", 3);
    await activity(9000 + n * 10 + 6, "treadmill_running", 40);
    await activity(9000 + n * 10 + 7, "treadmill_running", 45);
    // November: the month alone says treadmill.
    expect(await defaultRunModeFor(me, programExerciseId)).toBe("outdoor");
  });

  it("a user without Garmin access keeps the month", async () => {
    const { programExerciseId } = await runSlot();
    await activity(9000 + n * 10 + 8, "running", 2);
    expect(await defaultRunModeFor(me, programExerciseId)).toBe("indoor");
  });
});

describe("startRide on the run screen", () => {
  it("names the running session by its sport", async () => {
    const a = await runSlot();
    const b = await runSlot();
    const [sa, sb] = [await createSession(me, a.programId), await createSession(me, b.programId)];
    expect((await startRide({ sessionId: sa.id, programExerciseId: a.programExerciseId, mode: "indoor", clientId: "r1" })).success).toBe(true);
    const second = await startRide({ sessionId: sb.id, programExerciseId: b.programExerciseId, mode: "indoor", clientId: "r2" });
    expect(second).toMatchObject({ success: false, error: "A run is already running" });
  });
});

describe("runExerciseView", () => {
  it("builds the run in each mode from the thresholds, and offers Resume once the run starts", async () => {
    await db.insert(athleteThresholds).values([
      { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
      { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
    ]);
    const { programId, programExerciseId } = await runSlot();
    const sets = await db.select().from(programSets).where(eq(programSets.programExerciseId, programExerciseId));
    const view = (await runExerciseView(me, programExerciseId, "Run", sets))!;
    expect(view).toMatchObject({ defaultMode: "indoor", lthr: 180, liveRun: false, otherLive: null, paceSteps: false });
    expect(view.thresholdPace).toBeCloseTo(1000 / 339, 5);
    expect(view.treadmill.rows.map((r) => r.detail)).toEqual(["Belt 7.5 km/h · incline 1%", "HR under 160 · start 8.2 km/h", "30 s · 13.0 km/h · 1:30 easy between", "Walk 5.5 km/h"]);
    expect(view.road.rows[0].detail).toBe("HR under 151");

    const session = await createSession(me, programId);
    const started = await startRide({ sessionId: session.id, programExerciseId, mode: "outdoor", clientId: "c1" });
    expect(started.success).toBe(true);
    const live = (await runExerciseView(me, programExerciseId, "Run", sets))!;
    expect(live.liveRun).toBe(true);
    // Its mode is the default next time (R4).
    expect(live.defaultMode).toBe("outdoor");

    // Another run exercise sees the live run as another session, with the way back to it.
    const other = await runSlot();
    const otherSets = await db.select().from(programSets).where(eq(programSets.programExerciseId, other.programExerciseId));
    const elsewhere = (await runExerciseView(me, other.programExerciseId, "Run", otherSets))!;
    expect(elsewhere.liveRun).toBe(false);
    expect(elsewhere.otherLive).toEqual({ sport: "run", href: `/programs/${programId}/workout/exercises/${programExerciseId}?ride=1` });
  });

  it("null for a run of plain sets: the set list stays", async () => {
    expect(await runExerciseView(me, 1, "Run", [])).toBeNull();
  });
});
