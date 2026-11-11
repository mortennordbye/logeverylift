import { db } from "@/db";
import { garminActivities, garminConnections, garminDays, garminSyncRuns } from "@/db/schema";
import { connectGarmin, disconnectGarmin, getGarminMetrics } from "@/lib/actions/garmin";
import { collectUserData } from "@/lib/account-data";
import { forgetToken } from "@/lib/garmin/sync";
import { decryptSecret } from "@/lib/utils/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

const ENC_KEY = vi.hoisted(() => Buffer.alloc(32, 7).toString("base64"));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: { ...actual.env, GARMIN_KEY_ENCRYPTION_KEY: ENC_KEY } };
});

const API_KEY = "garmin-personal-api-key-for-tests-0123456789";

function jwt(expSeconds: number) {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ exp: expSeconds })}.sig`;
}

/** What the fake Garmin returns; tests change it between calls. */
let garmin: {
  keyOk: boolean;
  restingHr: number;
  failSleep: boolean;
  noHrv: boolean;
  activities: object[];
};
let fetchMock: ReturnType<typeof vi.fn>;

function today() {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  garmin = {
    keyOk: true,
    restingHr: 45,
    failSleep: false,
    noHrv: false,
    activities: [
      {
        activityId: 9001,
        startTimeLocal: `${today()} 07:00:00`,
        activityType: { typeKey: "indoor_cycling" },
        duration: 3600,
        distance: 25_000,
        averageHR: 134,
        activityTrainingLoad: 44,
        startLatitude: 59.9,
        startLongitude: 10.7,
      },
    ],
  };
  fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    if (url.pathname.endsWith("/personal-api-key/token")) {
      if (!garmin.keyOk || auth !== `ApiKey ${API_KEY}`) return new Response("", { status: 401 });
      return new Response(jwt(Math.floor(Date.now() / 1000) + 86_400));
    }
    if (!auth.startsWith("Bearer ")) return new Response("", { status: 401 });
    if (url.pathname.startsWith("/hrv-service/")) {
      // Garmin answers a range with no HRV data with 204 and no body.
      if (garmin.noHrv) return new Response(null, { status: 204 });
      return Response.json({ hrvSummaries: [{ calendarDate: today(), lastNightAvg: 80, weeklyAvg: 82, status: "BALANCED" }] });
    }
    if (url.pathname.startsWith("/sleep-service/")) {
      if (garmin.failSleep) return new Response("", { status: 500 });
      // Garmin sometimes returns a row without a date; it must be skipped.
      return Response.json([{ calendarDate: today(), sleepTimeSeconds: 28_000 }, { calendarDate: null }]);
    }
    if (url.pathname.startsWith("/usersummary-service/")) {
      return Response.json({ data: [{ calendarDate: today(), heartRate: { restingValue: garmin.restingHr } }] });
    }
    if (url.pathname.startsWith("/activitylist-service/")) return Response.json(garmin.activities);
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function connect(userId: string) {
  asUser(userId);
  forgetToken(userId);
  const result = await connectGarmin({ apiKey: API_KEY });
  if (!result.success) throw new Error(result.error);
  return result;
}

describe("connectGarmin", () => {
  it("stores the key encrypted and saves the first sync", async () => {
    const me = await createUser();
    const result = await connect(me.id);
    expect(result.data.syncError).toBeNull();

    const [conn] = await db.select().from(garminConnections).where(eq(garminConnections.userId, me.id));
    expect(conn.encryptedKey).not.toContain(API_KEY);
    expect(decryptSecret(conn.encryptedKey, ENC_KEY)).toBe(API_KEY);
    expect(conn.lastSyncedAt).not.toBeNull();

    const days = await db.select().from(garminDays).where(eq(garminDays.userId, me.id));
    expect(days.map((d) => d.kind).sort()).toEqual(["daily", "hrv", "sleep"]);

    const [activity] = await db.select().from(garminActivities).where(eq(garminActivities.userId, me.id));
    expect(activity.garminActivityId).toBe(9001);
    expect(activity.data).not.toHaveProperty("startLatitude");
    expect(activity.data).not.toHaveProperty("startLongitude");

    const [run] = await db.select().from(garminSyncRuns).where(eq(garminSyncRuns.userId, me.id));
    expect(run).toMatchObject({ status: "ok", counts: { hrv: 1, sleep: 1, daily: 1, activities: 1 }, error: null });
  });

  it("stores nothing when Garmin rejects the key", async () => {
    const me = await createUser();
    asUser(me.id);
    garmin.keyOk = false;
    const result = await connectGarmin({ apiKey: API_KEY });
    expect(result.success).toBe(false);
    expect(await db.select().from(garminConnections)).toEqual([]);
    expect(await db.select().from(garminDays)).toEqual([]);
  });
});

describe("getGarminMetrics", () => {
  it("updates stored days on refresh instead of adding rows", async () => {
    const me = await createUser();
    await connect(me.id);
    garmin.restingHr = 41;
    const result = await getGarminMetrics({ refresh: true });
    if (!result.success) throw new Error(result.error);

    const rows = await db.select().from(garminDays).where(eq(garminDays.userId, me.id));
    expect(rows).toHaveLength(3);
    expect(result.data.metrics.days.find((d) => d.date === today())?.restingHr).toBe(41);
    expect(result.data.runs).toHaveLength(2);
  });

  it("skips Garmin when the last sync is recent", async () => {
    const me = await createUser();
    await connect(me.id);
    const calls = fetchMock.mock.calls.length;
    const result = await getGarminMetrics({});
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("treats Garmin's empty 204 answer as no data, not a failure", async () => {
    const me = await createUser();
    await connect(me.id);
    garmin.noHrv = true;
    const result = await getGarminMetrics({ refresh: true });
    if (!result.success) throw new Error(result.error);
    expect(result.data.syncError).toBeNull();
    expect(result.data.runs[0]).toMatchObject({ status: "ok", counts: { hrv: 0, sleep: 1, daily: 1, activities: 1 } });
    // HRV saved by the first sync is still there.
    expect(result.data.metrics.days.find((d) => d.date === today())?.hrvLastNight).toBe(80);
  });

  it("records a failed sync and still returns stored data", async () => {
    const me = await createUser();
    await connect(me.id);
    garmin.failSleep = true;
    const result = await getGarminMetrics({ refresh: true });
    if (!result.success) throw new Error(result.error);
    expect(result.data.syncError).toBe("http_500:sleep");
    expect(result.data.metrics.days.find((d) => d.date === today())?.restingHr).toBe(45);
    expect(result.data.runs[0]).toMatchObject({ status: "error", error: "http_500:sleep" });
  });

  it("shows a user only their own data", async () => {
    const me = await createUser();
    const other = await createUser();
    await connect(me.id);
    asUser(other.id);
    const result = await getGarminMetrics({ refresh: true });
    if (!result.success) throw new Error(result.error);
    expect(result.data.connected).toBe(false);
    expect(result.data.metrics.activities).toEqual([]);
    expect(result.data.metrics.days.every((d) => d.restingHr === null)).toBe(true);
    expect(result.data.runs).toEqual([]);
  });
});

describe("disconnectGarmin", () => {
  it("keeps stored data unless asked to delete it", async () => {
    const me = await createUser();
    await connect(me.id);
    await disconnectGarmin({ deleteData: false });
    expect(await db.select().from(garminConnections)).toEqual([]);
    expect((await db.select().from(garminDays)).length).toBe(3);

    const kept = await getGarminMetrics({});
    if (!kept.success) throw new Error(kept.error);
    expect(kept.data.connected).toBe(false);
    expect(kept.data.metrics.activities).toHaveLength(1);

    await disconnectGarmin({ deleteData: true });
    expect(await db.select().from(garminDays)).toEqual([]);
    expect(await db.select().from(garminActivities)).toEqual([]);
    expect(await db.select().from(garminSyncRuns)).toEqual([]);
  });

  it("leaves another user's connection alone", async () => {
    const me = await createUser();
    const other = await createUser();
    await connect(other.id);
    asUser(me.id);
    await disconnectGarmin({ deleteData: true });
    expect(await db.select().from(garminConnections)).toHaveLength(1);
    expect((await db.select().from(garminDays)).length).toBe(3);
  });
});

describe("data export", () => {
  it("includes Garmin data but not the key", async () => {
    const me = await createUser();
    await connect(me.id);
    const data = await collectUserData(me.id);
    expect(data.garmin_connections).toHaveLength(1);
    expect(data.garmin_connections[0]).not.toHaveProperty("encryptedKey");
    expect(data.garmin_days).toHaveLength(3);
    expect(data.garmin_activities).toHaveLength(1);
    expect(data.garmin_sync_runs).toHaveLength(1);
  });
});
