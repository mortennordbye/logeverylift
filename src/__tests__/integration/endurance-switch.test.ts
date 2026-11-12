import { db } from "@/db";
import { athleteProfiles, exercises, programExercises, programs, trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { setUserEndurance } from "@/lib/actions/admin";
import { generateTriathlonPlan } from "@/lib/actions/triathlon-plan";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

let admin: string;
let athlete: string;

beforeEach(async () => {
  admin = (await createUser({ role: "admin" })).id;
  athlete = (await createUser()).id;
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
  it("refuses while the switch is off and writes nothing", async () => {
    asUser(athlete);
    const result = await generateTriathlonPlan({ weeks: 12 });
    expect(result.success).toBe(false);
    expect(await db.select().from(trainingCycles).where(eq(trainingCycles.userId, athlete))).toHaveLength(0);
  });

  it("builds the plan once the switch is on", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, athlete));
    asUser(athlete);
    const result = await generateTriathlonPlan({ weeks: 12 });
    expect(result.success).toBe(true);
    expect(await db.select().from(trainingCycles).where(eq(trainingCycles.userId, athlete))).toHaveLength(1);
  });

  it("builds the strength part from the profile's strength goal (docs/plans/athlete-profile.md, 2.7)", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, athlete));
    asUser(athlete);
    await db.insert(athleteProfiles).values({ userId: athlete, strengthGoal: "stronger" });
    const result = await generateTriathlonPlan({ weeks: 12 });
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    const names = await db
      .select({ name: exercises.name, program: programs.name })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(eq(programs.createdByCycleId, result.data.cycleId));
    expect(names.map((n) => n.name)).toEqual(expect.arrayContaining(["Box Jump", "Pogo Hops"]));

    await db.update(athleteProfiles).set({ strengthGoal: "minimal" }).where(eq(athleteProfiles.userId, athlete));
    const minimal = await generateTriathlonPlan({ weeks: 12 });
    if (!minimal.success) throw new Error(minimal.error);
    const slots = await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, minimal.data.cycleId));
    expect(slots.find((s) => s.dayOfWeek === 4)).toMatchObject({ programId: null, label: "Rest" });
  });
});
