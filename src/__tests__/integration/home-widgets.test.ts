import { RENDERERS } from "@/components/features/home/widgets";
import { loadFriendsActivity } from "@/components/features/home/widgets/friends-activity/load";
import { loadGarminReadiness } from "@/components/features/home/widgets/garmin-readiness/load";
import { loadBodyWeight } from "@/components/features/home/widgets/body-weight/load";
import { loadRaceCountdown } from "@/components/features/home/widgets/race-countdown/load";
import { loadRecentPrs } from "@/components/features/home/widgets/recent-prs/load";
import { loadStreak } from "@/components/features/home/widgets/streak/load";
import { loadTrainingLoad } from "@/components/features/home/widgets/training-load/load";
import { loadWeeklySets } from "@/components/features/home/widgets/weekly-sets/load";
import { db } from "@/db";
import { exercisePrs, friendships, garminConnections, garminDailyMetrics, seasonRaces, seasons, userWeightEntries, workoutSets } from "@/db/schema";
import { readTodayPlan } from "@/lib/home/core";
import { WIDGETS } from "@/lib/home/widgets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The streamed home widgets' loaders against a real database
 * (docs/home-widgets-audit.md, section 7, I2 and U4): another person's data
 * reaches the friends widget only through the filtered action and in the
 * narrow shape, and Garmin stays with admin accounts.
 */

const env = vi.hoisted(() => ({ GARMIN_KEY_ENCRYPTION_KEY: "k" as string | undefined }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? env.GARMIN_KEY_ENCRYPTION_KEY : Reflect.get(t, k)) }) };
});

let me: string;
const today = new Date().toISOString().slice(0, 10);
const ctx = (role = "user") => ({ userId: me, role, today });

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
});

describe("registry (U4)", () => {
  it("every widget has a renderer; streamed ones load, core ones select", () => {
    for (const [id, def] of Object.entries(WIDGETS)) {
      const r = RENDERERS[id as keyof typeof RENDERERS];
      if (def.source === "stream") expect(typeof r.load, id).toBe("function");
      else expect(typeof r.select, id).toBe("function");
    }
  });
});

describe("Friends' activity loader (I2)", () => {
  it("shows friends who share their activity, never one who hides it or a stranger, in exactly the narrow shape", async () => {
    const shown = await createUser({ name: "Shown" });
    const hidden = await createUser({ name: "Hidden", showActivityToFriends: false });
    const stranger = await createUser({ name: "Stranger" });
    await db.insert(friendships).values([
      { requesterId: me, addresseeId: shown.id, status: "accepted" },
      { requesterId: hidden.id, addresseeId: me, status: "accepted" },
    ]);
    for (const u of [shown, hidden, stranger]) await createSession(u.id, null, { isCompleted: true, feeling: "Awesome" });

    const rows = await loadFriendsActivity(ctx());
    expect(rows!.map((r) => r.name)).toEqual(["Shown"]);
    for (const r of rows!) expect(Object.keys(r).sort()).toEqual(["date", "image", "name", "programName", "sessionId", "setCount"]);
  });

  it("null without friends (the empty state)", async () => {
    expect(await loadFriendsActivity(ctx())).toBeNull();
  });
});

describe("Recent PRs loader", () => {
  it("returns only the caller's PRs, formatted, newest first", async () => {
    const other = await createUser();
    const lift = await createExercise({ name: "Bench" });
    const mine = await createSession(me, null, { isCompleted: true });
    const theirs = await createSession(other.id, null, { isCompleted: true });
    await db.insert(exercisePrs).values([
      { userId: me, exerciseId: lift.id, sessionId: mine.id, prType: "weight", value: "100", achievedAt: new Date("2026-11-10T10:00:00Z") },
      { userId: me, exerciseId: lift.id, sessionId: mine.id, prType: "weight", value: "105", achievedAt: new Date("2026-11-12T10:00:00Z") },
      { userId: other.id, exerciseId: lift.id, sessionId: theirs.id, prType: "weight", value: "200", achievedAt: new Date("2026-11-12T11:00:00Z") },
    ]);
    const rows = await loadRecentPrs(ctx());
    expect(rows!.map((r) => [r.value, r.date])).toEqual([
      ["105 kg", "12 Nov"],
      ["100 kg", "10 Nov"],
    ]);
  });
});

describe("Garmin readiness loader (I2)", () => {
  const readiness = { score: 70, band: "as_planned", signals: 4, capped: false, contributors: [] };

  it("returns null for a non-admin, even with data", async () => {
    await db.insert(garminConnections).values({ userId: me, encryptedKey: "v1.x.y.z" });
    await db.insert(garminDailyMetrics).values({ userId: me, day: today, modelVersion: 3, metrics: { readiness } });
    expect(await loadGarminReadiness(ctx("user"))).toBeNull();
  });

  it("returns null for an admin when Garmin is off (no key)", async () => {
    env.GARMIN_KEY_ENCRYPTION_KEY = undefined;
    expect(await loadGarminReadiness(ctx("admin"))).toBeNull();
    env.GARMIN_KEY_ENCRYPTION_KEY = "k";
  });

  it("an admin without a connection gets Connect Garmin; with one, today's score", async () => {
    expect(await loadGarminReadiness(ctx("admin"))).toEqual({ connected: false });
    await db.insert(garminConnections).values({ userId: me, encryptedKey: "v1.x.y.z" });
    expect(await loadGarminReadiness(ctx("admin"))).toEqual({ connected: true, readiness: null });
    await db.insert(garminDailyMetrics).values({ userId: me, day: today, modelVersion: 3, metrics: { readiness } });
    expect(await loadGarminReadiness(ctx("admin"))).toEqual({ connected: true, readiness });
  });

  it("reads only the caller's row", async () => {
    const other = await createUser({ role: "admin" });
    await db.insert(garminConnections).values({ userId: me, encryptedKey: "v1.x.y.z" });
    await db.insert(garminDailyMetrics).values({ userId: other.id, day: today, modelVersion: 3, metrics: { readiness } });
    expect(await loadGarminReadiness(ctx("admin"))).toEqual({ connected: true, readiness: null });
  });
});

describe("phase 2 loaders read only the caller's data", () => {
  const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

  it("Body weight: the caller's entries only, latest and 30-day change; null without any", async () => {
    expect(await loadBodyWeight(ctx())).toBeNull();
    const other = await createUser();
    await db.insert(userWeightEntries).values([
      { id: "w1", userId: me, weightKg: 83.1, recordedAt: new Date(`${day(-10)}T08:00:00Z`) },
      { id: "w2", userId: me, weightKg: 82.4, recordedAt: new Date(`${today}T08:00:00Z`) },
      { id: "w3", userId: other.id, weightKg: 120, recordedAt: new Date(`${day(-1)}T08:00:00Z`) },
    ]);
    const w = await loadBodyWeight(ctx());
    expect(w).toEqual({ latestKg: 82.4, changeKg: -0.7, lowKg: 82.4, highKg: 83.1, series: [83.1, 82.4] });
  });

  it("Race countdown: the caller's next A race, not another user's, not a past one", async () => {
    const other = await createUser();
    const [mine] = await db.insert(seasons).values({ userId: me, name: "2026", startDate: day(-30), endDate: day(60) }).returning();
    const [theirs] = await db.insert(seasons).values({ userId: other.id, name: "Theirs", startDate: day(-30), endDate: day(60) }).returning();
    await db.insert(seasonRaces).values([
      { seasonId: theirs.id, userId: other.id, name: "Their race", raceDate: day(3), discipline: "run", priority: "A" },
      { seasonId: mine.id, userId: me, name: "Past race", raceDate: day(-2), discipline: "run", priority: "A" },
    ]);
    expect(await loadRaceCountdown(ctx())).toBeNull();
    await db.insert(seasonRaces).values({ seasonId: mine.id, userId: me, name: "Oslo Half", raceDate: day(22), discipline: "run", priority: "A" });
    expect(await loadRaceCountdown(ctx())).toMatchObject({ name: "Oslo Half", days: 22, seasonId: mine.id });
  });

  it("Weekly sets and Streak: only the caller's sessions count", async () => {
    expect(await loadWeeklySets(ctx())).toBeNull();
    expect(await loadStreak(ctx())).toBeNull();
    const other = await createUser();
    const lift = await createExercise({ name: "Bench", muscleGroup: "chest" });
    const theirs = await createSession(other.id, null, { isCompleted: true, endTime: new Date() });
    await db.insert(workoutSets).values({ sessionId: theirs.id, exerciseId: lift.id, setNumber: 1, actualReps: 5, weightKg: "100", restTimeSeconds: 90, isCompleted: true });
    expect(await loadWeeklySets(ctx())).toBeNull();
    expect(await loadStreak(ctx())).toBeNull();

    const mine = await createSession(me, null, { isCompleted: true, endTime: new Date() });
    await db.insert(workoutSets).values([1, 2, 3].map((n) => ({ sessionId: mine.id, exerciseId: lift.id, setNumber: n, actualReps: 5, weightKg: "100", restTimeSeconds: 90, isCompleted: true })));
    expect(await loadWeeklySets(ctx())).toEqual({ total: 3, muscles: [{ name: "chest", sets: 3, target: 10 }] });
    const streak = await loadStreak(ctx());
    expect(streak!.weeks).toBe(1);
    expect(streak!.perWeek.at(-1)).toBe(1);
  });

  it("Training load: null with no load in four weeks", async () => {
    expect(await loadTrainingLoad(ctx())).toBeNull();
  });
});

describe("Today's plan read (owner decision A)", () => {
  it("reads the caller's program in order; another user's program gives null", async () => {
    const bench = await createExercise({ name: "Bench" });
    const row = await createExercise({ name: "Row" });
    const { program } = await createProgram(me, [
      { exerciseId: bench.id, sets: [{}, {}, {}] },
      { exerciseId: row.id, sets: [{ weightKg: "70" }] },
    ]);
    expect(await readTodayPlan(me, program.id)).toMatchObject({
      exerciseCount: 2,
      setCount: 4,
      exercises: [
        { name: "Bench", sets: "3 × 8 · 80 kg" },
        { name: "Row", sets: "1 × 8 · 70 kg" },
      ],
      more: [],
    });
    const other = await createUser();
    expect(await readTodayPlan(other.id, program.id)).toBeNull();
  });
});
