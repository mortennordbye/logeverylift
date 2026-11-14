import { db } from "@/db";
import { programs, seasons, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { loadPlanList } from "@/lib/plan-list";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, createUser } from "./factories";
import { asUser } from "./setup";

/** The Plan list's reads (docs/plans/plan-tab-redesign.md, P1): the hero, the sections and what stays out of them. */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let userId: string;

async function program(name: string) {
  const [p] = await db.insert(programs).values({ userId, name }).returning();
  return p.id;
}

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
});

describe("loadPlanList", () => {
  it("is empty with no cycle and no season", async () => {
    const data = await loadPlanList(userId, false);
    expect(data).toMatchObject({ empty: true, hero: null, seasons: [], upNext: [], past: [] });
  });

  it("a running rotation: the last session done and the next one, then up next and past cycles", async () => {
    const upper = await program("Upper A");
    const lower = await program("Lower A");
    const [rotation] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Upper / Lower", durationWeeks: 6, scheduleType: "rotation", status: "active", startDate: day(-3) })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: rotation.id, orderIndex: 1, programId: upper },
      { trainingCycleId: rotation.id, orderIndex: 2, programId: lower },
      { trainingCycleId: rotation.id, orderIndex: 3, programId: null },
    ]);
    // Upper A done on the first day; Lower A not done since, so it is next.
    await createSession(userId, upper, { date: day(-3), isCompleted: true });
    await db.insert(trainingCycles).values([
      { userId, name: "Strength peak", durationWeeks: 4, scheduledStartDate: day(60) },
      { userId, name: "Intro", durationWeeks: 4, status: "completed", startDate: day(-60) },
    ]);

    const data = await loadPlanList(userId, false);
    expect(data.empty).toBe(false);
    expect(data.hero).toMatchObject({ kind: "rotation", id: rotation.id, label: "Week 1 of 6 · Rotation", next: "Lower A" });
    expect(data.hero?.kind === "rotation" && data.hero.chips.map((c) => [c.name, c.tag])).toEqual([
      ["Upper A", "Done"],
      ["Lower A", "Next"],
      ["Rest", null],
    ]);
    expect(data.upNext.map((r) => r.name)).toEqual(["Strength peak"]);
    expect(data.upNext[0].starts).toMatch(/^Starts \d+ \w{3}$/);
    expect(data.past.map((r) => r.name)).toEqual(["Intro"]);
    expect(data.select.current.map((r) => r.id)).toEqual([rotation.id]);
  });

  it("a season's phases sit in its card, not in Up next; the scheduled phase is the hero", async () => {
    const lift = await program("Strength A");
    // The next Monday at least a day ahead, so the hero's week is the block's first.
    const monday = (8 - new Date().getDay()) % 7 || 7;
    const [season] = await db.insert(seasons).values({ userId, name: "Half 2027", startDate: day(monday), endDate: day(200) }).returning();
    const [first] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Base", durationWeeks: 8, seasonId: season.id, phaseOrder: 1, phaseType: "base", scheduledStartDate: day(monday) })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: first.id, dayOfWeek: 1, programId: lift });
    await db.insert(trainingCycles).values({ userId, name: "Build", durationWeeks: 8, seasonId: season.id, phaseOrder: 2, phaseType: "build" });

    const data = await loadPlanList(userId, true);
    expect(data.hero).toMatchObject({ kind: "week", id: first.id, ends: expect.stringMatching(/^Ends /) });
    expect(data.hero?.kind === "week" && data.hero.days.filter((d) => !d.rest).map((d) => d.day)).toEqual(["Mon"]);
    expect(data.seasons).toHaveLength(1);
    expect(data.seasons[0].phases.map((p) => p.name)).toEqual(["Base", "Build"]);
    expect(data.upNext).toEqual([]);
    expect(data.select.upNext).toEqual([]);

    // A season that is over moves to Past seasons, and its phases show as cycles.
    await db.update(seasons).set({ startDate: day(-300), endDate: day(-100) }).where(eq(seasons.id, season.id));
    const later = await loadPlanList(userId, true);
    expect(later.seasons).toEqual([]);
    expect(later.pastSeasons.map((s) => s.name)).toEqual(["Half 2027"]);
    expect(later.upNext.map((r) => r.name)).toEqual(["Build"]);
  });
});
