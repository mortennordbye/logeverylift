import { db } from "@/db";
import { garminActivities, garminFuelLogs, trainingCycles } from "@/db/schema";
import { saveFuelLog } from "@/lib/actions/garmin";
import { getActivityDetail, getRaceData } from "@/lib/garmin/queries";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** The fuel and fluid log and the race page reads, against a real database. */

async function longRide(userId: string, id: number) {
  await db.insert(garminActivities).values({
    userId,
    garminActivityId: id,
    startTimeLocal: new Date(Date.now() - 3 * 86_400_000),
    activityType: "cycling",
    data: { activityName: "Long ride", duration: 3 * 3600, waterEstimated: 2400 },
  });
}

describe("saveFuelLog", () => {
  it("saves, updates and clears the log for the user's own session", async () => {
    const me = await createUser();
    await longRide(me.id, 31);
    asUser(me.id);

    expect((await saveFuelLog({ activityId: 31, carbsG: 180, fluidMl: 1500 })).success).toBe(true);
    expect((await saveFuelLog({ activityId: 31, carbsG: 200, fluidMl: 1500 })).success).toBe(true);
    let rows = await db.select().from(garminFuelLogs).where(eq(garminFuelLogs.userId, me.id));
    expect(rows).toEqual([expect.objectContaining({ garminActivityId: 31, carbsG: 200, fluidMl: 1500 })]);
    expect((await getActivityDetail(me.id, 31))?.fuel).toEqual({ carbsG: 200, fluidMl: 1500 });

    await saveFuelLog({ activityId: 31, carbsG: null, fluidMl: null });
    rows = await db.select().from(garminFuelLogs).where(eq(garminFuelLogs.userId, me.id));
    expect(rows).toEqual([]);
  });

  it("refuses another user's session and bad numbers", async () => {
    const owner = await createUser();
    await longRide(owner.id, 32);
    asUser((await createUser()).id);
    expect(await saveFuelLog({ activityId: 32, carbsG: 100, fluidMl: null })).toEqual({ success: false, error: "Activity not found" });
    asUser(owner.id);
    expect((await saveFuelLog({ activityId: 32, carbsG: -5, fluidMl: null })).success).toBe(false);
    expect(await db.select().from(garminFuelLogs).where(eq(garminFuelLogs.userId, owner.id))).toEqual([]);
  });
});

describe("getRaceData", () => {
  it("is null without an active cycle, and lists long sessions with their fuel log", async () => {
    const me = await createUser();
    expect(await getRaceData(me.id)).toBeNull();

    await longRide(me.id, 33);
    asUser(me.id);
    await saveFuelLog({ activityId: 33, carbsG: 210, fluidMl: 1800 });
    await db.insert(trainingCycles).values({ userId: me.id, name: "IM", durationWeeks: 24, status: "active", startDate: "2026-09-07", raceDate: "2027-02-21", raceDistance: "full" });

    const r = (await getRaceData(me.id))!;
    expect(r.race).toMatchObject({ raceSet: true, distance: "full" });
    expect(r.taperStart).toBe("2027-02-01");
    expect(r.fuel).toEqual([expect.objectContaining({ id: 33, sweatMl: 2400, carbsG: 210, fluidMl: 1800, durationS: 10800 })]);
  });
});
