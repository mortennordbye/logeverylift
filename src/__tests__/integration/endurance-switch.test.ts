import { db } from "@/db";
import { trainingCycles, users } from "@/db/schema";
import { setUserEndurance } from "@/lib/actions/admin";
import { generateTriathlonPlan } from "@/lib/actions/triathlon-plan";
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
});
