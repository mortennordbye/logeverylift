import { db } from "@/db";
import { athleteProfiles, athleteThresholds, garminConnections, garminDays, planRevisions, users } from "@/db/schema";
import { saveProfile } from "@/lib/actions/athlete-profile";
import { takeGarminField } from "@/lib/actions/garmin";
import { undoPlanChangeSet } from "@/lib/actions/plan-revisions";
import { setTimeZone } from "@/lib/actions/user-settings";
import { addThreshold, changeThreshold, saveAthleteProfile } from "@/lib/athlete-profile";
import { syncFromGarmin } from "@/lib/garmin/sync-from-garmin";
import { THRESHOLDS_PER_KIND_MAX } from "@/lib/plan-revisions";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** "Sync from Garmin" (docs/plans/account-profile.md, 6 and 7), against a real database. */

const garmin = vi.hoisted(() => ({ ftp: 262, onRead: null as null | (() => Promise<void>) }));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: { ...actual.env, GARMIN_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } };
});
vi.mock("@/lib/garmin/queries", () => ({
  getTrendsData: async () => {
    await garmin.onRead?.();
    return { acts: [{ id: 1, day: "2026-11-10", sport: "bike", watchMaxHr: 191 }] };
  },
}));
vi.mock("@/lib/garmin/analytics/trends", async (orig) => ({
  ...(await orig<typeof import("@/lib/garmin/analytics/trends")>()),
  thresholdHistory: () => [{ weekStart: "2026-11-09", ftp: garmin.ftp, cp: null, cs: null, lthrRun: 171, lthrBike: null, watchLthr: null }],
}));

beforeEach(() => {
  garmin.ftp = 262;
  garmin.onRead = null;
});

const PROFILE = {
  availableTrainingDays: ["MONDAY", "WEDNESDAY", "SATURDAY"],
  preferredLongTrainingDays: ["SATURDAY"],
  measurementSystem: "statute_us",
  timeZone: "America/New_York",
};

async function garminUser({ syncOn = true, role = "admin" as "admin" | "user", profile = PROFILE as Record<string, unknown> } = {}) {
  const user = await createUser({ role, enduranceEnabled: true, timeZone: "UTC" });
  await db.insert(garminConnections).values({ userId: user.id, encryptedKey: "v1.x.y.z", syncFromGarmin: syncOn });
  await db.insert(garminDays).values({ userId: user.id, calendarDate: "2026-11-14", kind: "profile", data: profile });
  return user;
}

const me = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const sourceBy = (u: { fieldSources: Record<string, { by: string } | undefined> }) => Object.fromEntries(Object.entries(u.fieldSources).map(([k, v]) => [k, v?.by]));
const athlete = async (id: string) => (await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, id)))[0];
const thresholds = (id: string) =>
  db
    .select({ kind: athleteThresholds.kind, value: athleteThresholds.value, source: athleteThresholds.source })
    .from(athleteThresholds)
    .where(and(eq(athleteThresholds.userId, id)))
    .orderBy(asc(athleteThresholds.id));
const live = async (id: string) => (await db.select().from(athleteThresholds).where(eq(athleteThresholds.userId, id))).filter((t) => !t.deletedAt);

describe("syncFromGarmin", () => {
  it("fills availability, time zone, units and thresholds from Garmin, as the sync writer", async () => {
    const user = await garminUser();
    await syncFromGarmin(user.id);

    expect(await athlete(user.id)).toMatchObject({ availableDays: [1, 3, 6], longDay: 6 });
    const u = await me(user.id);
    expect(u).toMatchObject({ timeZone: "America/New_York", distanceUnit: "mi", swimUnit: "yd" });
    expect(sourceBy(u)).toEqual({ availability: "garmin", timeZone: "garmin", units: "garmin" });
    expect(await thresholds(user.id)).toEqual([
      { kind: "ftp", value: 262, source: "garmin" },
      { kind: "lthr_run", value: 171, source: "garmin" },
      { kind: "max_hr", value: 191, source: "garmin" },
    ]);
    const writers = await db.select({ writer: planRevisions.writer }).from(planRevisions).where(eq(planRevisions.userId, user.id));
    expect(new Set(writers.map((w) => w.writer))).toEqual(new Set(["sync"]));

    await syncFromGarmin(user.id);
    expect(await thresholds(user.id)).toHaveLength(3);
  });

  it("does nothing while the switch is off, or for a user without Premium", async () => {
    for (const user of [await garminUser({ syncOn: false }), await garminUser({ role: "user" })]) {
      await syncFromGarmin(user.id);
      expect(await thresholds(user.id)).toEqual([]);
      expect((await me(user.id)).timeZone).toBe("UTC");
    }
  });

  it("without a long day from Garmin keeps the stored one and writes the days only", async () => {
    const user = await garminUser({ profile: { ...PROFILE, preferredLongTrainingDays: null } });
    await db.insert(athleteProfiles).values({ userId: user.id, availableDays: [2], longDay: 7 });
    await syncFromGarmin(user.id);
    expect(await athlete(user.id)).toMatchObject({ availableDays: [1, 3, 6], longDay: 7 });
  });

  it("leaves a typed or tested threshold alone", async () => {
    const user = await garminUser();
    await addThreshold({ userId: user.id, writer: "user" }, { kind: "ftp", value: 240, source: "manual" });
    await syncFromGarmin(user.id);
    expect((await thresholds(user.id)).filter((t) => t.kind === "ftp")).toEqual([{ kind: "ftp", value: 240, source: "manual" }]);
  });

  it("does not overwrite a value the user saved while the sync was reading Garmin", async () => {
    const user = await garminUser();
    // The user saves FTP after the sync read the stored rows, before it writes.
    garmin.onRead = async () => {
      garmin.onRead = null;
      await addThreshold({ userId: user.id, writer: "user" }, { kind: "ftp", value: 240, source: "manual" });
    };
    await syncFromGarmin(user.id);
    expect((await live(user.id)).filter((t) => t.kind === "ftp").map((t) => [t.value, t.source])).toEqual([[240, "manual"]]);
  });

  it("does not add back a Garmin value the user deleted", async () => {
    const user = await garminUser();
    await syncFromGarmin(user.id);
    const [ftp] = (await live(user.id)).filter((t) => t.kind === "ftp");
    await changeThreshold({ userId: user.id, writer: "user" }, ftp.id, "delete");
    await syncFromGarmin(user.id);
    expect((await live(user.id)).filter((t) => t.kind === "ftp")).toEqual([]);
  });

  it("updates today's Garmin row for a new estimate instead of adding one", async () => {
    const user = await garminUser();
    await syncFromGarmin(user.id);
    garmin.ftp = 270;
    await syncFromGarmin(user.id);
    expect((await thresholds(user.id)).filter((t) => t.kind === "ftp")).toEqual([{ kind: "ftp", value: 270, source: "garmin" }]);
  });

  it("a kind at its row limit reuses its oldest Garmin row instead of failing", async () => {
    const user = await garminUser();
    const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    await db.insert(athleteThresholds).values(
      Array.from({ length: THRESHOLDS_PER_KIND_MAX }, (_, i) => ({ userId: user.id, kind: "ftp" as const, value: 200, measuredOn: day(i), source: "garmin" as const })),
    );
    const [oldest] = (await live(user.id)).filter((t) => t.measuredOn === day(0));
    await syncFromGarmin(user.id);
    const ftp = (await live(user.id)).filter((t) => t.kind === "ftp");
    expect(ftp).toHaveLength(THRESHOLDS_PER_KIND_MAX);
    const [reused] = ftp.filter((t) => t.id === oldest.id);
    expect(reused.value).toBe(262);
    expect(reused.measuredOn).not.toBe(day(0));
    expect((await live(user.id)).map((t) => t.kind).filter((k) => k !== "ftp").sort()).toEqual(["lthr_run", "max_hr"]);
  });

  it("never writes over a value the user changes while the sync runs", async () => {
    const user = await garminUser();
    await syncFromGarmin(user.id);
    const [ftp] = (await live(user.id)).filter((t) => t.kind === "ftp");
    garmin.ftp = 270;
    let sync: Promise<void> | null = null;
    // The user's change holds the row; the sync starts and has to wait for it.
    await db.transaction(async (tx) => {
      await tx.update(athleteThresholds).set({ source: "manual", value: 240 }).where(eq(athleteThresholds.id, ftp.id));
      sync = syncFromGarmin(user.id);
      await expect
        .poll(async () => (await db.execute(sql`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`)).rows[0].n, { timeout: 10_000 })
        .toBeGreaterThan(0);
    });
    await sync;
    const [after] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, ftp.id));
    expect([after.source, after.value]).toEqual(["manual", 240]);
  });

  it("a save that keeps the days and long day does not lock availability", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");
    await db.insert(athleteProfiles).values({ userId: user.id, availableDays: [1, 3, 6], longDay: 6, hoursPerWeek: 8 });
    expect((await saveProfile({ availableDays: [1, 3, 6], longDay: 6, hoursPerWeek: 10, longestDayMinutes: 180 })).success).toBe(true);
    expect(sourceBy(await me(user.id)).availability).toBeUndefined();
    expect((await saveProfile({ availableDays: [2, 4], longDay: 4, hoursPerWeek: 10, longestDayMinutes: 180 })).success).toBe(true);
    expect(sourceBy(await me(user.id)).availability).toBe("you");
  });

  it("Use on availability needs endurance, and clears the lock with the write", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");
    expect((await saveProfile({ availableDays: [2, 4], longDay: 4 })).success).toBe(true);
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, user.id));
    expect((await takeGarminField({ field: "availability" })).success).toBe(false);
    expect(sourceBy(await me(user.id)).availability).toBe("you");

    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, user.id));
    expect((await takeGarminField({ field: "availability" })).success).toBe(true);
    expect(sourceBy(await me(user.id)).availability).toBe("garmin");
    expect(await athlete(user.id)).toMatchObject({ availableDays: [1, 3, 6], longDay: 6 });
  });

  it("an undo to a snapshot without a source sets it from the restored days", async () => {
    const user = await garminUser();
    await saveAthleteProfile({ userId: user.id, writer: "user" }, { availableDays: [2, 4] });
    await saveAthleteProfile({ userId: user.id, writer: "assistant", reason: "x", changeSetId: "mcp:old-snapshot" }, { availableDays: [1] });
    // Snapshots written before sources were kept have no availabilitySource.
    await db.execute(sql`UPDATE plan_revisions SET snapshot = snapshot - 'availabilitySource' WHERE user_id = ${user.id}`);
    await db.update(users).set({ fieldSources: { availability: { by: "garmin", on: "2026-11-01" } } }).where(eq(users.id, user.id));

    asUser(user.id, "admin");
    expect((await undoPlanChangeSet({ changeSetId: "mcp:old-snapshot" })).success).toBe(true);
    expect(await athlete(user.id)).toMatchObject({ availableDays: [2, 4] });
    expect(sourceBy(await me(user.id)).availability).toBe("you");
  });

  it("a field the user set is locked; Use takes Garmin's value and unlocks it", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");
    expect((await setTimeZone({ timeZone: "Europe/Oslo" })).success).toBe(true);
    expect((await saveProfile({ availableDays: [2, 4], longDay: 4 })).success).toBe(true);

    await syncFromGarmin(user.id);
    expect((await me(user.id)).timeZone).toBe("Europe/Oslo");
    expect(await athlete(user.id)).toMatchObject({ availableDays: [2, 4], longDay: 4 });
    expect(sourceBy(await me(user.id))).toEqual({ availability: "you", timeZone: "you", units: "garmin" });

    expect(await takeGarminField({ field: "timeZone" })).toEqual({ success: true, data: undefined });
    expect(await takeGarminField({ field: "availability" })).toEqual({ success: true, data: undefined });
    const u = await me(user.id);
    expect(u.timeZone).toBe("America/New_York");
    expect(sourceBy(u)).toEqual({ availability: "garmin", timeZone: "garmin", units: "garmin" });
    expect(await athlete(user.id)).toMatchObject({ availableDays: [1, 3, 6], longDay: 6 });
  });

  it("refuses Use for a user without Premium", async () => {
    const user = await garminUser();
    asUser(user.id, "user");
    expect((await takeGarminField({ field: "timeZone" })).success).toBe(false);
    expect((await me(user.id)).timeZone).toBe("UTC");
  });

  it("counts the assistant as the user, and an undo puts back the earlier source with the days", async () => {
    const user = await garminUser();
    await syncFromGarmin(user.id);
    expect(sourceBy(await me(user.id)).availability).toBe("garmin");

    const changeSetId = "mcp:set-availability";
    await saveAthleteProfile({ userId: user.id, writer: "assistant", reason: "x", changeSetId }, { availableDays: [2, 5] });
    expect(sourceBy(await me(user.id)).availability).toBe("you");

    asUser(user.id, "admin");
    const undone = await undoPlanChangeSet({ changeSetId });
    expect(undone.success).toBe(true);
    expect(await athlete(user.id)).toMatchObject({ availableDays: [1, 3, 6] });
    expect(sourceBy(await me(user.id)).availability).toBe("garmin");
  });
});
