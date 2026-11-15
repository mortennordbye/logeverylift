import { db } from "@/db";
import { athleteProfiles, athleteThresholds, garminActivityMetrics, garminDays, planRevisions } from "@/db/schema";
import { getBikeNumbersData, saveBikeHrZones, setFtpAutomatic } from "@/lib/actions/bike-numbers";
import { addThreshold } from "@/lib/athlete-profile";
import { getBikeNumbers } from "@/lib/bike-numbers";
import { addDays } from "@/lib/garmin/dates";
import { updateFtpEstimate } from "@/lib/garmin/ftp-estimate";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { dateLabel } from "@/lib/utils/date-label";
import { watchFtpNote } from "@/lib/utils/bike-numbers";
import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { APP_FTP, ESTIMATED_FTP, HR_ZONES_SNAPSHOT, WATCH_FTP } from "../fixtures/bike-sessions";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** The bike numbers against a real database (docs/plans/bike-sessions.md, section 3). */

let me: string;
let today: string;
let bestDay: string;

const none = { speed: {}, distance: {}, vo2: null, hr30: null, dynamics: [] };

async function ride(userId: string, id: number, day: string, power: Record<number, number>) {
  await db.insert(garminActivityMetrics).values({
    userId,
    garminActivityId: id,
    modelVersion: 1,
    sport: "bike",
    day,
    load: 60,
    loadMethod: "power",
    metrics: { efforts: { ...none, power }, thresholds: { maxHr: 201, restHr: 48, lthr: 171, ftp: WATCH_FTP, source: "fit" } },
  });
}

/** The owner's numbers: FTP 180 from Garmin yesterday, rides with 189 W for 20 min and 186 W for 60 min. */
async function seedOwner(userId: string) {
  await ride(userId, 1, addDays(today, -12), { 1200: 189, 3600: 159 });
  await ride(userId, 2, bestDay, { 1200: 188, 3600: 186 });
  await ride(userId, 3, addDays(today, -2), { 3600: 167 });
  await db.insert(garminDays).values({ userId, calendarDate: today, kind: "hr_zones", data: HR_ZONES_SNAPSHOT });
  await addThreshold({ userId, writer: "sync" }, { kind: "ftp", value: APP_FTP, measuredOn: addDays(today, -1), source: "garmin" });
}

const ftpRows = (userId: string) =>
  db
    .select()
    .from(athleteThresholds)
    .where(and(eq(athleteThresholds.userId, userId), eq(athleteThresholds.kind, "ftp")))
    .orderBy(desc(athleteThresholds.id));

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  today = toDateStr(await userToday(me));
  bestDay = addDays(today, -5);
});

describe("updateFtpEstimate", () => {
  it("writes the estimate once as a garmin threshold with a revision, and not again on a second run", async () => {
    await seedOwner(me);
    await updateFtpEstimate(me, new Date());
    await updateFtpEstimate(me, new Date());

    const rows = await ftpRows(me);
    expect(rows.map((r) => [r.value, r.source])).toEqual([
      [ESTIMATED_FTP, "garmin"],
      [APP_FTP, "garmin"],
    ]);
    expect(rows[0]).toMatchObject({ measuredOn: today, notes: `best 60 min on ${dateLabel(bestDay, "d MMM")}` });
    const revs = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "threshold"), eq(planRevisions.objectId, rows[0].id)));
    expect(revs).toEqual([expect.objectContaining({ action: "create", writer: "sync" })]);
  });

  it("does not write under a 3 % move", async () => {
    await seedOwner(me);
    await addThreshold({ userId: me, writer: "sync" }, { kind: "ftp", value: 182, source: "garmin" });
    await updateFtpEstimate(me, new Date());
    expect((await ftpRows(me)).map((r) => r.value)).toEqual([182, APP_FTP]);
  });

  it("does not write while a manual or test FTP pins it", async () => {
    await seedOwner(me);
    await addThreshold({ userId: me, writer: "user" }, { kind: "ftp", value: 200, source: "manual" });
    await updateFtpEstimate(me, new Date());
    expect((await ftpRows(me)).map((r) => r.value)).toEqual([200, APP_FTP]);

    await addThreshold({ userId: me, writer: "user" }, { kind: "ftp", source: "test", protocol: "ftp_20min", testData: { avgPower20: 220 } });
    await updateFtpEstimate(me, new Date());
    expect((await ftpRows(me)).map((r) => r.source)).toEqual(["test", "manual", "garmin"]);
  });

  it("writes the first FTP when there is none, and nothing with no rides", async () => {
    const empty = (await createUser()).id;
    await updateFtpEstimate(empty, new Date());
    expect(await ftpRows(empty)).toEqual([]);

    await ride(empty, 9, bestDay, { 3600: 186 });
    await updateFtpEstimate(empty, new Date());
    expect((await ftpRows(empty)).map((r) => r.value)).toEqual([186]);
  });
});

describe("getBikeNumbers", () => {
  it("gives the estimated FTP with its basis and the change, the watch FTP and the Garmin zones", async () => {
    await seedOwner(me);
    await updateFtpEstimate(me, new Date());
    const n = await getBikeNumbers(me);
    expect(n.ftp).toEqual({ value: ESTIMATED_FTP, basis: expect.stringMatching(/^best 60 min on /), source: "garmin", changedFrom: APP_FTP });
    expect(n.watchFtp).toBe(WATCH_FTP);
    expect(n.zones?.source).toBe("garmin");
    expect(n.zones?.hr[1]).toEqual({ low: 121, high: 140 });
    expect(n.estimate).toEqual({ value: ESTIMATED_FTP, basis: n.ftp!.basis });
    expect(watchFtpNote(n)).toBe("Your watch uses 266 W. Set it to 186 W so the watch power zones match.");
  });

  it("keeps a manual FTP and still reports the estimate", async () => {
    await seedOwner(me);
    await addThreshold({ userId: me, writer: "user" }, { kind: "ftp", value: 200, source: "manual" });
    const n = await getBikeNumbers(me);
    expect(n.ftp).toEqual({ value: 200, basis: null, source: "manual", changedFrom: null });
    expect(n.estimate?.value).toBe(ESTIMATED_FTP);
  });

  it("gives nothing for a user with no data", async () => {
    expect(await getBikeNumbers((await createUser()).id)).toEqual({ ftp: null, watchFtp: null, zones: null, estimate: null, garminZones: null });
  });
});

describe("setFtpAutomatic", () => {
  it("unpins a manual FTP with the estimate, as the user", async () => {
    await seedOwner(me);
    await addThreshold({ userId: me, writer: "user" }, { kind: "ftp", value: 200, source: "manual" });
    asUser(me);
    expect(await setFtpAutomatic()).toEqual({ success: true, data: { value: ESTIMATED_FTP } });
    const [row] = await ftpRows(me);
    expect(row).toMatchObject({ value: ESTIMATED_FTP, source: "garmin" });
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "threshold"), eq(planRevisions.objectId, row.id)));
    expect(rev.writer).toBe("user");
  });

  it("refuses with no rides", async () => {
    asUser(me);
    expect((await setFtpAutomatic()).success).toBe(false);
    expect(await ftpRows(me)).toEqual([]);
  });
});

describe("saveBikeHrZones", () => {
  it("stores custom zones that override Garmin, and clears them", async () => {
    await seedOwner(me);
    asUser(me);
    expect(await saveBikeHrZones({ floors: [100, 125, 142, 156, 170], maxHr: 195 })).toEqual({ success: true, data: undefined });
    let n = await getBikeNumbers(me);
    expect(n.zones).toEqual({
      source: "custom",
      hr: [
        { low: 100, high: 124 },
        { low: 125, high: 141 },
        { low: 142, high: 155 },
        { low: 156, high: 169 },
        { low: 170, high: 195 },
      ],
    });
    expect(n.garminZones?.source).toBe("garmin");

    expect((await saveBikeHrZones({ clear: true })).success).toBe(true);
    n = await getBikeNumbers(me);
    expect(n.zones?.source).toBe("garmin");
    const [profile] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, me));
    expect(profile.bikeHrZones).toBeNull();
  });

  it("refuses bad zones and a user with endurance off, and writes only the caller's profile", async () => {
    asUser(me);
    expect((await saveBikeHrZones({ floors: [100, 90, 142, 156, 170], maxHr: 195 })).success).toBe(false);
    expect((await saveBikeHrZones({ floors: [100, 125, 142, 156, 170], maxHr: 195, userId: "x" })).success).toBe(false);

    const lifter = (await createUser()).id;
    asUser(lifter);
    expect((await saveBikeHrZones({ floors: [100, 125, 142, 156, 170], maxHr: 195 })).success).toBe(false);
    expect(await db.select().from(athleteProfiles)).toEqual([]);

    const read = await getBikeNumbersData();
    expect(read.success && read.data.endurance).toBe(false);
  });
});
