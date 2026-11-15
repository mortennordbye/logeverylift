import { db } from "@/db";
import { athleteProfiles, exercises, programExercises, programs, trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { setUserEndurance } from "@/lib/actions/admin";
import { generateTriathlonPlan } from "@/lib/actions/triathlon-plan";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

let admin: string;
let athlete: string;

beforeEach(async () => {
  admin = (await createUser({ role: "admin" })).id;
  athlete = (await createUser()).id;
  // The plan needs an endurance level and training days; Fri and Sat off are the plan's own rest days.
  await db.insert(athleteProfiles).values({ userId: athlete, enduranceLevel: "intermediate" as const, availableDays: [1, 2, 3, 4, 7] });
});

describe("setUserEndurance", () => {
  it("lets an admin turn a user's endurance features on and off", async () => {
    asUser(admin, "admin");
    expect((await setUserEndurance({ userId: athlete, enabled: true })).success).toBe(true);
    expect(await enduranceEnabledFor(athlete)).toBe(true);
    expect((await setUserEndurance({ userId: athlete, enabled: false })).success).toBe(true);
    expect(await enduranceEnabledFor(athlete)).toBe(false);
  });

  it("refuses a user who is not an admin, even for their own account", async () => {
    asUser(athlete);
    const result = await setUserEndurance({ userId: athlete, enabled: true });
    expect(result.success).toBe(false);
    expect(await enduranceEnabledFor(athlete)).toBe(false);
  });

  it("does not take the role as the switch: an admin without it is off", async () => {
    expect(await enduranceEnabledFor(admin)).toBe(false);
  });
});

describe("the race on a cycle", () => {
  const newCycle = async (raceDate: string | null = null) =>
    (await db.insert(trainingCycles).values({ userId: athlete, name: "Block", durationWeeks: 8, raceDate }).returning())[0];
  const raceOf = async (id: number) =>
    (await db.select({ r: trainingCycles.raceDate }).from(trainingCycles).where(eq(trainingCycles.id, id)))[0].r;

  it("cannot be added while the switch is off", async () => {
    const cycle = await newCycle();
    asUser(athlete);
    const result = await updateTrainingCycle({ id: cycle.id, raceDate: "2027-08-15", raceDistance: "half" });
    expect(result.success).toBe(false);
    expect(await raceOf(cycle.id)).toBeNull();
  });

  it("still saves the rest of the form, and a race the cycle already has stays editable", async () => {
    const plain = await newCycle();
    const raced = await newCycle("2027-08-15");
    asUser(athlete);
    expect((await updateTrainingCycle({ id: plain.id, name: "Renamed", raceDate: null, raceDistance: null })).success).toBe(true);
    expect((await updateTrainingCycle({ id: raced.id, raceDate: "2027-08-22" })).success).toBe(true);
    expect(await raceOf(raced.id)).toBe("2027-08-22");
  });

  it("can be added once the switch is on", async () => {
    const cycle = await newCycle();
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, athlete));
    asUser(athlete);
    expect((await updateTrainingCycle({ id: cycle.id, raceDate: "2027-08-15" })).success).toBe(true);
    expect(await raceOf(cycle.id)).toBe("2027-08-15");
  });
});

describe("generateTriathlonPlan", () => {
  const plan = { name: "Half 2027", startDate: "2027-01-04", race: { name: "Haugesund 70.3", raceDate: "2027-06-27", distance: "half" } };
  /** The first phase of the season the plan made. */
  const firstPhase = async (seasonId: number) =>
    (await db.select({ id: trainingCycles.id }).from(trainingCycles).where(and(eq(trainingCycles.seasonId, seasonId), eq(trainingCycles.phaseOrder, 1))))[0].id;

  it("refuses while the switch is off and writes nothing", async () => {
    asUser(athlete);
    const result = await generateTriathlonPlan(plan);
    expect(result.success).toBe(false);
    expect(await db.select().from(trainingCycles).where(eq(trainingCycles.userId, athlete))).toHaveLength(0);
  });

  it("refuses without an endurance level and training days, as the form says", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, athlete));
    await db.update(athleteProfiles).set({ availableDays: null }).where(eq(athleteProfiles.userId, athlete));
    asUser(athlete);
    expect(await generateTriathlonPlan(plan)).toEqual({ success: false, error: "Set your endurance level and training days in Account first." });
    await db.update(athleteProfiles).set({ availableDays: [1, 2, 3, 4, 7], enduranceLevel: null }).where(eq(athleteProfiles.userId, athlete));
    expect((await generateTriathlonPlan(plan)).success).toBe(false);
    expect(await db.select().from(trainingCycles).where(eq(trainingCycles.userId, athlete))).toHaveLength(0);
  });

  it("builds the plan once the switch is on", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, athlete));
    asUser(athlete);
    const result = await generateTriathlonPlan(plan);
    expect(result.success).toBe(true);
    expect(await db.select().from(trainingCycles).where(eq(trainingCycles.userId, athlete))).toHaveLength(5);
  });

  it("builds the strength part from the profile's strength goal (docs/plans/athlete-profile.md, 2.7)", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, athlete));
    asUser(athlete);
    await db.update(athleteProfiles).set({ strengthGoal: "stronger" }).where(eq(athleteProfiles.userId, athlete));
    const result = await generateTriathlonPlan(plan);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    const names = await db
      .select({ name: exercises.name, program: programs.name })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(eq(programs.createdByCycleId, await firstPhase(result.data.seasonId)));
    expect(names.map((n) => n.name)).toEqual(expect.arrayContaining(["Box Jump", "Pogo Hops"]));

    // Free every day, so no rest day moves a session onto Thursday.
    await db.update(athleteProfiles).set({ strengthGoal: "minimal", availableDays: [1, 2, 3, 4, 5, 6, 7] }).where(eq(athleteProfiles.userId, athlete));
    const minimal = await generateTriathlonPlan(plan);
    if (!minimal.success) throw new Error(minimal.error);
    const slots = await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, await firstPhase(minimal.data.seasonId)));
    expect(slots.find((s) => s.dayOfWeek === 4)).toMatchObject({ programId: null, label: "Rest" });
  });
});
