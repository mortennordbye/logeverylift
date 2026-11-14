import { db } from "@/db";
import { planRevisions, seasonRaces, seasons, trainingCycles } from "@/db/schema";
import { addPhaseAction, addRaceAction, clearReplanAction, createSeasonAction, removeRaceAction, updateRaceAction } from "@/lib/actions/seasons";
import { startTrainingCycle } from "@/lib/actions/training-cycles";
import { addPhase, createSeason } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { todayIn } from "@/lib/utils/user-date";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** Fixes from the second code review of the Plan redesign branch. */

const day = (offset: number) => toDateStr(addDays(todayIn("UTC"), offset));
let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
});

const seasonsOf = (userId: string) => db.select().from(seasons).where(eq(seasons.userId, userId));
const seasonRow = async (id: number) => (await db.select().from(seasons).where(eq(seasons.id, id)))[0];
const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];
const racesOf = (id: number) => db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, id)).orderBy(asc(seasonRaces.id));

async function draft(name = "Block") {
  const [c] = await db.insert(trainingCycles).values({ userId: me, name, durationWeeks: 4 }).returning();
  return c.id;
}

describe("New season with cycles I already have is one change", () => {
  it("refuses the same cycle twice and makes no season", async () => {
    const c = await draft();
    const r = await createSeasonAction({ name: "Twice", startDate: day(0), endDate: day(100), cycleIds: [c, c] });
    expect(r.success).toBe(false);
    expect(await seasonsOf(me)).toEqual([]);
    expect((await cycleRow(c)).seasonId).toBeNull();
  });

  it("a phase add that fails leaves no season, no race and no earlier phase", async () => {
    const a = await draft("A");
    // Completed after the form listed it: the add refuses it inside the write.
    const [done] = await db.insert(trainingCycles).values({ userId: me, name: "Done", durationWeeks: 4, status: "completed", startDate: day(-60) }).returning();
    await expect(
      createSeason(
        { userId: me, writer: "user" },
        {
          name: "Half",
          startDate: day(0),
          endDate: day(100),
          race: { name: "Half", raceDate: day(100), discipline: "triathlon", distance: "half", priority: "A" },
          cycleIds: [a, done.id],
        },
      ),
    ).rejects.toThrow();
    expect(await seasonsOf(me)).toEqual([]);
    expect(await db.select().from(seasonRaces).where(eq(seasonRaces.userId, me))).toEqual([]);
    expect((await cycleRow(a)).seasonId).toBeNull();
    expect(await db.select().from(planRevisions).where(and(eq(planRevisions.userId, me), eq(planRevisions.objectType, "season")))).toEqual([]);
  });

  it("joins the picked cycles in order, and stores one create revision for the season", async () => {
    const a = await draft("A");
    const b = await draft("B");
    const r = await createSeasonAction({ name: "Both", startDate: day(0), endDate: day(100), cycleIds: [a, b] });
    if (!r.success) throw new Error(r.error);
    expect(await cycleRow(a)).toMatchObject({ seasonId: r.data.id, phaseOrder: 1 });
    expect(await cycleRow(b)).toMatchObject({ seasonId: r.data.id, phaseOrder: 2 });
    const revs = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, r.data.id)));
    expect(revs.map((x) => x.action)).toEqual(["create"]);
  });

  it("refreshes home, whose up-next card a first phase can change", async () => {
    vi.mocked(revalidatePath).mockClear();
    const r = await createSeasonAction({ name: "Home", startDate: day(0), endDate: day(100), cycleIds: [await draft()] });
    expect(r.success).toBe(true);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/");
  });
});

describe("the first race of a new season gets the race date checks", () => {
  const race = { name: "Tune-up", discipline: "triathlon" as const, distance: "sprint" as const };

  it("refuses a B race after the season end, a past race and one before the start", async () => {
    for (const r of [
      { ...race, raceDate: day(60), priority: "B" as const },
      { ...race, raceDate: day(-1), priority: "A" as const },
      { ...race, raceDate: day(5), priority: "B" as const },
    ]) {
      const out = await createSeasonAction({ name: "Season", startDate: day(10), endDate: day(30), race: r });
      expect(out).toMatchObject({ success: false, fieldErrors: { raceDate: [expect.any(String)] } });
    }
    expect(await seasonsOf(me)).toEqual([]);
  });

  it("an A race after the end moves the end to race day", async () => {
    const out = await createSeasonAction({ name: "Season", startDate: day(0), endDate: day(30), race: { ...race, raceDate: day(60), priority: "A" } });
    if (!out.success) throw new Error(out.error);
    expect((await seasonRow(out.data.id)).endDate).toBe(day(60));
  });
});

describe("removing a race clears only its own re-plan lines", () => {
  const race = { name: "Race", discipline: "triathlon" as const, distance: "half" as const };

  async function season() {
    const r = await createSeasonAction({ name: "Season", startDate: day(0), endDate: day(200) });
    if (!r.success) throw new Error(r.error);
    return r.data.id;
  }

  it("keeps the line about the A race named Race when a B race named Race goes", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race, raceDate: day(150), priority: "A" });
    await addRaceAction({ seasonId: id, ...race, raceDate: day(60), priority: "B" });
    await clearReplanAction({ seasonId: id });
    const [a, b] = await racesOf(id);
    await updateRaceAction({ seasonId: id, raceId: a.id, raceDate: day(160) });
    const reason = (await seasonRow(id)).replanReason;
    expect(reason).toContain('The A race "Race" moved');

    expect((await removeRaceAction({ seasonId: id, raceId: b.id })).success).toBe(true);
    expect(await seasonRow(id)).toMatchObject({ replanFlaggedAt: expect.any(Date), replanReason: reason });
  });

  it("drops only the removed race's line when one change named two races of the same name", async () => {
    const id = await season();
    await addRaceAction({ seasonId: id, ...race, raceDate: day(150), priority: "A" });
    await clearReplanAction({ seasonId: id });
    // A new A race makes the old one a B race: one line about each.
    await addRaceAction({ seasonId: id, ...race, raceDate: day(170), priority: "A" });
    const [old, added] = await racesOf(id);
    expect(old.priority).toBe("B");
    expect((await seasonRow(id)).replanReason?.split("; ")).toHaveLength(2);

    await removeRaceAction({ seasonId: id, raceId: old.id });
    const row = await seasonRow(id);
    expect(row.replanFlaggedAt).not.toBeNull();
    expect(row.replanReason).toMatch(/^The A race "Race" added on /);
    expect(row.replanReason).not.toContain("priority");

    await removeRaceAction({ seasonId: id, raceId: added.id });
    expect((await seasonRow(id)).replanReason).toMatch(/removed$/);
  });
});

describe("addPhase takes the scheduled start only when asked", () => {
  it("a first phase with no takeStart leaves the running block and the other scheduled start", async () => {
    const s = await createSeasonAction({ name: "Running", startDate: day(0), endDate: day(200) });
    if (!s.success) throw new Error(s.error);
    const p1 = await addPhaseAction({ seasonId: s.data.id, name: "Base", durationWeeks: 6 });
    const p2 = await addPhaseAction({ seasonId: s.data.id, name: "Build", durationWeeks: 4 });
    if (!p1.success || !p2.success) throw new Error("phase");
    expect((await startTrainingCycle(p1.data.cycleId)).success).toBe(true);
    expect((await cycleRow(p2.data.cycleId)).scheduledStartDate).toBe(day(42));

    const later = await createSeasonAction({ name: "Later", startDate: day(2), endDate: day(150) });
    if (!later.success) throw new Error(later.error);
    const first = await addPhase({ userId: me, writer: "user" }, later.data.id, { name: "General", durationWeeks: 4 });
    expect((await cycleRow(first.cycleId)).scheduledStartDate).toBeNull();
    expect((await cycleRow(p2.data.cycleId)).scheduledStartDate).toBe(day(42));
  });
});
