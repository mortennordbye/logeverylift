import { RENDERERS } from "@/components/features/home/widgets";
import { loadFriendsActivity } from "@/components/features/home/widgets/friends-activity/load";
import { loadGarminReadiness } from "@/components/features/home/widgets/garmin-readiness/load";
import { loadRecentPrs } from "@/components/features/home/widgets/recent-prs/load";
import { db } from "@/db";
import { exercisePrs, friendships, garminConnections, garminDailyMetrics } from "@/db/schema";
import { WIDGETS } from "@/lib/home/widgets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createUser } from "./factories";
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
