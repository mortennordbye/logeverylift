import { db } from "@/db";
import { planRevisions, seasonRaces, seasons, trainingCycles } from "@/db/schema";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerSeasonTools } from "@/lib/mcp/tools/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { mcpTools } from "./mcp-call";

/** The season tools over MCP (docs/plans/seasons.md, 2.9): every tool, versions, ownership, the switch. */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;
let other: string;
let lifter: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
  lifter = (await createUser()).id;
});

const seasonRow = async (id: number) => (await db.select().from(seasons).where(eq(seasons.id, id)))[0];
const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];

async function created(userId = me, start = day(0)) {
  const call = mcpTools(registerSeasonTools, userId);
  const r = await call("manage_season", { operation: "create", name: "2027", goal: "First half", startDate: start, endDate: day(300), reason: "Plan the year" });
  expect(r.isError, r.raw).toBe(false);
  return { call, id: r.data.seasonId as number };
}

describe("manage_season and the read tools", () => {
  it("creates, reads, updates and deletes, each an assistant revision with the reason", async () => {
    const { call, id } = await created();
    const list = await call("list_seasons");
    expect(list.data.seasons).toEqual([expect.objectContaining({ id, name: "2027", status: "active", version: 1, replan: expect.objectContaining({ flagged: false }) })]);
    const got = await call("get_season", { seasonId: id });
    expect(got.data).toMatchObject({ id, goal: "First half", races: [], phases: [], taperFit: { status: "no_race" }, chainPaused: false });

    const up = await call("manage_season", { operation: "update", seasonId: id, nextGoal: "Full", reason: "Next year", expectedVersion: 1 });
    expect(up.data).toMatchObject({ updated: true, version: 2 });
    const del = await call("manage_season", { operation: "delete", seasonId: id, reason: "Wrong year", expectedVersion: 2 });
    expect(del.isError, del.raw).toBe(false);
    expect((await call("get_season", { seasonId: id })).raw).toContain("Season not found");
    const revs = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, id))).orderBy(asc(planRevisions.id));
    expect(revs.map((r) => [r.action, r.writer, r.reason])).toEqual([
      ["create", "assistant", "Plan the year"],
      ["update", "assistant", "Next year"],
      ["delete", "assistant", "Wrong year"],
    ]);
  });

  it("refuses a stale expectedVersion with what changed, and changes nothing", async () => {
    const { call, id } = await created();
    await call("manage_season", { operation: "update", seasonId: id, name: "2027 season", reason: "Name", expectedVersion: 1 });
    const stale = await call("manage_season", { operation: "update", seasonId: id, goal: "Other", reason: "Goal", expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.raw).toContain("Conflict");
    expect(stale.raw).toContain("name 2027 → 2027 season");
    expect(await seasonRow(id)).toMatchObject({ goal: "First half", version: 2 });
    expect((await call("manage_season", { operation: "update", seasonId: id, goal: "x", reason: "x" })).raw).toContain("expectedVersion is required");
  });

  it("refuses another user's season, and a write changes nothing", async () => {
    const { id } = await created();
    const theirs = mcpTools(registerSeasonTools, other);
    expect((await theirs("get_season", { seasonId: id })).raw).toContain("Season not found");
    expect((await theirs("manage_season", { operation: "update", seasonId: id, name: "Mine", reason: "x", expectedVersion: 1 })).raw).toContain("Season not found");
    expect((await theirs("manage_race", { operation: "add", seasonId: id, name: "R", date: "2027-08-22", discipline: "run", priority: "A", reason: "x", expectedVersion: 1 })).raw).toContain("Season not found");
    expect((await theirs("list_seasons")).data.seasons).toEqual([]);
    expect(await seasonRow(id)).toMatchObject({ name: "2027", version: 1 });
  });

  it("builds phases: a new taper, an existing cycle, move, set, fit the taper, remove", async () => {
    const { call, id } = await created(me, day(1));
    const raceDay = day(1 + 56 + 10 - 1 + 3);
    await call("manage_race", { operation: "add", seasonId: id, name: "Half", date: raceDay, discipline: "triathlon", distance: "half", priority: "A", reason: "Booked", expectedVersion: 1 });
    await call("manage_season", { operation: "clear_replan", seasonId: id, reason: "Planning now", expectedVersion: 2 });
    const [existing] = await db.insert(trainingCycles).values({ userId: me, name: "Build", durationWeeks: 8 }).returning();

    const build = await call("manage_season", { operation: "add_phase", seasonId: id, cycleId: existing.id, cycleVersion: 1, phaseType: "build", reason: "Build first", expectedVersion: 3 });
    expect(build.isError, build.raw).toBe(false);
    expect(build.data).toMatchObject({ added: true, cycleId: existing.id, seasonVersion: 4, cycleVersion: 2 });
    const taper = await call("manage_season", { operation: "add_phase", seasonId: id, name: "Taper", phaseType: "taper", reason: "Taper to the race", expectedVersion: 4 });
    expect(taper.isError, taper.raw).toBe(false);
    const got = await call("get_season", { seasonId: id });
    expect(got.data.phases.map((p: { name: string; phaseType: string; durationDays: number | null }) => [p.name, p.phaseType, p.durationDays])).toEqual([
      ["Build", "build", null],
      ["Taper", "taper", 10],
    ]);
    // The first phase waits for the season start (tomorrow).
    expect(got.data.nextPhase).toMatchObject({ cycleId: existing.id, plannedStart: day(1), scheduled: true });
    expect(got.data.taperFit).toMatchObject({ status: "early", days: 3 });

    const fit = await call("manage_season", { operation: "fit_taper", seasonId: id, reason: "End on race day", expectedVersion: got.data.version });
    expect(fit.isError, fit.raw).toBe(false);
    expect((await cycleRow(existing.id)).durationDays).toBe(59);
    const after = await call("get_season", { seasonId: id });
    expect(after.data.taperFit.status).toBe("fits");

    const moved = await call("manage_season", { operation: "move_phase", seasonId: id, cycleId: taper.data.cycleId, position: 1, reason: "Test order", expectedVersion: after.data.version });
    expect(moved.isError, moved.raw).toBe(false);
    const set = await call("manage_season", { operation: "set_phase", seasonId: id, cycleId: existing.id, phaseType: "peak", durationWeeks: 3, reason: "Shorter", expectedVersion: moved.data.seasonVersion });
    expect(set.isError, set.raw).toBe(false);
    expect(await cycleRow(existing.id)).toMatchObject({ phaseType: "peak", durationWeeks: 3, durationDays: null, phaseOrder: 2 });
    const removed = await call("manage_season", { operation: "remove_phase", seasonId: id, cycleId: existing.id, reason: "Not needed", expectedVersion: set.data.seasonVersion });
    expect(removed.isError, removed.raw).toBe(false);
    expect(await cycleRow(existing.id)).toMatchObject({ seasonId: null, phaseType: null, phaseOrder: null });
  });

  it("add_phase with an existing cycle needs its version, and a stale one is refused", async () => {
    const { call, id } = await created();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, version: 5 }).returning();
    expect((await call("manage_season", { operation: "add_phase", seasonId: id, cycleId: c.id, reason: "x", expectedVersion: 1 })).raw).toContain("cycleVersion is required");
    const stale = await call("manage_season", { operation: "add_phase", seasonId: id, cycleId: c.id, cycleVersion: 4, reason: "x", expectedVersion: 1 });
    expect(stale.raw).toContain("Conflict");
    expect((await cycleRow(c.id)).seasonId).toBeNull();
    expect((await seasonRow(id)).version).toBe(1);
  });

  it("refuses phase types without the endurance switch, but a lifter can build a season", async () => {
    const { call, id } = await created(lifter);
    expect((await call("manage_season", { operation: "add_phase", seasonId: id, name: "Base", phaseType: "base", reason: "x", expectedVersion: 1 })).raw).toContain("endurance features");
    const plain = await call("manage_season", { operation: "add_phase", seasonId: id, name: "Strength block", durationWeeks: 6, reason: "Bench 120 kg", expectedVersion: 1 });
    expect(plain.isError, plain.raw).toBe(false);
  });

  it("resume schedules the next phase after a cycle outside the season ran", async () => {
    const { call, id } = await created(me, day(0));
    const one = await call("manage_season", { operation: "add_phase", seasonId: id, name: "Base", durationWeeks: 4, reason: "x", expectedVersion: 1 });
    const two = await call("manage_season", { operation: "add_phase", seasonId: id, name: "Build", durationWeeks: 4, reason: "x", expectedVersion: 2 });
    const cycles = mcpTools(registerCycleTools, me);
    await cycles("manage_training_cycle", { operation: "start", cycleId: one.data.cycleId, reason: "Go", expectedVersion: one.data.cycleVersion });
    const [outside] = await db.insert(trainingCycles).values({ userId: me, name: "Travel week", durationWeeks: 4 }).returning();
    await cycles("manage_training_cycle", { operation: "start", cycleId: outside.id, reason: "Travel", expectedVersion: 1 });
    const paused = await call("get_season", { seasonId: id });
    expect(paused.data.chainPaused).toBe(true);
    const resumed = await call("manage_season", { operation: "resume", seasonId: id, reason: "Back home", expectedVersion: paused.data.version });
    expect(resumed.isError, resumed.raw).toBe(false);
    expect(await cycleRow(two.data.cycleId)).toMatchObject({ status: "draft", scheduledStartDate: day(28) });
  });
});

describe("manage_race and the re-plan flag", () => {
  it("adds, moves and removes a race; the flag shows in list_seasons and get_season", async () => {
    const { call, id } = await created();
    const add = await call("manage_race", { operation: "add", seasonId: id, name: "Half", date: "2027-08-22", discipline: "triathlon", distance: "half", priority: "A", reason: "Booked", expectedVersion: 1 });
    expect(add.data).toMatchObject({ added: true, version: 2, replanFlagged: expect.stringContaining("added") });
    await call("manage_season", { operation: "clear_replan", seasonId: id, reason: "Re-planned", expectedVersion: 2 });
    const renamed = await call("manage_race", { operation: "update", seasonId: id, raceId: add.data.raceId, name: "Haugesund", reason: "Name", expectedVersion: 3 });
    expect(renamed.data.replanFlagged).toBeNull();
    const moved = await call("manage_race", { operation: "update", seasonId: id, raceId: add.data.raceId, date: "2027-08-29", reason: "Date moved", expectedVersion: 4 });
    expect(moved.data.replanFlagged).toContain("moved from 2027-08-22 to 2027-08-29");
    expect((await call("list_seasons")).data.seasons[0].replan).toMatchObject({ flagged: true, reason: expect.stringContaining("moved") });
    expect((await call("get_season", { seasonId: id })).data.replan).toMatchObject({ flagged: true });
    const removed = await call("manage_race", { operation: "remove", seasonId: id, raceId: add.data.raceId, reason: "Cancelled", expectedVersion: 5 });
    expect(removed.isError, removed.raw).toBe(false);
    expect(await db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, id))).toEqual([]);
  });

  it("refuses races without the endurance switch, and a stale version", async () => {
    const { call, id } = await created(lifter);
    const r = await call("manage_race", { operation: "add", seasonId: id, name: "Half", date: "2027-08-22", discipline: "triathlon", distance: "half", priority: "A", reason: "x", expectedVersion: 1 });
    expect(r.raw).toContain("endurance features");
    const mine = await created();
    const stale = await mine.call("manage_race", { operation: "add", seasonId: mine.id, name: "Half", date: "2027-08-22", discipline: "triathlon", priority: "A", reason: "x", expectedVersion: 9 });
    expect(stale.raw).toContain("Conflict");
    expect(await db.select().from(seasonRaces)).toEqual([]);
  });
});

describe("cycle tools in a season", () => {
  it("get_training_cycle returns the season's race; manage_training_cycle refuses race fields on a phase", async () => {
    const { call, id } = await created();
    await call("manage_race", { operation: "add", seasonId: id, name: "Half", date: "2027-08-22", discipline: "triathlon", distance: "half", priority: "A", reason: "x", expectedVersion: 1 });
    const phase = await call("manage_season", { operation: "add_phase", seasonId: id, name: "Base", phaseType: "base", durationWeeks: 6, reason: "x", expectedVersion: 2 });
    const cycles = mcpTools(registerCycleTools, me);
    const got = await cycles("get_training_cycle", { cycleId: phase.data.cycleId });
    expect(got.data).toMatchObject({ seasonId: id, phaseType: "base", race: { raceDate: "2027-08-22", source: "season" } });
    const refused = await cycles("manage_training_cycle", { operation: "update", cycleId: phase.data.cycleId, raceDate: "2027-09-01", raceDistance: "half", reason: "x", expectedVersion: phase.data.cycleVersion });
    expect(refused.raw).toContain("Set races on the season");
    expect((await cycleRow(phase.data.cycleId)).raceDate).toBeNull();
  });

  it("list_revisions and restore_revision work on a season", async () => {
    const { call, id } = await created();
    await call("manage_season", { operation: "update", seasonId: id, name: "Renamed", reason: "x", expectedVersion: 1 });
    const programs = mcpTools(registerProgramTools, me);
    const revs = await programs("list_revisions", { objectType: "season", objectId: id });
    expect(revs.data.map((r: { action: string }) => r.action)).toEqual(["update", "create"]);
    const restored = await programs("restore_revision", { revisionId: revs.data[1].revisionId, reason: "Old name was right" });
    expect(restored.isError, restored.raw).toBe(false);
    expect(await seasonRow(id)).toMatchObject({ name: "2027", version: 3 });
  });
});
