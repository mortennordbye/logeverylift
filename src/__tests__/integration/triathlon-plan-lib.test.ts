import { db } from "@/db";
import { athleteProfiles, planRevisions, programs, seasons, trainingCycles } from "@/db/schema";
import { PlanStateError } from "@/lib/plan-revisions";
import { createTriathlonPlan } from "@/lib/triathlon-plan";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { and, asc, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";

/**
 * createTriathlonPlan, the library behind the generateTriathlonPlan Server
 * Action, called with a userId and no browser session (as the demo seed calls it).
 */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  // The plan needs an endurance level and training days; Fri and Sat off are the plan's own rest days.
  await db.insert(athleteProfiles).values({ userId: me, enduranceLevel: "intermediate" as const, availableDays: [1, 2, 3, 4, 7] });
});

const input = {
  name: "Half 2027",
  goal: "Finish the race",
  startDate: day(9),
  race: { name: "Haugesund 70.3", raceDate: day(250), distance: "half" as const },
};

describe("createTriathlonPlan for a userId", () => {
  it("writes the season, its phases and phase-named programs for that user, with the context's writer", async () => {
    const { seasonId } = await createTriathlonPlan({ userId: me, writer: "assistant", reason: "Seed" }, input);

    expect((await db.select().from(seasons).where(eq(seasons.id, seasonId)))[0]).toMatchObject({ userId: me, name: "Half 2027", endDate: day(250) });
    const phases = await db.select().from(trainingCycles).where(eq(trainingCycles.seasonId, seasonId)).orderBy(asc(trainingCycles.phaseOrder));
    expect(phases.map((p) => p.phaseType)).toEqual(["general", "base", "build", "peak", "taper"]);
    expect(phases.map((p) => p.scheduledStartDate)).toEqual([day(9), null, null, null, null]);

    const owned = await db.select({ name: programs.name, userId: programs.userId }).from(programs).where(inArray(programs.createdByCycleId, phases.map((p) => p.id)));
    expect(owned.every((p) => p.userId === me)).toBe(true);
    expect(owned.map((p) => p.name)).toContain("Base · Long Run");

    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, seasonId)));
    expect(rev).toMatchObject({ userId: me, writer: "assistant", reason: "Seed" });
  });

  it("refuses a user without endurance features, and writes nothing", async () => {
    const lifter = (await createUser()).id;
    await expect(createTriathlonPlan({ userId: lifter, writer: "user" }, input)).rejects.toThrow(PlanStateError);
    expect(await db.select().from(seasons).where(eq(seasons.userId, lifter))).toEqual([]);
  });
});
