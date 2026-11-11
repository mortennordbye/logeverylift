import { db } from "@/db";
import { garminActivities, garminActivityMetrics, garminActivityStreams, garminDays, trainingCycles } from "@/db/schema";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import { getOverviewData } from "@/lib/garmin/queries";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** Overview reads (race date on the cycle, Garmin VO2 max from stored FIT sessions) against a real database. */

async function withActivity(userId: string, id: number, day: string, vo2: number | null) {
  await db.insert(garminDays).values({ userId, calendarDate: day, kind: "hrv", data: { lastNightAvg: 70 } });
  await db.insert(garminActivities).values({ userId, garminActivityId: id, startTimeLocal: new Date(`${day}T07:00:00Z`), activityType: "running", data: { activityName: `Run ${id}`, duration: 1800 } });
  await db.insert(garminActivityMetrics).values({ userId, garminActivityId: id, modelVersion: 1, sport: "run", day, load: 40, loadMethod: "trimp", metrics: { hrPreview: [120, 130], decoupling: null } });
  await db.insert(garminActivityStreams).values({
    userId,
    garminActivityId: id,
    parserVersion: 3,
    streams: {},
    laps: [],
    sets: [],
    timeInZone: [],
    session: { garminVo2Max: vo2, garminVo2MaxUpdated: false },
  });
}

describe("updateTrainingCycle race fields", () => {
  it("saves a race date and distance, and clears them", async () => {
    const user = await createUser();
    asUser(user.id);
    const [c] = await db.insert(trainingCycles).values({ userId: user.id, name: "IM", durationWeeks: 24 }).returning();

    expect((await updateTrainingCycle({ id: c.id, raceDate: "2027-06-20", raceDistance: "full" })).success).toBe(true);
    let [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, c.id));
    expect(row).toMatchObject({ raceDate: "2027-06-20", raceDistance: "full" });

    await updateTrainingCycle({ id: c.id, raceDate: null, raceDistance: null });
    [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, c.id));
    expect(row).toMatchObject({ raceDate: null, raceDistance: null });
  });

  it("refuses a bad distance and another user's cycle", async () => {
    const owner = await createUser();
    const [c] = await db.insert(trainingCycles).values({ userId: owner.id, name: "IM", durationWeeks: 24 }).returning();
    asUser(owner.id);
    expect((await updateTrainingCycle({ id: c.id, raceDistance: "sprint" })).success).toBe(false);
    asUser((await createUser()).id);
    expect((await updateTrainingCycle({ id: c.id, raceDate: "2027-06-20" })).success).toBe(false);
  });
});

describe("getOverviewData", () => {
  it("reads the active cycle's race and the user's own Garmin VO2 max only", async () => {
    const me = await createUser();
    const other = await createUser();
    await withActivity(me.id, 1, "2026-11-01", 51.2);
    await withActivity(other.id, 2, "2026-11-02", 60);
    await db.insert(trainingCycles).values({ userId: me.id, name: "IM", durationWeeks: 24, status: "active", startDate: "2026-09-01", raceDate: "2027-02-14", raceDistance: "half" });

    const d = await getOverviewData(me.id);
    expect(d.date).toBe("2026-11-01");
    expect(d.body.vo2max.value).toBe(51.2);
    expect(d.body.vo2max.points).toEqual([{ date: "2026-11-01", value: 51.2 }]);
    expect(d.race).toMatchObject({ raceSet: true, raceDay: "2027-02-14", distance: "half" });
    expect(d.last?.id).toBe(1);
  });
});
