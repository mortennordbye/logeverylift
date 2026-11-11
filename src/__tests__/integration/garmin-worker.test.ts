import { db } from "@/db";
import { garminActivities, garminActivityFiles, garminActivityMetrics, garminActivityStreams, garminConnections, garminDays, garminSyncRuns } from "@/db/schema";
import { garminPacing } from "@/lib/garmin/client";
import { addDays } from "@/lib/garmin/dates";
import { FIT_PARSER_VERSION } from "@/lib/garmin/fit";
import { ACTIVITY_MODEL_VERSION } from "@/lib/garmin/analytics/activity";
import { forgetToken } from "@/lib/garmin/sync";
import { HISTORY_DAYS_USER, runGarminWorkerTick } from "@/lib/garmin/worker";
import { encryptSecret } from "@/lib/utils/crypto";
import { and, eq, min } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFit, buildZip } from "../helpers/garmin-files";
import { createUser } from "./factories";

const ENC_KEY = vi.hoisted(() => Buffer.alloc(32, 9).toString("base64"));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: { ...actual.env, GARMIN_KEY_ENCRYPTION_KEY: ENC_KEY } };
});

const API_KEY = "garmin-personal-api-key-for-worker-tests-0123";
const today = new Date().toISOString().slice(0, 10);

/** The fake Garmin has data for this many days back from today, and one activity two days ago. */
let fake: { daysOfData: number; rateLimitHeartRate: boolean; fitStatus: number };
let calls: string[];

function jwt() {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ exp: Math.floor(Date.now() / 1000) + 86_400 })}.sig`;
}

function hasData(date: string) {
  return date > addDays(today, -fake.daysOfData) && date <= today;
}

const ACTIVITY_ID = 777;
const ACTIVITY_DAY = addDays(today, -2);

beforeEach(() => {
  garminPacing.gapMs = 0;
  fake = { daysOfData: 400, rateLimitHeartRate: false, fitStatus: 200 };
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const p = url.pathname;
      calls.push(p);
      if (p.endsWith("/personal-api-key/token")) return new Response(jwt());
      if (p.startsWith("/wellness-service/wellness/dailyHeartRate")) {
        // The body Garmin sent when the limit was hit for real.
        if (fake.rateLimitHeartRate) return Response.json({ count: 103, limit: 100, retryInSeconds: 27, rateLimitMetaData: 1 }, { status: 429 });
        const date = url.searchParams.get("date")!;
        return hasData(date) ? Response.json({ calendarDate: date, heartRateValues: [[1, 60]] }) : Response.json({ heartRateValues: null });
      }
      if (p.startsWith("/usersummary-service/v2/dailysummaries")) {
        const out = [];
        for (let d = url.searchParams.get("startDate")!; d <= url.searchParams.get("endDate")!; d = addDays(d, 1)) {
          if (hasData(d)) out.push({ calendarDate: d, heartRate: { restingValue: 45 } });
        }
        return Response.json({ data: out });
      }
      if (p.startsWith("/activitylist-service/")) {
        const s = url.searchParams.get("startDate")!;
        const e = url.searchParams.get("endDate")!;
        return Response.json(
          ACTIVITY_DAY >= s && ACTIVITY_DAY <= e
            ? [{ activityId: ACTIVITY_ID, startTimeLocal: `${ACTIVITY_DAY} 07:00:00`, activityType: { typeKey: "indoor_cycling" }, startLatitude: 59.9 }]
            : [],
        );
      }
      if (p === `/activity-service/activity/${ACTIVITY_ID}`) return Response.json({ activityId: ACTIVITY_ID, summaryDTO: { averageHR: 130 } });
      if (p === `/activity-service/activity/${ACTIVITY_ID}/workouts`) return Response.json([]);
      if (p === `/download-service/files/activity/${ACTIVITY_ID}`) {
        if (fake.fitStatus !== 200) return new Response("", { status: fake.fitStatus });
        return new Response(new Uint8Array(buildZip(`${ACTIVITY_ID}_ACTIVITY.fit`, buildFit())));
      }
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function connect(role: "user" | "admin" = "user") {
  const user = await createUser({ role });
  forgetToken(user.id);
  await db.insert(garminConnections).values({ userId: user.id, encryptedKey: encryptSecret(API_KEY, ENC_KEY), lastSyncedAt: new Date() });
  return user.id;
}

async function conn(userId: string) {
  const [c] = await db.select().from(garminConnections).where(eq(garminConnections.userId, userId));
  return c;
}

async function runUntilIdle(max = 200) {
  for (let i = 0; i < max; i++) {
    const r = await runGarminWorkerTick();
    if (r.status === "idle") return i;
  }
  throw new Error("worker never went idle");
}

describe("runGarminWorkerTick", () => {
  it("imports recent days, the activity's FIT file and one week of history in the first tick", async () => {
    const userId = await connect();
    const r = await runGarminWorkerTick();
    expect(r).toEqual({ status: "ran", userId, error: null });

    const c = await conn(userId);
    expect(c.historyCursor).toBe(addDays(today, -6));
    expect(c.recentDetailAt).not.toBeNull();
    expect(c.leaseUntil).toBeNull();

    const hr = await db.select().from(garminDays).where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "heart_rate")));
    expect(hr).toHaveLength(7);

    // The activity came in with the history chunk; its files come on the next tick.
    await runGarminWorkerTick();
    const [activity] = await db.select().from(garminActivities).where(eq(garminActivities.userId, userId));
    expect(activity.filesFetchedAt).not.toBeNull();
    expect(activity.filesError).toBeNull();
    expect(activity.detail).toMatchObject({ summaryDTO: { averageHR: 130 } });
    expect(activity.data).not.toHaveProperty("startLatitude");
    const [file] = await db.select().from(garminActivityFiles).where(eq(garminActivityFiles.userId, userId));
    expect(file.sizeBytes).toBeGreaterThan(0);
    const [stream] = await db.select().from(garminActivityStreams).where(eq(garminActivityStreams.userId, userId));
    expect((stream.streams as Record<string, unknown[]>).hr).toHaveLength(10);
    expect((stream.streams as Record<string, number[]>).lat[0]).toBeCloseTo(59.9, 5);
    expect(stream.sets).toHaveLength(2);
  });

  it("stops a normal user's history at 90 days", async () => {
    const userId = await connect("user");
    await runUntilIdle();
    const c = await conn(userId);
    const floor = addDays(today, -(HISTORY_DAYS_USER - 1));
    expect(c.historyDone).toBe(true);
    expect(c.historyCursor).toBe(floor);
    const [oldest] = await db.select({ d: min(garminDays.calendarDate) }).from(garminDays).where(eq(garminDays.userId, userId));
    expect(oldest.d).toBe(floor);
  });

  it("takes an admin back to the start of their data, then stops after a run of empty weeks", async () => {
    fake.daysOfData = 120;
    const userId = await connect("admin");
    await runUntilIdle();
    const c = await conn(userId);
    expect(c.historyDone).toBe(true);
    expect(c.historyEmptyChunks).toBe(8);
    const [oldest] = await db.select({ d: min(garminDays.calendarDate) }).from(garminDays).where(eq(garminDays.userId, userId));
    expect(oldest.d).toBe(addDays(today, -119));
  });

  it("goes idle once history is done, files are fetched and recent days are fresh", async () => {
    await connect();
    await runUntilIdle();
    const before = calls.length;
    expect(await runGarminWorkerTick()).toEqual({ status: "idle" });
    expect(calls.length).toBe(before);
  });

  it("wakes up for stored FIT files parsed by an older parser, re-parses them, then goes idle", async () => {
    const userId = await connect();
    await runUntilIdle();
    await db.update(garminActivityStreams).set({ parserVersion: 1 }).where(eq(garminActivityStreams.userId, userId));
    expect((await runGarminWorkerTick()).status).toBe("ran");
    const [s] = await db.select({ v: garminActivityStreams.parserVersion }).from(garminActivityStreams).where(eq(garminActivityStreams.userId, userId));
    expect(s.v).toBe(FIT_PARSER_VERSION);
    expect(await runGarminWorkerTick()).toEqual({ status: "idle" });
  });

  it("wakes up for activity metrics from an older model and recomputes them", async () => {
    const userId = await connect();
    await runUntilIdle();
    await db.update(garminActivityMetrics).set({ modelVersion: 1 }).where(eq(garminActivityMetrics.userId, userId));
    expect((await runGarminWorkerTick()).status).toBe("ran");
    const [m] = await db.select({ v: garminActivityMetrics.modelVersion }).from(garminActivityMetrics).where(eq(garminActivityMetrics.userId, userId));
    expect(m.v).toBe(ACTIVITY_MODEL_VERSION);
    expect(await runGarminWorkerTick()).toEqual({ status: "idle" });
  });

  it("marks a run cut off by a restart as interrupted once its lease has run out", async () => {
    const userId = await connect();
    const old = new Date(Date.now() - 10 * 60_000);
    await db.insert(garminSyncRuns).values({ userId, trigger: "worker", status: "running", rangeStart: today, rangeEnd: today, startedAt: old });
    const fresh = new Date(Date.now() - 60_000);
    await db.insert(garminSyncRuns).values({ userId, trigger: "sync", status: "running", rangeStart: today, rangeEnd: today, startedAt: fresh });
    await runGarminWorkerTick();
    const runs = await db.select().from(garminSyncRuns).where(eq(garminSyncRuns.userId, userId));
    expect(runs.find((r) => r.startedAt.getTime() === old.getTime())).toMatchObject({ status: "error", error: "interrupted" });
    expect(runs.find((r) => r.startedAt.getTime() === fresh.getTime())).toMatchObject({ status: "running" });
  });

  it("pulls the recent summaries when the last sync is over 30 minutes old, and not before", async () => {
    const userId = await connect();
    await runGarminWorkerTick();
    const syncRuns = async () => (await db.select().from(garminSyncRuns).where(eq(garminSyncRuns.userId, userId))).filter((r) => r.trigger === "sync").length;
    expect(await syncRuns()).toBe(0);
    await db.update(garminConnections).set({ lastSyncedAt: new Date(Date.now() - 31 * 60_000), historyDone: false }).where(eq(garminConnections.userId, userId));
    await runGarminWorkerTick();
    expect(await syncRuns()).toBe(1);
  });

  it("lets only one of two simultaneous ticks work on a user", async () => {
    await connect();
    const results = await Promise.all([runGarminWorkerTick(), runGarminWorkerTick()]);
    expect(results.map((r) => r.status).sort()).toEqual(["idle", "ran"]);
  });

  it("pauses a user when Garmin says slow down, without moving the history cursor", async () => {
    fake.rateLimitHeartRate = true;
    const userId = await connect();
    const r = await runGarminWorkerTick();
    expect(r).toMatchObject({ status: "ran", error: "rate_limited:heart_rate" });
    const c = await conn(userId);
    // Garmin's retryInSeconds (27) plus a 5 s margin.
    const pause = c.pausedUntil!.getTime() - Date.now();
    expect(pause).toBeGreaterThan(25_000);
    expect(pause).toBeLessThan(33_000);
    expect(c.historyCursor).toBeNull();
    expect(await runGarminWorkerTick()).toEqual({ status: "idle" });
    const [run] = await db.select().from(garminSyncRuns).where(eq(garminSyncRuns.userId, userId));
    expect(run).toMatchObject({ trigger: "worker", status: "error", error: "rate_limited:heart_rate" });
  });

  it("marks an activity whose file can't be downloaded and doesn't retry it", async () => {
    fake.fitStatus = 404;
    const userId = await connect();
    await runGarminWorkerTick();
    await runGarminWorkerTick();
    const [activity] = await db.select().from(garminActivities).where(eq(garminActivities.userId, userId));
    expect(activity.filesError).toBe("http_404:fit");
    const downloads = calls.filter((p) => p.startsWith("/download-service/")).length;
    await runUntilIdle();
    expect(calls.filter((p) => p.startsWith("/download-service/")).length).toBe(downloads);
    expect(await db.select().from(garminActivityFiles)).toEqual([]);
  });

  it("imports two users separately, each into their own rows", async () => {
    const a = await connect();
    const b = await connect();
    await runUntilIdle();
    for (const id of [a, b]) {
      expect((await conn(id)).historyDone).toBe(true);
      expect(await db.select().from(garminActivities).where(eq(garminActivities.userId, id))).toHaveLength(1);
      expect(await db.select().from(garminActivityStreams).where(eq(garminActivityStreams.userId, id))).toHaveLength(1);
    }
  });
});
