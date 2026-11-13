import { db } from "@/db";
import {
  athleteThresholds,
  fuelLogs,
  fuelProducts,
  garminActivities,
  garminFuelLogs,
  planRevisions,
  racePlans,
  seasonRaces,
  seasons,
  sweatTests,
  users,
  workoutSets,
} from "@/db/schema";
import { collectUserData } from "@/lib/account-data";
import { manageFuelProduct, manageSweatTest, saveFuelLogAction, saveRacePlanAction } from "@/lib/actions/nutrition";
import { deleteGarminData } from "@/lib/garmin/delete-data";
import { scopedServer } from "@/lib/mcp/scopes";
import { registerNutritionTools } from "@/lib/mcp/tools/nutrition";
import { purgePlanRevisions, restoreChangeSet, restoreRevision } from "@/lib/plan-revisions";
import { getRacePlan } from "@/lib/race-plans";
import { addRace, createSeason, removeRace, updateSeason } from "@/lib/seasons";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * Fuel logs, products, sweat tests and race plans (docs/plans/nutrition-and-race-day.md):
 * every Server Action and MCP tool, ownership, the endurance gate, the race
 * plan's revisions and version check, the Garmin delete, the migration's copy
 * of Garmin fuel logs, and the export. Clock: Thu 2026-11-05 12:00 UTC.
 */

const TODAY = "2026-11-05";
let me: string;
let other: string;

/** A completed app session with a timed set of `minutes`. */
async function rideSession(userId: string, minutes = 150) {
  const ex = await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" });
  const s = await createSession(userId, null, { date: TODAY, isCompleted: true, endTime: new Date() });
  await db.insert(workoutSets).values({ sessionId: s.id, exerciseId: ex.id, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: minutes * 60, isCompleted: true });
  return s.id;
}

async function race(userId: string, opts: { distance?: "half" | "full" | "olympic"; priority?: "A" | "B" | "C"; date?: string } = {}) {
  const [s] = await db.insert(seasons).values({ userId, name: "2027", startDate: "2026-11-01", endDate: "2027-09-30" }).returning();
  const [r] = await db
    .insert(seasonRaces)
    .values({ seasonId: s.id, userId, name: "Half", raceDate: opts.date ?? "2027-08-20", discipline: "triathlon", distance: opts.distance ?? "half", priority: opts.priority ?? "A" })
    .returning();
  return r.id;
}

function tools(userId: string, garmin = false) {
  return mcpTools((s, u) => registerNutritionTools(s, u, "client-1", { garmin }), userId);
}

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  other = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

describe("saveFuelLogAction on an app session", () => {
  it("saves typed totals with the session's duration, replaces them, and clears them", async () => {
    const sid = await rideSession(me, 150);
    expect(await saveFuelLogAction({ workoutSessionId: sid, carbsG: 150, fluidMl: 1200, sodiumMg: 800, giScore: 2 })).toMatchObject({ success: true });
    expect(await saveFuelLogAction({ workoutSessionId: sid, carbsG: 175, giScore: 3 })).toMatchObject({ success: true });
    const rows = await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me));
    expect(rows).toEqual([expect.objectContaining({ workoutSessionId: sid, garminActivityId: null, durationS: 9000, carbsG: 175, fluidMl: null, giScore: 3 })]);
    expect(await saveFuelLogAction({ workoutSessionId: sid, clear: true })).toEqual({ success: true, data: { id: null } });
    expect(await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me))).toEqual([]);
  });

  it("sums products for totals that are not typed and keeps the product numbers on the log", async () => {
    const sid = await rideSession(me);
    const gel = await manageFuelProduct({ op: "add", product: { name: "Gel", carbsG: 25, sodiumMg: 50 } });
    const drink = await manageFuelProduct({ op: "add", product: { name: "Drink", carbsG: 40, sodiumMg: 300, fluidMl: 500 } });
    if (!gel.success || !drink.success) throw new Error("products");
    await saveFuelLogAction({ workoutSessionId: sid, sodiumMg: 1000, items: [{ productId: gel.data.id, count: 3 }, { productId: drink.data.id, count: 2 }] });
    const [log] = await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me));
    expect(log).toMatchObject({ carbsG: 155, fluidMl: 1000, sodiumMg: 1000, caffeineMg: null });
    // Deleting a product keeps the log's numbers.
    await manageFuelProduct({ op: "delete", id: gel.data.id });
    const [kept] = await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me));
    expect((kept.items as { name: string }[]).map((i) => i.name)).toEqual(["Gel", "Drink"]);
  });

  it("refuses another user's session, another user's product, an open session and the switch off", async () => {
    const theirs = await rideSession(other);
    expect(await saveFuelLogAction({ workoutSessionId: theirs, carbsG: 50 })).toEqual({ success: false, error: "Session not found" });
    asUser(other);
    const p = await manageFuelProduct({ op: "add", product: { name: "Their gel", carbsG: 20 } });
    asUser(me);
    const sid = await rideSession(me);
    if (!p.success) throw new Error("product");
    expect(await saveFuelLogAction({ workoutSessionId: sid, items: [{ productId: p.data.id, count: 1 }] })).toEqual({ success: false, error: `Product ${p.data.id} not found` });
    const open = await createSession(me, null, { date: TODAY, isCompleted: false });
    expect(await saveFuelLogAction({ workoutSessionId: open.id, carbsG: 50 })).toEqual({ success: false, error: "Session not found" });
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    expect(await saveFuelLogAction({ workoutSessionId: sid, carbsG: 50 })).toEqual({ success: false, error: "Endurance features are not on for this account" });
    expect(await db.select().from(fuelLogs)).toEqual([]);
  });

  it("refuses a GI score outside 0-10 and a log with two links", async () => {
    const sid = await rideSession(me);
    expect((await saveFuelLogAction({ workoutSessionId: sid, giScore: 11 })).success).toBe(false);
    expect((await saveFuelLogAction({ workoutSessionId: sid, garminActivityId: 5, carbsG: 10 })).success).toBe(false);
  });
});

describe("fuel products", () => {
  it("adds, updates and deletes only the user's own", async () => {
    const r = await manageFuelProduct({ op: "add", product: { name: "Bar", carbsG: 30 } });
    if (!r.success) throw new Error("add");
    expect(await manageFuelProduct({ op: "update", product: { id: r.data.id, caffeineMg: 50 } })).toMatchObject({ success: true });
    expect((await db.select().from(fuelProducts).where(eq(fuelProducts.id, r.data.id)))[0]).toMatchObject({ name: "Bar", carbsG: 30, caffeineMg: 50 });
    asUser(other);
    expect(await manageFuelProduct({ op: "update", product: { id: r.data.id, name: "Mine" } })).toEqual({ success: false, error: "Product not found" });
    expect(await manageFuelProduct({ op: "delete", id: r.data.id })).toEqual({ success: false, error: "Product not found" });
    asUser(me);
    expect(await manageFuelProduct({ op: "delete", id: r.data.id })).toMatchObject({ success: true });
  });
});

describe("sweat tests", () => {
  it("adds a test, refuses a likely typo and another user's delete", async () => {
    const r = await manageSweatTest({ op: "add", test: { durationMinutes: 60, preKg: 70, postKg: 69, fluidMl: 500, temperatureC: 22 } });
    expect(r).toMatchObject({ success: true });
    expect(await manageSweatTest({ op: "add", test: { durationMinutes: 60, preKg: 70, postKg: 60, fluidMl: 500 } })).toEqual({
      success: false,
      error: "The weight changed by more than 5 %. Check the numbers.",
    });
    expect(await manageSweatTest({ op: "add", test: { durationMinutes: 60, preKg: 70, postKg: 69, fluidMl: 500, testedOn: "2026-11-06" } })).toEqual({
      success: false,
      error: "A sweat test is on today or earlier.",
    });
    const [row] = await db.select().from(sweatTests).where(eq(sweatTests.userId, me));
    expect(row).toMatchObject({ testedOn: TODAY, durationS: 3600, preKg: 70, postKg: 69 });
    asUser(other);
    expect(await manageSweatTest({ op: "delete", id: row.id })).toEqual({ success: false, error: "Sweat test not found" });
    asUser(me);
    expect(await manageSweatTest({ op: "delete", id: row.id })).toMatchObject({ success: true });
  });
});

describe("race plans", () => {
  it("creates the plan on the first save, then needs the version, with a revision for each change", async () => {
    const rid = await race(me);
    const first = await saveRacePlanAction({ raceId: rid, change: { startTime: "07:30", bikeMinutes: 180 } });
    if (!first.success) throw new Error(first.error);
    expect(first.data.version).toBe(1);
    const second = await saveRacePlanAction({ raceId: rid, expectedVersion: 1, change: { bikeMinutes: 170, t1Minutes: 4 } });
    if (!second.success) throw new Error(second.error);
    expect(second.data.version).toBe(2);
    expect(await saveRacePlanAction({ raceId: rid, expectedVersion: 1, change: { runMinutes: 100 } })).toMatchObject({ success: false });
    const [row] = await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, rid));
    expect(row.plan).toEqual({ startTime: "07:30", bikeMinutes: 170, t1Minutes: 4 });
    const revs = await db.select().from(planRevisions).where(and(eq(planRevisions.userId, me), eq(planRevisions.objectType, "race_plan"))).orderBy(planRevisions.id);
    expect(revs.map((r) => [r.action, r.version, r.writer])).toEqual([
      ["create", 1, "user"],
      ["update", 2, "user"],
    ]);
    // A null clears a field.
    await saveRacePlanAction({ raceId: rid, expectedVersion: 2, change: { t1Minutes: null } });
    expect((await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, rid)))[0].plan).toEqual({ startTime: "07:30", bikeMinutes: 170 });
  });

  it("restores an earlier version, and an undone create comes back on the next save", async () => {
    const rid = await race(me);
    await saveRacePlanAction({ raceId: rid, change: { bikeMinutes: 180 } });
    await saveRacePlanAction({ raceId: rid, expectedVersion: 1, change: { bikeMinutes: 200 } });
    const [firstRev] = await db.select().from(planRevisions).where(and(eq(planRevisions.userId, me), eq(planRevisions.objectType, "race_plan"))).orderBy(planRevisions.id);
    await restoreRevision({ userId: me, writer: "user" }, firstRev.id);
    expect((await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, rid)))[0].plan).toEqual({ bikeMinutes: 180 });

    // An assistant creates another race's plan; undoing its change set deletes it.
    const rid2 = await race(me, { priority: "B" });
    const t = tools(me);
    expect((await t("update_race_plan", { raceId: rid2, swimMinutes: 40, reason: "First plan" })).isError).toBe(false);
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.userId, me), eq(planRevisions.writer, "assistant"))).orderBy(desc(planRevisions.id));
    await restoreChangeSet({ userId: me, writer: "user" }, rev.changeSetId!);
    expect((await getRacePlan(me, rid2))!.version).toBeNull();
    const again = await saveRacePlanAction({ raceId: rid2, change: { swimMinutes: 45 } });
    expect(again).toMatchObject({ success: true });
    const [revived] = await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, rid2));
    expect(revived).toMatchObject({ deletedAt: null, plan: { swimMinutes: 45 } });
  });

  it("refuses another user's race, an olympic race and the switch off", async () => {
    const theirs = await race(other);
    expect(await saveRacePlanAction({ raceId: theirs, change: { swimMinutes: 40 } })).toEqual({ success: false, error: "Race plan not found" });
    const oly = await race(me, { distance: "olympic" });
    expect(await saveRacePlanAction({ raceId: oly, change: { swimMinutes: 40 } })).toEqual({ success: false, error: "Race plans cover half and full distance triathlons for now." });
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    expect(await saveRacePlanAction({ raceId: await race(me), change: {} })).toEqual({ success: false, error: "Endurance features are not on for this account" });
    expect(await db.select().from(racePlans)).toEqual([]);
  });

  it("works the plan out from thresholds, gut training and the sweat test", async () => {
    const rid = await race(me);
    await db.insert(athleteThresholds).values([
      { userId: me, kind: "ftp", value: 250, measuredOn: "2026-10-01", source: "manual" },
      { userId: me, kind: "lthr_run", value: 170, measuredOn: "2026-10-01", source: "manual" },
    ]);
    const sid = await rideSession(me, 120);
    await saveFuelLogAction({ workoutSessionId: sid, carbsG: 160, giScore: 1 }); // 80 g/h, no symptoms
    await manageSweatTest({ op: "add", test: { durationMinutes: 60, preKg: 70, postKg: 69, fluidMl: 0 } }); // 1,000 ml/h
    await saveRacePlanAction({ raceId: rid, change: { bikeMinutes: 150, startTime: "08:00" } });
    const p = (await getRacePlan(me, rid))!;
    if (!p.distance) throw new Error("unsupported");
    // Half, first-timer (no profile): IF 0.70-0.75 at 2.5 h.
    expect(p.plan.bike.ifRange).toEqual([0.75, 0.75]);
    expect(p.plan.bike.watts).toEqual([188, 188]);
    expect(p.plan.run.hrCeiling).toBe(160); // a half runs at the top of zone 3: 94 % of 170
    // Race at 80 % of 80 g/h = 65 g/h on the bike, 55 on the run.
    expect(p.fuel.carbsPerHour).toEqual({ bike: 65, run: 55 });
    expect([p.fuel.fluid.low, p.fuel.fluid.high]).toEqual([500, 800]);
    expect(p.fuel.schedule[0]).toMatchObject({ leg: "bike", carbsG: 22 });
    expect(p.safety[0]).toContain("not medical advice");
    expect(p.plan.timeline[0]).toEqual({ leg: "swim", start: "08:00", minutes: expect.any(Number), source: "assumed" });
  });
});

describe("review fixes", () => {
  it("refuses a fuel log above 150 g/h as a likely typo", async () => {
    const sid = await rideSession(me, 90);
    expect(await saveFuelLogAction({ workoutSessionId: sid, carbsG: 300, giScore: 1 })).toEqual({
      success: false,
      error: "That is over 150 g/h of carbohydrate. Check the numbers.",
    });
    expect(await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me))).toEqual([]);
  });

  it("keeps race carbs at a low proved tolerance, and the text says the same number", async () => {
    const rid = await race(me);
    const sid = await rideSession(me, 120);
    await saveFuelLogAction({ workoutSessionId: sid, carbsG: 80, giScore: 0 }); // 40 g/h
    const p = (await getRacePlan(me, rid))!;
    if (!p.distance) throw new Error("unsupported");
    expect(p.fuel.carbsPerHour).toEqual({ bike: 30, run: 20 });
    expect(p.fuel.carbsText).toContain("30 g/h");
    expect(p.fuel.carbsText).toContain("Train your gut");
    expect(p.fuel.totals.bike.carbsG).toBe(p.fuel.schedule.filter((r) => r.leg === "bike").reduce((s, r) => s + r.carbsG, 0));
  });

  it("a season undo and a removed race keep the race plan", async () => {
    const ctx = { userId: me, writer: "user" as const };
    const { season } = await createSeason(ctx, { name: "2027", startDate: "2026-11-01", endDate: "2027-09-30" });
    const added = await addRace(ctx, season.id, { name: "Half", raceDate: "2027-08-20", discipline: "triathlon", distance: "half", priority: "A" });
    const raceId = (added.out as { id: number }).id;
    await saveRacePlanAction({ raceId, change: { bikeMinutes: 170 } });

    // Change the season, then undo it: the races are restored, the plan stays.
    const [before] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, season.id))).orderBy(desc(planRevisions.id));
    await updateSeason(ctx, season.id, { name: "2027 season" });
    await restoreRevision(ctx, before.id);
    expect((await getRacePlan(me, raceId))!.inputs).toEqual({ bikeMinutes: 170 });

    // Remove the race: the plan is hidden. Restore the season: race and plan come back.
    const [withRace] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, season.id))).orderBy(desc(planRevisions.id));
    await removeRace(ctx, season.id, raceId);
    expect(await getRacePlan(me, raceId)).toBeNull();
    await restoreRevision(ctx, withRace.id);
    const back = (await getRacePlan(me, raceId))!;
    expect(back.inputs).toEqual({ bikeMinutes: 170 });
    expect(back.version).toBe(1);
  });
});

describe("re-review fixes", () => {
  it("purges an orphan race plan 90 days after its race was removed, not after its last edit", async () => {
    const ctx = { userId: me, writer: "user" as const };
    const { season } = await createSeason(ctx, { name: "2027", startDate: "2026-11-01", endDate: "2027-09-30" });
    const added = await addRace(ctx, season.id, { name: "Half", raceDate: "2027-08-20", discipline: "triathlon", distance: "half", priority: "A" });
    const raceId = (added.out as { id: number }).id;
    await saveRacePlanAction({ raceId, change: { bikeMinutes: 170 } });
    // The plan was last edited long ago.
    const old = new Date(Date.now() - 200 * 86_400_000);
    await db.update(racePlans).set({ updatedAt: old }).where(eq(racePlans.seasonRaceId, raceId));
    const [withRace] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, season.id))).orderBy(desc(planRevisions.id));

    await removeRace(ctx, season.id, raceId);
    const [orphan] = await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, raceId));
    expect(orphan.orphanedAt).not.toBeNull();
    // The night after: the plan stays, and a season undo brings race and plan back.
    await purgePlanRevisions(new Date(Date.now() + 86_400_000));
    await restoreRevision(ctx, withRace.id);
    const [back] = await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, raceId));
    expect(back.orphanedAt).toBeNull();
    expect((await getRacePlan(me, raceId))!.inputs).toEqual({ bikeMinutes: 170 });

    // Removed again and left for more than 90 days: purged.
    await removeRace(ctx, season.id, raceId);
    await purgePlanRevisions(new Date(Date.now() + 91 * 86_400_000));
    expect(await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, raceId))).toEqual([]);
  });

  it("refuses a leg time beyond the distance's limit", async () => {
    const rid = await race(me);
    expect(await saveRacePlanAction({ raceId: rid, change: { bikeMinutes: 720 } })).toEqual({
      success: false,
      error: "A half-distance bike leg is at most 300 minutes.",
    });
    expect(await saveRacePlanAction({ raceId: rid, change: { bikeMinutes: 300, runMinutes: 240, swimMinutes: 90 } })).toMatchObject({ success: true });
  });

  it("shows no sodium rate when the advice is to drink to thirst", async () => {
    const rid = await race(me);
    await manageSweatTest({ op: "add", test: { durationMinutes: 60, preKg: 70, postKg: 70, fluidMl: 0 } });
    const p = (await getRacePlan(me, rid))!;
    if (!p.distance) throw new Error("unsupported");
    expect([p.fuel.fluid.low, p.fuel.fluid.high]).toEqual([0, 0]);
    expect([p.fuel.sodium.low, p.fuel.sodium.high]).toEqual([0, 0]);
    expect(p.fuel.sodium.text).toContain("No sodium rate");
    expect(p.fuel.schedule.every((r) => r.sodiumMg === 0)).toBe(true);
  });
});

describe("MCP tools", () => {
  it("get_nutrition reads gut training, tests and logs with the safety line", async () => {
    const sid = await rideSession(me, 120);
    await saveFuelLogAction({ workoutSessionId: sid, carbsG: 140, giScore: 0 });
    const r = await tools(me)("get_nutrition", {});
    expect(r.isError).toBe(false);
    expect(r.data.safety).toContain("not medical advice");
    expect(r.data.gutTraining).toMatchObject({ proved: 70, next: 80, raceTarget: 55 });
    expect(r.data.fuelLogs).toEqual([expect.objectContaining({ workoutSessionId: sid, carbsPerHour: 70, giScore: 0 })]);
    expect(r.data.carbRules).toHaveLength(4);
    expect(r.data.carbRules[3]).toMatchObject({ fromMinutes: 151, whenProvedGPerHour: 90 });
    expect(r.data.carbRules[3].text).toContain("up to 90 g/h");
  });

  it("log_fuel, manage_fuel_products and manage_sweat_tests write the user's own rows only", async () => {
    const t = tools(me);
    const p = await t("manage_fuel_products", { operation: "add", name: "Gel", carbsG: 22, reason: "From the chat" });
    expect(p.isError).toBe(false);
    const sid = await rideSession(me);
    const f = await t("log_fuel", { workoutSessionId: sid, items: [{ productId: p.data.id, count: 4 }], giScore: 5, reason: "Athlete told me" });
    expect(f.data).toMatchObject({ saved: true, carbsG: 88, durationMinutes: 150 });
    expect((await t("log_fuel", { garminActivityId: 1, carbsG: 10, reason: "x" })).raw).toBe("Error: Garmin is not enabled for this account");
    const theirs = await rideSession(other);
    expect((await t("log_fuel", { workoutSessionId: theirs, carbsG: 10, reason: "x" })).raw).toBe("Error: Session not found");
    const s = await t("manage_sweat_tests", { operation: "add", durationMinutes: 60, preKg: 70, postKg: 69.5, fluidMl: 200, reason: "Test result" });
    expect(s.isError).toBe(false);
    expect((await t("manage_sweat_tests", { operation: "add", preKg: 70, reason: "x" })).isError).toBe(true);
    expect((await tools(other)("manage_sweat_tests", { operation: "delete", id: s.data.id, reason: "x" })).raw).toBe("Error: Sweat test not found");
    expect((await t("manage_sweat_tests", { operation: "delete", id: s.data.id, reason: "x" })).data).toEqual({ deleted: true, id: s.data.id });
  });

  it("get_race_plan defaults to the next A race; update_race_plan needs expectedVersion once the plan exists", async () => {
    await race(me, { priority: "B", date: "2027-06-01" });
    const a = await race(me, { priority: "A", date: "2027-08-20" });
    const t = tools(me);
    const read = await t("get_race_plan", {});
    expect(read.data.race.id).toBe(a);
    expect(read.data.version).toBeNull();
    expect(read.data.fuel.totals.bike.carbsG).toBeGreaterThan(0);
    expect(read.data.fuel.sodium.evidence).toContain("Consensus");
    expect((await t("update_race_plan", { raceId: a, runMinutes: 120, reason: "Expected run time" })).data).toMatchObject({ saved: true, version: 1 });
    expect((await t("update_race_plan", { raceId: a, runMinutes: 110, reason: "x" })).raw).toContain("expectedVersion is required");
    expect((await t("update_race_plan", { raceId: a, runMinutes: 110, reason: "x", expectedVersion: 7 })).raw).toContain("Conflict");
    expect((await t("update_race_plan", { raceId: a, runMinutes: 110, reason: "Faster run", expectedVersion: 1 })).data).toMatchObject({ version: 2 });
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.userId, me), eq(planRevisions.objectType, "race_plan"))).orderBy(desc(planRevisions.id));
    expect(rev).toMatchObject({ writer: "assistant", reason: "Faster run", clientId: "client-1" });
    expect((await tools(other)("get_race_plan", { raceId: a })).raw).toBe("Error: Race not found");
    expect((await tools(other)("update_race_plan", { raceId: a, runMinutes: 1, reason: "x" })).raw).toBe("Error: Race not found");
  });

  it("refuses every write on a read-only connection", async () => {
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>>();
    const base = { registerTool: (name: string, _c: unknown, h: (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>) => handlers.set(name, h) } as unknown as McpServer;
    registerNutritionTools(scopedServer(base, "read"), me);
    const rid = await race(me);
    expect((await handlers.get("update_race_plan")!({ raceId: rid, swimMinutes: 40, reason: "x" })).isError).toBe(true);
    expect((await handlers.get("manage_fuel_products")!({ operation: "add", name: "Gel", reason: "x" })).isError).toBe(true);
    expect(await db.select().from(racePlans)).toEqual([]);
    expect(await db.select().from(fuelProducts)).toEqual([]);
    expect((await handlers.get("get_nutrition")!({})).isError ?? false).toBe(false);
  });
});

describe("Garmin fuel logs", () => {
  async function garminRide(userId: string, id: number) {
    await db.insert(garminActivities).values({ userId, garminActivityId: id, startTimeLocal: new Date(`${TODAY}T08:00:00Z`), activityType: "cycling", data: { activityName: "Ride", duration: 7200 } });
  }

  it("deleting Garmin data removes the logs on Garmin activities and keeps the app-session logs", async () => {
    await garminRide(me, 501);
    const sid = await rideSession(me);
    await saveFuelLogAction({ garminActivityId: 501, carbsG: 100 });
    await saveFuelLogAction({ workoutSessionId: sid, carbsG: 120 });
    await deleteGarminData(db, me);
    expect((await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me))).map((l) => l.workoutSessionId)).toEqual([sid]);
  });

  it("migration 0089 copies garmin_fuel_logs into fuel_logs with the activity's duration", async () => {
    await garminRide(me, 601);
    await db.insert(garminFuelLogs).values([
      { userId: me, garminActivityId: 601, carbsG: 150, fluidMl: 1000 },
      // An activity no longer stored: copied with no duration.
      { userId: me, garminActivityId: 602, carbsG: 50, fluidMl: null },
    ]);
    const file = readFileSync(join(__dirname, "../../../drizzle/0089_nutrition_race_plans.sql"), "utf8");
    const copy = file.slice(file.indexOf('INSERT INTO "fuel_logs"'));
    await db.execute(sql.raw(copy));
    // Run twice: the copy is idempotent.
    await db.execute(sql.raw(copy));
    const rows = await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me)).orderBy(fuelLogs.garminActivityId);
    expect(rows.map((r) => [r.garminActivityId, r.durationS, r.carbsG, r.fluidMl])).toEqual([
      [601, 7200, 150, 1000],
      [602, null, 50, null],
    ]);
  });
});

describe("export", () => {
  it("holds the user's fuel logs, products, sweat tests and race plans", async () => {
    const sid = await rideSession(me);
    await saveFuelLogAction({ workoutSessionId: sid, carbsG: 100 });
    await manageFuelProduct({ op: "add", product: { name: "Gel", carbsG: 25 } });
    await manageSweatTest({ op: "add", test: { durationMinutes: 60, preKg: 70, postKg: 69, fluidMl: 500 } });
    await saveRacePlanAction({ raceId: await race(me), change: { swimMinutes: 40 } });
    const data = await collectUserData(me);
    expect(data.fuel_logs).toHaveLength(1);
    expect(data.fuel_products).toHaveLength(1);
    expect(data.sweat_tests).toHaveLength(1);
    expect(data.race_plans).toHaveLength(1);
    const theirs = await collectUserData(other);
    expect(theirs.fuel_logs).toHaveLength(0);
  });
});
