import { db } from "@/db";
import { planRevisions, seasonRaces, seasons, trainingCycles } from "@/db/schema";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import {
  addPhaseAction,
  addRaceAction,
  clearReplanAction,
  createSeasonAction,
  deleteSeasonAction,
  removePhaseAction,
  setPhaseAction,
} from "@/lib/actions/seasons";
import { getActiveCycleForUser, startTrainingCycle, updateTrainingCycle } from "@/lib/actions/training-cycles";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerSeasonTools } from "@/lib/mcp/tools/seasons";
import { purgePlanRevisions } from "@/lib/plan-revisions";
import { resumeSeason, seasonlessCycles } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/** Fixes from the review of the seasons package (docs/plans/seasons.md, section 13). */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
  asUser(me);
});

const seasonRow = async (id: number) => (await db.select().from(seasons).where(eq(seasons.id, id)))[0];
const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];
const revisionsOf = (type: "season" | "cycle", id: number) =>
  db.select().from(planRevisions).where(and(eq(planRevisions.objectType, type), eq(planRevisions.objectId, id))).orderBy(asc(planRevisions.id));
const lastRevision = async (type: "season" | "cycle", id: number) => (await revisionsOf(type, id)).at(-1)!;

async function season(start = day(0)) {
  const r = await createSeasonAction({ name: "2027", startDate: start, endDate: day(300) });
  if (!r.success) throw new Error(r.error);
  return r.data.id;
}
async function phase(seasonId: number, input: Record<string, unknown>) {
  const r = await addPhaseAction({ seasonId, ...input });
  if (!r.success) throw new Error(r.error);
  return r.data.cycleId;
}
async function cycle(userId: string, extra: Partial<typeof trainingCycles.$inferInsert> = {}) {
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, ...extra }).returning();
  return c.id;
}
const race = { name: "Half", raceDate: "2027-08-22", discipline: "triathlon" as const, distance: "half" as const, priority: "A" as const };

describe("a race moved while the season was deleted (re-review 1)", () => {
  it("goes back to the season as its A race date, and the season is flagged", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race });
    await clearReplanAction({ seasonId: id });
    const c = await phase(id, { name: "Base", durationWeeks: 6 });
    await deleteSeasonAction({ seasonId: id });
    expect((await updateTrainingCycle({ id: c, raceDate: "2027-09-05", raceDistance: "full" })).success).toBe(true);
    const del = (await revisionsOf("season", id)).find((r) => r.action === "delete")!;
    expect((await restorePlanRevision({ revisionId: del.id })).success).toBe(true);
    expect(await cycleRow(c)).toMatchObject({ seasonId: id, raceDate: null, raceDistance: null });
    const races = await db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, id));
    expect(races).toEqual([expect.objectContaining({ priority: "A", raceDate: "2027-09-05", distance: "full" })]);
    const s = await seasonRow(id);
    expect(s.replanFlaggedAt).not.toBeNull();
    expect(s.replanReason).toContain("2027-09-05");
  });

  it("adds an A race when the season had none", async () => {
    const id = await season();
    const c = await phase(id, { name: "Base", durationWeeks: 6 });
    await deleteSeasonAction({ seasonId: id });
    await updateTrainingCycle({ id: c, raceDate: "2027-10-10", raceDistance: "half" });
    const del = (await revisionsOf("season", id)).find((r) => r.action === "delete")!;
    await restorePlanRevision({ revisionId: del.id });
    expect(await db.select({ d: seasonRaces.raceDate, p: seasonRaces.priority }).from(seasonRaces).where(eq(seasonRaces.seasonId, id))).toEqual([{ d: "2027-10-10", p: "A" }]);
    expect((await seasonRow(id)).replanFlaggedAt).not.toBeNull();
  });

  it("an unchanged race does not flag the season", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race });
    await clearReplanAction({ seasonId: id });
    await phase(id, { name: "Base", durationWeeks: 6 });
    await deleteSeasonAction({ seasonId: id });
    const del = (await revisionsOf("season", id)).find((r) => r.action === "delete")!;
    await restorePlanRevision({ revisionId: del.id });
    expect((await seasonRow(id)).replanFlaggedAt).toBeNull();
  });
});

describe("the phase cap on restore (re-review 3)", () => {
  it("refuses a restore that would put a 31st phase in the season, with a clear message", async () => {
    const id = await season();
    const first = await phase(id, { name: "P1", durationWeeks: 1 });
    const inSeason = await lastRevision("cycle", first);
    await removePhaseAction({ seasonId: id, cycleId: first });
    for (let i = 2; i <= 31; i++) await phase(id, { name: `P${i}`, durationWeeks: 1 });
    const r = await restorePlanRevision({ revisionId: inSeason.id });
    expect(r).toMatchObject({ success: false, error: expect.stringContaining("at most 30") });
    expect((await cycleRow(first)).seasonId).toBeNull();
  });
});

describe("lock order (re-review 2)", () => {
  it("a cycle restore and a season write on the same season both finish", async () => {
    const id = await season();
    const a = await phase(id, { name: "A", durationWeeks: 4 });
    const b = await phase(id, { name: "B", durationWeeks: 4 });
    const before = await lastRevision("cycle", b);
    await setPhaseAction({ seasonId: id, cycleId: b, durationWeeks: 6 });
    for (let i = 0; i < 5; i++) {
      const results = await Promise.all([
        restorePlanRevision({ revisionId: before.id }),
        setPhaseAction({ seasonId: id, cycleId: a, durationWeeks: 4 + (i % 2) }),
      ]);
      for (const r of results) expect(r.success, r.success ? "" : r.error).toBe(true);
    }
  });
});

describe("a deleted season frees its cycles (review 1, 16)", () => {
  it("puts the A race back on its phases, frees them for another season, and takes it again on restore", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race });
    const c = await phase(id, { name: "Base", durationWeeks: 6 });
    await deleteSeasonAction({ seasonId: id });

    expect(await cycleRow(c)).toMatchObject({ raceDate: "2027-08-22", raceDistance: "half" });
    expect((await seasonlessCycles(me)).map((x) => x.id)).toContain(c);
    expect((await updateTrainingCycle({ id: c, raceDate: "2027-09-01", raceDistance: "full" })).success).toBe(true);
    const another = await season();
    expect((await addPhaseAction({ seasonId: another, cycleId: c })).success).toBe(true);
    expect(await cycleRow(c)).toMatchObject({ seasonId: another, raceDate: null });
  });

  it("a restored season takes its phases' races back", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race });
    const c = await phase(id, { name: "Base", durationWeeks: 6 });
    await deleteSeasonAction({ seasonId: id });
    expect((await cycleRow(c)).raceDate).toBe("2027-08-22");
    const del = await lastRevision("season", id);
    expect((await restorePlanRevision({ revisionId: del.id })).success).toBe(true);
    expect(await cycleRow(c)).toMatchObject({ seasonId: id, raceDate: null, raceDistance: null });
  });

  it("clears the start the chain scheduled for the next phase", async () => {
    const id = await season();
    const one = await phase(id, { name: "Base", durationWeeks: 4 });
    const two = await phase(id, { name: "Build", durationWeeks: 4 });
    await startTrainingCycle(one);
    expect((await cycleRow(two)).scheduledStartDate).toBe(day(28));
    await deleteSeasonAction({ seasonId: id });
    expect((await cycleRow(two)).scheduledStartDate).toBeNull();
  });
});

describe("a phase length changes only through the season (review 2)", () => {
  it("refuses a length change of a phase in the cycle action and over MCP", async () => {
    const id = await season();
    const c = await phase(id, { name: "Base", durationWeeks: 4 });
    const app = await updateTrainingCycle({ id: c, durationWeeks: 8 });
    expect(app).toMatchObject({ success: false, error: expect.stringContaining("season") });
    const mcp = await mcpTools(registerCycleTools, me)("manage_training_cycle", { operation: "update", cycleId: c, durationWeeks: 8, reason: "x", expectedVersion: (await cycleRow(c)).version });
    expect(mcp.raw).toContain("set_phase");
    expect((await cycleRow(c)).durationWeeks).toBe(4);
  });
});

describe("restores keep the chain (review 3, 4, 13)", () => {
  it("restoring a phase to its old length moves the next start back", async () => {
    const id = await season();
    const one = await phase(id, { name: "Base", durationWeeks: 4 });
    const two = await phase(id, { name: "Build", durationWeeks: 4 });
    await startTrainingCycle(one);
    const before = await lastRevision("cycle", one);
    await setPhaseAction({ seasonId: id, cycleId: one, durationDays: 42 });
    expect((await cycleRow(two)).scheduledStartDate).toBe(day(42));
    expect((await restorePlanRevision({ revisionId: before.id })).success).toBe(true);
    expect((await cycleRow(one)).durationDays).toBeNull();
    expect((await cycleRow(two)).scheduledStartDate).toBe(day(28));
  });

  it("restoring a cycle into its season again touches the season and keeps positions dense", async () => {
    const id = await season();
    const a = await phase(id, { name: "A", durationWeeks: 4 });
    await phase(id, { name: "B", durationWeeks: 4 });
    const inSeason = await lastRevision("cycle", a);
    await removePhaseAction({ seasonId: id, cycleId: a });
    const v = (await seasonRow(id)).version;
    expect((await restorePlanRevision({ revisionId: inSeason.id })).success).toBe(true);
    expect((await seasonRow(id)).version).toBe(v + 1);
    const orders = (await db.select({ o: trainingCycles.phaseOrder }).from(trainingCycles).where(eq(trainingCycles.seasonId, id))).map((r) => r.o).sort();
    expect(orders).toEqual([1, 2]);
  });

  it("restoring a cycle whose season was purged leaves it with no season", async () => {
    const id = await season();
    const c = await phase(id, { name: "A", durationWeeks: 4 });
    const inSeason = await lastRevision("cycle", c);
    await deleteSeasonAction({ seasonId: id });
    await db.update(seasons).set({ deletedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(seasons.id, id));
    await purgePlanRevisions();
    const r = await restorePlanRevision({ revisionId: inSeason.id });
    expect(r.success, r.success ? "" : r.error).toBe(true);
    expect(await cycleRow(c)).toMatchObject({ seasonId: null, phaseOrder: null });
  });
});

describe("the re-plan flag on undo (review 5, 15)", () => {
  it("restoring to before a clear brings the flag back", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race });
    const flagged = await lastRevision("season", id);
    await clearReplanAction({ seasonId: id });
    expect((await seasonRow(id)).replanFlaggedAt).toBeNull();
    expect((await restorePlanRevision({ revisionId: flagged.id })).success).toBe(true);
    expect(await seasonRow(id)).toMatchObject({ replanReason: expect.stringContaining("added") });
    expect((await seasonRow(id)).replanFlaggedAt).not.toBeNull();
  });

  it("clearing a flag that is not set writes nothing", async () => {
    const id = await season();
    const n = (await revisionsOf("season", id)).length;
    expect((await clearReplanAction({ seasonId: id })).success).toBe(true);
    expect(await revisionsOf("season", id)).toHaveLength(n);
    expect((await seasonRow(id)).version).toBe(1);
  });
});

describe("resume under the lock (review 14)", () => {
  it("refuses a stale version, and a resume bumps the version with a revision", async () => {
    const id = await season();
    const one = await phase(id, { name: "Base", durationWeeks: 4 });
    await phase(id, { name: "Build", durationWeeks: 4 });
    const v = (await seasonRow(id)).version;
    await expect(resumeSeason({ userId: me, writer: "user" }, id, v - 1)).rejects.toThrow(/Conflict/);
    const done = await resumeSeason({ userId: me, writer: "user" }, id, v);
    expect(done).toMatchObject({ cycleId: one, startsOn: day(0), version: v + 1 });
    expect((await lastRevision("season", id)).action).toBe("update");
    expect((await cycleRow(one)).status).toBe("active");
  });
});

describe("catch-up after a long absence (review 12)", () => {
  it("starts every phase that is due, up to the current one", async () => {
    const id = await season(day(-40));
    const one = await phase(id, { name: "One", durationWeeks: 2 });
    const two = await phase(id, { name: "Two", durationWeeks: 2 });
    const three = await phase(id, { name: "Three", durationWeeks: 4 });
    await startTrainingCycle(one);
    // Forty days ago: phase one started, and phase two was chained for day 14.
    await db.update(trainingCycles).set({ startDate: day(-40) }).where(eq(trainingCycles.id, one));
    await db.update(trainingCycles).set({ scheduledStartDate: day(-26) }).where(eq(trainingCycles.id, two));
    const active = await getActiveCycleForUser();
    expect(active.success && active.data?.cycle.id).toBe(three);
    expect(await cycleRow(two)).toMatchObject({ status: "completed", startDate: day(-26) });
    expect(await cycleRow(three)).toMatchObject({ status: "active", startDate: day(-12) });
  });
});

describe("MCP (review 11, 17)", () => {
  it("list_training_cycles gives each cycle the race it reads", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race });
    const c = await phase(id, { name: "Base", durationWeeks: 4 });
    const list = await mcpTools(registerCycleTools, me)("list_training_cycles");
    const row = list.data.find((x: { id: number }) => x.id === c);
    expect(row).toMatchObject({ seasonId: id, race: { raceDate: "2027-08-22", source: "season" } });
  });

  it("add_phase refuses another user's cycle and changes nothing", async () => {
    const id = await season();
    const theirs = await cycle(other);
    const r = await mcpTools(registerSeasonTools, me)("manage_season", { operation: "add_phase", seasonId: id, cycleId: theirs, cycleVersion: 1, reason: "x", expectedVersion: 1 });
    expect(r.raw).toContain("not found");
    expect((await cycleRow(theirs)).seasonId).toBeNull();
    expect((await seasonRow(id)).version).toBe(1);
  });
});

