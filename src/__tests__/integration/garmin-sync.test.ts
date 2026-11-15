import { db } from "@/db";
import { athleteProfiles, athleteThresholds, garminConnections, garminDays, planRevisions, users } from "@/db/schema";
import { saveProfile } from "@/lib/actions/athlete-profile";
import { takeGarminField } from "@/lib/actions/garmin";
import { setTimeZone } from "@/lib/actions/user-settings";
import { addThreshold } from "@/lib/athlete-profile";
import { fieldSyncView, syncFromGarmin } from "@/lib/garmin/sync-from-garmin";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** "Sync from Garmin" (docs/plans/account-profile.md, 6), against a real database. */

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: { ...actual.env, GARMIN_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } };
});
vi.mock("@/lib/garmin/queries", () => ({
  getTrendsData: async () => ({ acts: [{ id: 1, day: "2026-11-10", sport: "bike", watchMaxHr: 191 }] }),
}));
vi.mock("@/lib/garmin/analytics/trends", async (orig) => ({
  ...(await orig<typeof import("@/lib/garmin/analytics/trends")>()),
  thresholdHistory: () => [{ weekStart: "2026-11-09", ftp: 262, cp: null, cs: null, lthrRun: 171, lthrBike: null, watchLthr: null }],
}));

const PROFILE = {
  availableTrainingDays: ["MONDAY", "WEDNESDAY", "SATURDAY"],
  preferredLongTrainingDays: ["SATURDAY"],
  measurementSystem: "statute_us",
  timeZone: "America/New_York",
};

async function garminUser(syncOn = true) {
  const user = await createUser({ role: "admin", enduranceEnabled: true, timeZone: "UTC" });
  await db.insert(garminConnections).values({ userId: user.id, encryptedKey: "v1.x.y.z", syncFromGarmin: syncOn });
  await db.insert(garminDays).values({ userId: user.id, calendarDate: "2026-11-14", kind: "profile", data: PROFILE });
  return user;
}

const me = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const thresholds = (id: string) =>
  db.select({ kind: athleteThresholds.kind, value: athleteThresholds.value, source: athleteThresholds.source }).from(athleteThresholds).where(eq(athleteThresholds.userId, id)).orderBy(asc(athleteThresholds.id));

describe("syncFromGarmin", () => {
  it("fills availability, time zone, units and thresholds from Garmin, as the sync writer", async () => {
    const user = await garminUser();
    await syncFromGarmin(user.id);

    const [profile] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, user.id));
    expect(profile).toMatchObject({ availableDays: [1, 3, 6], longDay: 6 });
    const u = await me(user.id);
    expect(u).toMatchObject({ timeZone: "America/New_York", distanceUnit: "mi", swimUnit: "yd" });
    expect(Object.fromEntries(Object.entries(u.fieldSources).map(([k, v]) => [k, v?.by]))).toEqual({ availability: "garmin", timeZone: "garmin", units: "garmin" });
    expect(await thresholds(user.id)).toEqual([
      { kind: "ftp", value: 262, source: "garmin" },
      { kind: "lthr_run", value: 171, source: "garmin" },
      { kind: "max_hr", value: 191, source: "garmin" },
    ]);

    const writers = await db.select({ writer: planRevisions.writer }).from(planRevisions).where(eq(planRevisions.userId, user.id));
    expect(writers.length).toBeGreaterThan(0);
    expect(new Set(writers.map((w) => w.writer))).toEqual(new Set(["sync"]));

    // A second run finds nothing new.
    await syncFromGarmin(user.id);
    expect(await thresholds(user.id)).toHaveLength(3);
  });

  it("leaves a typed or tested threshold alone", async () => {
    const user = await garminUser();
    await addThreshold({ userId: user.id, writer: "user" }, { kind: "ftp", value: 240, source: "manual" });
    await syncFromGarmin(user.id);
    expect((await thresholds(user.id)).filter((t) => t.kind === "ftp")).toEqual([{ kind: "ftp", value: 240, source: "manual" }]);
  });

  it("does nothing while the switch is off", async () => {
    const user = await garminUser(false);
    await syncFromGarmin(user.id);
    expect(await thresholds(user.id)).toEqual([]);
    expect((await me(user.id)).timeZone).toBe("UTC");
  });

  it("a field the user set is locked; Use takes Garmin's value and unlocks it", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");
    expect((await setTimeZone({ timeZone: "Europe/Oslo" })).success).toBe(true);
    expect((await saveProfile({ availableDays: [2, 4], longDay: 4 })).success).toBe(true);

    await syncFromGarmin(user.id);
    expect((await me(user.id)).timeZone).toBe("Europe/Oslo");
    const [profile] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, user.id));
    expect(profile).toMatchObject({ availableDays: [2, 4], longDay: 4 });

    const view = await fieldSyncView(user.id);
    expect(view.timeZone?.says).toBe("America/New York");
    expect(view.timeZone?.note).toMatch(/^Set by you · /);
    expect(view.units?.note).toMatch(/^From Garmin · /);

    expect(await takeGarminField({ field: "timeZone" })).toEqual({ success: true, data: undefined });
    const u = await me(user.id);
    expect(u.timeZone).toBe("America/New_York");
    expect(u.fieldSources.timeZone?.by).toBe("garmin");
    expect((await fieldSyncView(user.id)).timeZone?.says).toBeNull();
  });

  it("refuses Use for a user without Premium", async () => {
    const user = await garminUser();
    asUser(user.id, "user");
    expect((await takeGarminField({ field: "timeZone" })).success).toBe(false);
    expect((await me(user.id)).timeZone).toBe("UTC");
  });
});
