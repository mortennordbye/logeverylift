import { db } from "@/db";
import { fuelLogs, garminActivities, trainingCycles } from "@/db/schema";
import { saveFuelLogAction } from "@/lib/actions/nutrition";
import { getActivityDetail, getRaceData } from "@/lib/garmin/queries";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

describe("saveFuelLogAction on a Garmin activity", () => {
  it("saves, updates and clears the log for the user's own session", async () => {
    const me = await createUser();
    await longRide(me.id, 31);
    asUser(me.id);

    expect((await saveFuelLogAction({ garminActivityId: 31, carbsG: 180, fluidMl: 1500 })).success).toBe(true);
    expect((await saveFuelLogAction({ garminActivityId: 31, carbsG: 200, fluidMl: 1500 })).success).toBe(true);
    let rows = await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me.id));
    expect(rows).toEqual([expect.objectContaining({ garminActivityId: 31, carbsG: 200, fluidMl: 1500, durationS: 10800 })]);
    expect((await getActivityDetail(me.id, 31))?.fuel).toMatchObject({ carbsG: 200, fluidMl: 1500, sodiumMg: null, giScore: null });

    await saveFuelLogAction({ garminActivityId: 31, carbsG: null, fluidMl: null });
    rows = await db.select().from(fuelLogs).where(eq(fuelLogs.userId, me.id));
    expect(rows).toEqual([]);
  });

  it("refuses another user's session and bad numbers", async () => {
    const owner = await createUser();
    await longRide(owner.id, 32);
    asUser((await createUser()).id);
    expect(await saveFuelLogAction({ garminActivityId: 32, carbsG: 100, fluidMl: null })).toEqual({ success: false, error: "Activity not found" });
    asUser(owner.id);
    expect((await saveFuelLogAction({ garminActivityId: 32, carbsG: -5, fluidMl: null })).success).toBe(false);
    expect(await db.select().from(fuelLogs).where(eq(fuelLogs.userId, owner.id))).toEqual([]);
  });
});

describe("getRaceData", () => {
  it("is null without an active cycle, and lists long sessions with their fuel log", async () => {
    const me = await createUser();
    expect(await getRaceData(me.id)).toBeNull();

    await longRide(me.id, 33);
    asUser(me.id);
    await saveFuelLogAction({ garminActivityId: 33, carbsG: 210, fluidMl: 1800 });
    await db.insert(trainingCycles).values({ userId: me.id, name: "IM", durationWeeks: 24, status: "active", startDate: "2026-09-07", raceDate: "2027-02-21", raceDistance: "full" });

    const r = (await getRaceData(me.id))!;
    expect(r.race).toMatchObject({ raceSet: true, distance: "full" });
    expect(r.taperStart).toBe("2027-02-01");
    expect(r.fuel).toEqual([expect.objectContaining({ id: 33, sweatMl: 2400, carbsG: 210, fluidMl: 1800, durationS: 10800 })]);
  });

  it("takes a session's temperature from Garmin's summary when its file has none", async () => {
    const me = await createUser();
    await longRide(me.id, 34);
    await db.update(garminActivities).set({ detail: { summaryDTO: { averageTemperature: 21.46 } } }).where(eq(garminActivities.garminActivityId, 34));
    await db.insert(trainingCycles).values({ userId: me.id, name: "IM", durationWeeks: 24, status: "active", startDate: "2026-09-07", raceDate: "2027-02-21", raceDistance: "full" });
    expect((await getRaceData(me.id))!.fuel).toEqual([expect.objectContaining({ id: 34, temperature: 21.5 })]);
  });
});

describe("Garmin MCP tools", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
  function tool(userId: string, name: string): Handler {
    let handler: Handler | undefined;
    const server = {
      registerTool(n: string, _config: unknown, fn: Handler) {
        if (n === name) handler = fn;
      },
    } as unknown as McpServer;
    registerGarminTools(server, userId);
    return handler!;
  }

  it("returns the user's own activity without GPS or streams, and nothing of another user's", async () => {
    const me = await createUser();
    await longRide(me.id, 41);
    const r = await tool(me.id, "get_garmin_activity")({ id: 41 });
    const data = JSON.parse(r.content[0].text);
    expect(data).toMatchObject({ id: 41, sport: "bike", durationMin: 180 });
    expect(r.content[0].text).not.toMatch(/"lat"|"lng"|streams/);

    const other = await createUser();
    const denied = await tool(other.id, "get_garmin_activity")({ id: 41 });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toBe("Error: Activity not found");
  });
});
