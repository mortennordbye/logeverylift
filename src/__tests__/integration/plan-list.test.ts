import { db } from "@/db";
import { planRevisions, programs, seasons, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { updateRotationSession } from "@/lib/actions/planned-sessions";
import { startTrainingCycle } from "@/lib/actions/training-cycles";
import { dayMonth } from "@/lib/home/labels";
import { loadPlanList } from "@/lib/plan-list";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { todayIn } from "@/lib/utils/user-date";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("rotation chips show a swapped session's program and mark a skipped one, as the footer does", async () => {
    const upperA = await program("Upper A");
    const lowerA = await program("Lower A");
    const upperB = await program("Upper B");
    const lowerB = await program("Lower B");
    const [rotation] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Upper / Lower", durationWeeks: 6, scheduleType: "rotation", status: "active", startDate: day(-3) })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: rotation.id, orderIndex: 1, programId: upperA },
      { trainingCycleId: rotation.id, orderIndex: 2, programId: lowerA },
      { trainingCycleId: rotation.id, orderIndex: 3, programId: upperB },
      { trainingCycleId: rotation.id, orderIndex: 4, programId: null },
    ]);
    await createSession(userId, upperA, { date: day(-3), isCompleted: true });
    // Position 2 (index 1) swapped to Lower B, position 3 skipped.
    expect((await updateRotationSession({ op: "change", cycleId: rotation.id, rotationPosition: 1, programId: lowerB })).success).toBe(true);
    expect((await updateRotationSession({ op: "skip", cycleId: rotation.id, rotationPosition: 2 })).success).toBe(true);

    const data = await loadPlanList(userId, false);
    expect(data.hero).toMatchObject({ kind: "rotation", next: "Lower B" });
    expect(data.hero?.kind === "rotation" && data.hero.chips.map((c) => [c.name, c.tag])).toEqual([
      ["Upper A", "Done"],
      ["Lower B", "Next"],
      ["Upper B", "Skipped"],
      ["Rest", null],
    ]);
  });

  it("dates a cycle another start ended early by the day before the day it completed, not today", async () => {
    const me = (await createUser({ timeZone: "UTC" })).id;
    asUser(me);
    const utcDay = (offset: number) => toDateStr(addDays(todayIn("UTC"), offset));
    const [running] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Ended early", durationWeeks: 8, status: "active", startDate: utcDay(-20) })
      .returning();
    const [next] = await db.insert(trainingCycles).values({ userId: me, name: "Next", durationWeeks: 4 }).returning();
    expect((await startTrainingCycle(next.id)).success).toBe(true);
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, running.id)))[0].status).toBe("completed");
    // It completed a day ago: the row says the day before that, and stays put as days pass.
    await db
      .update(planRevisions)
      .set({ createdAt: new Date(Date.now() - 86_400_000) })
      .where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, running.id)));

    const data = await loadPlanList(me, false);
    expect(data.past.map((r) => r.sub)).toEqual([`8 weeks · ended early on ${dayMonth(utcDay(-2))}`]);
  });

  it("lists the running season above one that has not started", async () => {
    await db.insert(seasons).values([
      { userId, name: "Later", startDate: day(100), endDate: day(300) },
      { userId, name: "Now", startDate: day(-10), endDate: day(90) },
      { userId, name: "Much later", startDate: day(400), endDate: day(500) },
    ]);
    const data = await loadPlanList(userId, false);
    expect(data.seasons.map((s) => s.name)).toEqual(["Now", "Later", "Much later"]);
  });
});

describe("the hero week strip", () => {
  afterEach(() => vi.useRealTimers());

  it("is the block week from the cycle's start day, the same 7 days the detail shows", async () => {
    // Sat 14 Nov 2026: the block starts today, a Saturday, with a session on Mondays.
    const me = (await createUser({ timeZone: "UTC" })).id;
    asUser(me);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    const [p] = await db.insert(programs).values({ userId: me, name: "Strength A" }).returning();
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-14" })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 1, programId: p.id });

    const data = await loadPlanList(me, false);
    const hero = data.hero?.kind === "week" ? data.hero : null;
    expect(hero?.days.map((d) => d.date)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(hero?.days.map((d) => d.day)).toEqual(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(hero?.days.filter((d) => !d.rest).map((d) => d.date)).toEqual(["2026-11-16"]);
    expect(hero?.summary).toBe("1 session");
  });
});
