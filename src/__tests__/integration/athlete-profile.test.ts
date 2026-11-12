import { db } from "@/db";
import { athleteInjuries, athleteProfiles, athleteThresholds, coachMemory, planRevisions, trainingCycles, users } from "@/db/schema";
import { collectUserData } from "@/lib/account-data";
import {
  addInjuryEntry,
  addThresholdValue,
  deleteInjuryEntry,
  deleteThresholdValue,
  finishInterview,
  getAthleteData,
  getThresholdsData,
  moveMemoryToProfile,
  restoreInjuryEntry,
  restoreThresholdValue,
  saveProfile,
  updateInjuryEntry,
  updateThresholdValue,
} from "@/lib/actions/athlete-profile";
import { garminSuggestions, interviewRace } from "@/lib/athlete-profile";
import { addCoachMemory } from "@/lib/coach-memory";
import { THRESHOLDS_PER_KIND_MAX, listRevisions, purgePlanRevisions, restoreChangeSet } from "@/lib/plan-revisions";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** The athlete profile, thresholds, injuries and the interview in the app (docs/plans/athlete-profile.md). */

let me: string;
let lifter: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  lifter = (await createUser()).id;
});

const revisionsOf = (type: "athlete" | "threshold" | "injury", id: number) =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, type), eq(planRevisions.objectId, id)))
    .orderBy(asc(planRevisions.id));

describe("thresholds", () => {
  it("adds by hand for a lifter with the switch off, with a revision by the user", async () => {
    asUser(lifter);
    const r = await addThresholdValue({ kind: "ftp", value: 250, source: "manual", measuredOn: "2026-11-01" });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    const revs = await revisionsOf("threshold", r.data.id);
    expect(revs.map((x) => [x.action, x.writer])).toEqual([["create", "user"]]);
    const page = await getThresholdsData();
    expect(page.success && page.data.thresholds.map((t) => [t.kind, t.value])).toEqual([["ftp", 250]]);
  });

  it("computes CSS from the 400/200 test and keeps the inputs", async () => {
    asUser(me);
    const r = await addThresholdValue({
      kind: "swim_css",
      source: "test",
      protocol: "css_400_200",
      testData: { t400Seconds: 400, t200Seconds: 190 },
    });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    expect(r.data.value).toBeCloseTo(200 / 210, 5);
    const [row] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, r.data.id));
    expect(row.testData).toEqual({ t400Seconds: 400, t200Seconds: 190 });
  });

  it("refuses out of range, a test without its protocol, and a value that disagrees with the test", async () => {
    asUser(me);
    expect((await addThresholdValue({ kind: "ftp", value: 900, source: "manual" })).success).toBe(false);
    expect((await addThresholdValue({ kind: "ftp", value: 250, source: "test" })).success).toBe(false);
    const bad = await addThresholdValue({ kind: "ftp", value: 300, source: "test", protocol: "bike_30min", testData: { avgPowerBest20: 260 } });
    expect(bad.success).toBe(false);
    expect(!bad.success && bad.error).toContain("does not match");
    expect(await db.select().from(athleteThresholds)).toHaveLength(0);
  });

  it("updates, deletes and restores, each a revision; another user cannot touch it", async () => {
    asUser(me);
    const r = await addThresholdValue({ kind: "lthr_run", value: 168, source: "manual" });
    if (!r.success) throw new Error(r.error);
    asUser(lifter);
    expect((await updateThresholdValue({ id: r.data.id, value: 100 })).success).toBe(false);
    expect((await deleteThresholdValue({ id: r.data.id })).success).toBe(false);
    asUser(me);
    expect((await updateThresholdValue({ id: r.data.id, value: 170 })).success).toBe(true);
    expect((await deleteThresholdValue({ id: r.data.id })).success).toBe(true);
    const page = await getThresholdsData();
    expect(page.success && page.data.thresholds).toEqual([]);
    expect(page.success && page.data.deleted.map((d) => d.id)).toEqual([r.data.id]);
    expect((await restoreThresholdValue({ id: r.data.id })).success).toBe(true);
    const [row] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, r.data.id));
    expect(row).toMatchObject({ value: 170, deletedAt: null });
    const revs = await revisionsOf("threshold", r.data.id);
    expect(revs.map((x) => x.action)).toEqual(["create", "update", "delete", "restore"]);
    const history = await listRevisions(me, { type: "threshold", id: r.data.id });
    expect(history.find((h) => h.action === "update")?.changes[0]).toContain("168 bpm");
  });

  it("refuses a value past the cap per kind", async () => {
    asUser(me);
    await db.insert(athleteThresholds).values(
      Array.from({ length: THRESHOLDS_PER_KIND_MAX }, () => ({ userId: me, kind: "ftp" as const, value: 200, measuredOn: "2026-01-01", source: "manual" as const })),
    );
    const r = await addThresholdValue({ kind: "ftp", value: 250, source: "manual" });
    expect(!r.success && r.error).toContain(`At most ${THRESHOLDS_PER_KIND_MAX}`);
    expect((await addThresholdValue({ kind: "max_hr", value: 190, source: "manual" })).success).toBe(true);
  });

  it("purges deleted values after 90 days with their revisions", async () => {
    asUser(me);
    const r = await addThresholdValue({ kind: "max_hr", value: 190, source: "manual" });
    if (!r.success) throw new Error(r.error);
    await deleteThresholdValue({ id: r.data.id });
    await db.update(athleteThresholds).set({ deletedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(athleteThresholds.id, r.data.id));
    await purgePlanRevisions();
    expect(await db.select().from(athleteThresholds)).toHaveLength(0);
    expect(await revisionsOf("threshold", r.data.id)).toHaveLength(0);
  });
});

describe("profile and injuries", () => {
  it("are refused with the endurance switch off, and nothing is written", async () => {
    asUser(lifter);
    const p = await saveProfile({ strengthGoal: "minimal" });
    expect(!p.success && p.error).toContain("Endurance features are not on");
    const i = await addInjuryEntry({ area: "knee", description: "Sore", status: "active" });
    expect(i.success).toBe(false);
    expect(await getAthleteData()).toEqual({ success: true, data: null });
    expect(await db.select().from(athleteProfiles)).toHaveLength(0);
    expect(await db.select().from(athleteInjuries)).toHaveLength(0);
  });

  it("creates the profile on the first write, then updates it with a revision per write", async () => {
    asUser(me);
    expect((await saveProfile({ availableDays: [6, 1, 3, 3], hoursPerWeek: 8.5, longestDayMinutes: 240, longDay: 6 })).success).toBe(true);
    expect((await saveProfile({ strengthGoal: "keep_muscle", enduranceLevel: "novice" })).success).toBe(true);
    const [row] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, me));
    expect(row).toMatchObject({ availableDays: [1, 3, 6], hoursPerWeek: 8.5, strengthGoal: "keep_muscle", version: 2 });
    const revs = await revisionsOf("athlete", row.id);
    expect(revs.map((x) => x.action)).toEqual(["create", "update"]);
    const history = await listRevisions(me, { type: "athlete", id: row.id });
    expect(history[0].changes).toEqual(expect.arrayContaining(["Strength goal none → keep muscle"]));
  });

  it("adds, updates, deletes and restores an injury; another user cannot", async () => {
    asUser(me);
    const r = await addInjuryEntry({ area: "knee", side: "left", description: "Sore after long runs", avoid: "No downhill", status: "active" });
    if (!r.success) throw new Error(r.error);
    asUser(lifter);
    expect((await updateInjuryEntry({ id: r.data.id, status: "past" })).success).toBe(false);
    asUser(me);
    expect((await updateInjuryEntry({ id: r.data.id, status: "past", endedOn: "2026-11-10" })).success).toBe(true);
    expect((await deleteInjuryEntry({ id: r.data.id })).success).toBe(true);
    expect((await restoreInjuryEntry({ id: r.data.id })).success).toBe(true);
    const revs = await revisionsOf("injury", r.data.id);
    expect(revs.map((x) => x.action)).toEqual(["create", "update", "delete", "restore"]);
    const data = await getAthleteData();
    expect(data.success && data.data?.injuries.map((i) => i.status)).toEqual(["past"]);
  });
});

describe("the interview", () => {
  it("saves each step alone, shares one change set, and the whole run can be undone", async () => {
    asUser(me);
    await saveProfile({ strengthGoal: "minimal" });
    const changeSetId = `interview:${randomUUID()}`;
    const mem = await addCoachMemory({ userId: me, writer: "assistant", reason: "x" }, { kind: "observation", text: "Left knee sore after 90 min runs" });
    await addCoachMemory({ userId: me, writer: "user" }, { kind: "preference", text: "Long rides on Saturday" });

    const before = await getAthleteData();
    expect(before.success && before.data?.memory.map((m) => m.id)).toEqual([mem.id]);
    expect(before.success && before.data?.missing).toEqual(["race", "experience", "availability", "thresholds"]);

    expect((await saveProfile({ enduranceLevel: "intermediate", changeSetId })).success).toBe(true);
    expect((await saveProfile({ availableDays: [1, 2, 4, 6, 7], hoursPerWeek: 9, changeSetId })).success).toBe(true);
    expect((await saveProfile({ strengthGoal: "stronger", changeSetId })).success).toBe(true);
    const t = await addThresholdValue({ kind: "max_hr", value: 188, source: "manual", changeSetId });
    const i = await addInjuryEntry({ area: "knee", side: "left", description: "Sore after 90 min runs", status: "managed", changeSetId });
    expect((await moveMemoryToProfile({ id: mem.id, changeSetId })).success).toBe(true);
    expect((await finishInterview({ changeSetId })).success).toBe(true);

    const [m] = await db.select().from(coachMemory).where(eq(coachMemory.id, mem.id));
    expect(m.active).toBe(false);
    const [memRev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "memory"), eq(planRevisions.objectId, mem.id), eq(planRevisions.action, "update")));
    expect(memRev).toMatchObject({ writer: "user", reason: "Moved to the athlete profile by the intake interview", changeSetId });
    const [p] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, me));
    expect(p.interviewCompletedAt).not.toBeNull();
    const inSet = await db.select().from(planRevisions).where(eq(planRevisions.changeSetId, changeSetId));
    expect(new Set(inSet.map((r) => r.objectType))).toEqual(new Set(["athlete", "threshold", "injury", "memory"]));

    // Undo the whole interview: the profile goes back, the new rows go, the memory entry is in use again.
    await restoreChangeSet({ userId: me, writer: "user" }, changeSetId);
    const [after] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, me));
    expect(after).toMatchObject({ strengthGoal: "minimal", enduranceLevel: null, interviewCompletedAt: null });
    if (t.success) expect((await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, t.data.id)))[0].deletedAt).not.toBeNull();
    if (i.success) expect((await db.select().from(athleteInjuries).where(eq(athleteInjuries.id, i.data.id)))[0].deletedAt).not.toBeNull();
    expect((await db.select().from(coachMemory).where(eq(coachMemory.id, mem.id)))[0].active).toBe(true);
  });

  it("an undo of the profile's creation clears it, and the next write starts again", async () => {
    asUser(me);
    const changeSetId = `interview:${randomUUID()}`;
    await saveProfile({ strengthGoal: "stronger", changeSetId });
    await restoreChangeSet({ userId: me, writer: "user" }, changeSetId);
    const data = await getAthleteData();
    expect(data.success && data.data?.profile).toBeNull();
    expect((await saveProfile({ hoursPerWeek: 6 })).success).toBe(true);
    const [row] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, me));
    expect(row).toMatchObject({ hoursPerWeek: 6, strengthGoal: null, deletedAt: null });
  });

  it("moves only limit and observation entries, and only the user's own", async () => {
    asUser(me);
    const pref = await addCoachMemory({ userId: me, writer: "user" }, { kind: "preference", text: "Mornings" });
    expect((await moveMemoryToProfile({ id: pref.id })).success).toBe(false);
    const theirs = await addCoachMemory({ userId: lifter, writer: "user" }, { kind: "limit", text: "Travel" });
    expect((await moveMemoryToProfile({ id: theirs.id })).success).toBe(false);
    expect((await db.select().from(coachMemory).where(eq(coachMemory.id, theirs.id)))[0].active).toBe(true);
  });

  it("reads the race from the active cycle (C1 wires this to the season later)", async () => {
    expect(await interviewRace(me)).toBeNull();
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Base", durationWeeks: 8, status: "active", startDate: "2026-11-02", raceDate: "2027-08-15", raceDistance: "half" })
      .returning();
    expect(await interviewRace(me)).toEqual({ date: "2027-08-15", distance: "half", cycleId: c.id, cycleName: "Base" });
  });
});

describe("export and deletion", () => {
  it("the export holds all three tables, and deleting the user removes them", async () => {
    asUser(me);
    await saveProfile({ strengthGoal: "minimal" });
    await addThresholdValue({ kind: "ftp", value: 250, source: "manual" });
    await addInjuryEntry({ area: "hip", description: "Tight", status: "managed" });
    const data = await collectUserData(me);
    expect(data.athlete_profiles).toHaveLength(1);
    expect(data.athlete_thresholds).toHaveLength(1);
    expect(data.athlete_injuries).toHaveLength(1);
    await db.delete(users).where(eq(users.id, me));
    expect(await db.select().from(athleteProfiles)).toHaveLength(0);
    expect(await db.select().from(athleteThresholds)).toHaveLength(0);
    expect(await db.select().from(athleteInjuries)).toHaveLength(0);
  });
});

describe("Garmin suggestions", () => {
  it("are empty for a user without Garmin access", async () => {
    expect(await garminSuggestions(me)).toEqual([]);
  });

  it("come from the Garmin threshold history for an admin, and hide when the stored value matches", async () => {
    vi.resetModules();
    vi.doMock("@/lib/garmin/access", () => ({ garminAllowedFor: async () => true, garminAllowed: () => true }));
    vi.doMock("@/lib/garmin/queries", () => ({
      getTrendsData: async () => ({ acts: [{ id: 1, day: "2026-11-10", sport: "bike", watchMaxHr: 191 }] }),
    }));
    vi.doMock("@/lib/garmin/analytics/trends", async (orig) => ({
      ...(await orig<typeof import("@/lib/garmin/analytics/trends")>()),
      thresholdHistory: () => [{ weekStart: "2026-11-09", ftp: 262, cp: null, cs: 3.9, lthrRun: 171, lthrBike: null, watchLthr: 166 }],
    }));
    const mod = await import("@/lib/athlete-profile");
    const s = await mod.garminSuggestions(me, []);
    expect(s.map((x) => [x.kind, x.value])).toEqual([
      ["ftp", 262],
      ["lthr_bike", 166],
      ["lthr_run", 171],
      ["run_threshold_pace", 3.9],
      ["max_hr", 191],
    ]);
    const stored = [{ id: 1, userId: me, kind: "ftp" as const, value: 262, measuredOn: "2026-10-01", source: "manual" as const, protocol: null, testData: null, notes: null, deletedAt: null, version: 1, createdAt: new Date(), updatedAt: new Date() }];
    expect((await mod.garminSuggestions(me, stored)).map((x) => x.kind)).not.toContain("ftp");
    vi.doUnmock("@/lib/garmin/access");
    vi.doUnmock("@/lib/garmin/queries");
    vi.doUnmock("@/lib/garmin/analytics/trends");
    vi.resetModules();
  });
});
