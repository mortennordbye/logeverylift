import { db } from "@/db";
import { planRevisions, programExercises, programSets, programs, seasonRaces, seasons, trainingCycles } from "@/db/schema";
import { createSeasonAction } from "@/lib/actions/seasons";
import { generateTriathlonPlan } from "@/lib/actions/triathlon-plan";
import { getSeasonDetail } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { and, asc, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * New season (docs/plans/plan-tab-redesign.md, P4): "Make a triathlon plan"
 * writes a season whose phases end on race day, and "Use cycles I already
 * have" adds the picked cycles as phases.
 */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;
let other: string;
let lifter: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
  lifter = (await createUser()).id;
});

const phasesOf = (seasonId: number) =>
  db.select().from(trainingCycles).where(eq(trainingCycles.seasonId, seasonId)).orderBy(asc(trainingCycles.phaseOrder));

const plan = (startDate: string, raceDate: string) => ({
  name: "Half 2027",
  goal: "Finish the race",
  startDate,
  race: { name: "Haugesund 70.3", raceDate, distance: "half" as const },
});

async function makePlan(userId: string, startDate: string, raceDate: string) {
  asUser(userId);
  const r = await generateTriathlonPlan(plan(startDate, raceDate));
  if (!r.success) throw new Error(r.error);
  return r.data.seasonId;
}

describe("generateTriathlonPlan writes a season", () => {
  it("chains general, base, build, peak and taper phases, the taper ending on race day", async () => {
    const start = day(0);
    const raceDate = day(240);
    const seasonId = await makePlan(me, start, raceDate);

    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    expect(season).toMatchObject({ userId: me, name: "Half 2027", goal: "Finish the race", startDate: start, endDate: raceDate, replanFlaggedAt: null });
    expect(await db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId))).toEqual([
      expect.objectContaining({ userId: me, name: "Haugesund 70.3", raceDate, discipline: "triathlon", distance: "half", priority: "A" }),
    ]);

    const phases = await phasesOf(seasonId);
    expect(phases.map((p) => [p.phaseOrder, p.phaseType, p.status])).toEqual([
      [1, "general", "draft"],
      [2, "base", "draft"],
      [3, "build", "draft"],
      [4, "peak", "draft"],
      [5, "taper", "draft"],
    ]);
    expect(phases.every((p) => p.userId === me && p.goal === "build" && p.scheduleType === "day_of_week" && p.raceDate == null)).toBe(true);

    const detail = await getSeasonDetail(me, seasonId);
    expect(detail!.taperFit).toEqual({ status: "fits", taperId: phases[4].id });
    const timeline = detail!.phases;
    expect(timeline[0].start).toBe(start);
    for (let i = 1; i < timeline.length; i++) expect(timeline[i].start).toBe(addDaysStr(timeline[i - 1].end, 1));
    expect(timeline.at(-1)).toMatchObject({ phaseType: "taper", lengthDays: 10, end: raceDate });
    expect(detail!.overrunAfter).toBe(0);
  });

  it("gives each phase its own week, with week 1 on that phase's curve", async () => {
    const seasonId = await makePlan(me, day(0), day(240));
    const phases = await phasesOf(seasonId);
    const longRun = async (cycleId: number) => {
      const [row] = await db
        .select({ distance: programSets.distanceMeters, peak: programSets.peakDistanceMeters, userId: programs.userId })
        .from(programSets)
        .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
        .innerJoin(programs, eq(programs.id, programExercises.programId))
        .where(and(eq(programs.createdByCycleId, cycleId), eq(programs.name, "Long Run")));
      return row;
    };
    const general = await longRun(phases[0].id);
    const taper = await longRun(phases[4].id);
    expect(general.userId).toBe(me);
    // Same peak anchor; the general phase starts at 0.80 of it, the taper at 0.60.
    expect(taper.peak).toBe(general.peak);
    expect(general.distance).toBeGreaterThan(taper.distance!);
    const owned = await db.select({ id: programs.id }).from(programs).where(inArray(programs.createdByCycleId, phases.map((p) => p.id)));
    expect(owned.length).toBeGreaterThanOrEqual(5 * 4);
  });

  it("schedules the first phase for a season that starts later", async () => {
    const seasonId = await makePlan(me, day(9), day(250));
    const phases = await phasesOf(seasonId);
    expect(phases.map((p) => p.scheduledStartDate)).toEqual([day(9), null, null, null, null]);
  });

  it("is one change set of user revisions, and another user cannot read it", async () => {
    const seasonId = await makePlan(me, day(0), day(240));
    const revs = await db.select().from(planRevisions).where(eq(planRevisions.userId, me));
    expect(new Set(revs.map((r) => r.changeSetId)).size).toBe(1);
    expect(revs.every((r) => r.writer === "user")).toBe(true);
    expect(revs.filter((r) => r.objectType === "season").map((r) => r.objectId)).toEqual([seasonId]);
    expect(revs.filter((r) => r.objectType === "cycle")).toHaveLength(5);

    expect(await getSeasonDetail(other, seasonId)).toBeNull();
    expect(await db.select().from(trainingCycles).where(eq(trainingCycles.userId, other))).toHaveLength(0);
  });

  it("refuses a race too close, and the switch off, and writes nothing", async () => {
    asUser(me);
    expect(await generateTriathlonPlan(plan(day(0), day(20)))).toEqual({
      success: false,
      error: "A plan needs at least 6 weeks before the race. Pick an earlier start or a later race.",
    });
    asUser(lifter);
    expect((await generateTriathlonPlan(plan(day(0), day(240)))).success).toBe(false);
    expect(await db.select().from(seasons).where(inArray(seasons.userId, [me, lifter]))).toHaveLength(0);
    expect(await db.select().from(trainingCycles).where(inArray(trainingCycles.userId, [me, lifter]))).toHaveLength(0);
  });
});

describe("createSeasonAction with a race and cycles", () => {
  it("writes the first race with no re-plan flag, and adds the picked cycles as phases in order", async () => {
    const [a, b] = await db
      .insert(trainingCycles)
      .values([
        { userId: me, name: "Strength 5x5", durationWeeks: 8 },
        { userId: me, name: "Base block", durationWeeks: 6 },
      ])
      .returning();
    asUser(me);
    const r = await createSeasonAction({
      name: "Spring",
      startDate: day(0),
      endDate: day(120),
      race: { name: "Oslo 10K", raceDate: day(120), discipline: "run", distanceMeters: 10_000, priority: "A" },
      cycleIds: [b.id, a.id],
    });
    if (!r.success) throw new Error(r.error);
    const [season] = await db.select().from(seasons).where(eq(seasons.id, r.data.id));
    expect(season.replanFlaggedAt).toBeNull();
    expect(await db.select({ name: seasonRaces.name, priority: seasonRaces.priority }).from(seasonRaces).where(eq(seasonRaces.seasonId, season.id))).toEqual([
      { name: "Oslo 10K", priority: "A" },
    ]);
    expect((await phasesOf(season.id)).map((p) => [p.id, p.phaseOrder])).toEqual([
      [b.id, 1],
      [a.id, 2],
    ]);
  });

  it("refuses another user's cycle or a race with the switch off, and makes no season", async () => {
    const [theirs] = await db.insert(trainingCycles).values({ userId: other, name: "Theirs", durationWeeks: 4 }).returning();
    asUser(me);
    expect(await createSeasonAction({ name: "Mine", startDate: day(0), endDate: day(60), cycleIds: [theirs.id] })).toEqual({
      success: false,
      error: "Pick your own cycles that are in no season.",
    });
    asUser(lifter);
    const race = { name: "Run", raceDate: day(60), discipline: "run" as const, priority: "A" as const };
    expect((await createSeasonAction({ name: "Lift", startDate: day(0), endDate: day(60), race })).success).toBe(false);
    expect(await db.select().from(seasons).where(inArray(seasons.userId, [me, lifter]))).toHaveLength(0);
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, theirs.id)))[0].seasonId).toBeNull();
  });

  it("makes a goal season with no race for a gym user", async () => {
    asUser(lifter);
    const r = await createSeasonAction({ name: "Bench 120 kg", goal: "Bench 120 kg by summer", startDate: day(0), endDate: day(180) });
    expect(r.success).toBe(true);
  });
});
