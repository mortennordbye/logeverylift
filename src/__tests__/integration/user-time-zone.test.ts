import { db } from "@/db";
import { trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { getActiveCycleForUser, startTrainingCycle } from "@/lib/actions/training-cycles";
import { setDisplayUnits, setTimeZone } from "@/lib/actions/user-settings";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * "Today" follows the user's time zone (decision D14), not the server's. The
 * server runs in UTC in production; at 23:30 UTC it is already the next day in
 * Oslo and still the same day in New York.
 */

let userId: string;
let mondayProgram: number;
let tuesdayProgram: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  const lift = await createExercise();
  mondayProgram = (await createProgram(userId, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
  tuesdayProgram = (await createProgram(userId, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
  asUser(userId);
});

afterEach(() => {
  vi.useRealTimers();
});

async function weeklyCycle(startDate: string) {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: 1, programId: mondayProgram },
    { trainingCycleId: cycle.id, dayOfWeek: 2, programId: tuesdayProgram },
  ]);
  return cycle;
}

const zone = (timeZone: string) => db.update(users).set({ timeZone }).where(eq(users.id, userId));

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("today's slot and the cycle week", () => {
  // 2026-11-02 is a Monday.
  it("is already Tuesday in Oslo at 23:30 UTC on Monday", async () => {
    await weeklyCycle("2026-11-02");
    await zone("Europe/Oslo");
    at("2026-11-02T23:30:00Z");
    const result = await getActiveCycleForUser();
    expect(result.success && result.data?.todaySlot?.programId).toBe(tuesdayProgram);
  });

  it("is still Monday in New York at the same moment", async () => {
    await weeklyCycle("2026-11-02");
    await zone("America/New_York");
    at("2026-11-02T23:30:00Z");
    const result = await getActiveCycleForUser();
    expect(result.success && result.data?.todaySlot?.programId).toBe(mondayProgram);
  });

  it("starts week 2 at the user's own Monday midnight", async () => {
    await weeklyCycle("2026-11-02");
    at("2026-11-08T23:30:00Z"); // Sunday in UTC, Monday 00:30 in Oslo
    await zone("Europe/Oslo");
    const oslo = await getActiveCycleForUser();
    expect(oslo.success && oslo.data?.currentWeek).toBe(2);
    await zone("America/New_York");
    const ny = await getActiveCycleForUser();
    expect(ny.success && ny.data?.currentWeek).toBe(1);
  });

  it("dates a cycle start by the user's day", async () => {
    const [draft] = await db
      .insert(trainingCycles)
      .values({ userId, name: "Next", durationWeeks: 4, status: "draft" })
      .returning();
    await zone("Pacific/Auckland");
    at("2026-11-02T12:00:00Z"); // 01:00 on Tuesday in Auckland
    const result = await startTrainingCycle(draft.id);
    expect(result.success).toBe(true);
    const [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, draft.id));
    expect(row.startDate).toBe("2026-11-03");
  });
});

describe("setTimeZone and setDisplayUnits", () => {
  const stored = async () => (await db.select().from(users).where(eq(users.id, userId)))[0];

  it("fills the zone from the browser once, and never over a stored zone", async () => {
    expect((await setTimeZone({ timeZone: "Europe/Oslo", ifUnset: true })).success).toBe(true);
    expect((await stored()).timeZone).toBe("Europe/Oslo");
    const again = await setTimeZone({ timeZone: "Asia/Tokyo", ifUnset: true });
    expect(again.success && again.data.changed).toBe(false);
    expect((await stored()).timeZone).toBe("Europe/Oslo");
    expect((await setTimeZone({ timeZone: "Asia/Tokyo" })).success).toBe(true);
    expect((await stored()).timeZone).toBe("Asia/Tokyo");
  });

  it("refuses an unknown zone and an unknown unit", async () => {
    expect((await setTimeZone({ timeZone: "Mars/Olympus" })).success).toBe(false);
    expect((await setDisplayUnits({ distanceUnit: "furlong" })).success).toBe(false);
    const row = await stored();
    expect(row.timeZone).toBeNull();
    expect(row.distanceUnit).toBe("km");
  });

  it("changes only the caller's own units", async () => {
    const other = await createUser();
    expect((await setDisplayUnits({ distanceUnit: "mi", swimUnit: "yd" })).success).toBe(true);
    const row = await stored();
    expect([row.distanceUnit, row.swimUnit]).toEqual(["mi", "yd"]);
    const [theirs] = await db.select().from(users).where(eq(users.id, other.id));
    expect([theirs.distanceUnit, theirs.swimUnit]).toEqual(["km", "m"]);
  });
});

describe("the MCP profile tools", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
  function toolsFor(id: string) {
    const tools = new Map<string, { schema: z.ZodTypeAny; handler: Handler }>();
    registerProfileTools(
      {
        registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: Handler) =>
          tools.set(name, { schema: z.object(config.inputSchema), handler }),
      } as unknown as McpServer,
      id,
    );
    return async (name: string, args: Record<string, unknown> = {}) => {
      const tool = tools.get(name)!;
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) return { isError: true, data: null };
      const result = await tool.handler(parsed.data as Record<string, unknown>);
      return { ...result, data: result.isError ? null : JSON.parse(result.content[0].text) };
    };
  }

  it("reads and sets the zone and units, and cannot turn on the endurance switch", async () => {
    const call = toolsFor(userId);
    const set = await call("update_profile", {
      timeZone: "Europe/Oslo",
      distanceUnit: "mi",
      swimUnit: "yd",
      enduranceEnabled: true,
    });
    expect(set.isError).toBeFalsy();
    const profile = await call("get_profile");
    expect(profile.data).toMatchObject({
      timeZone: "Europe/Oslo",
      distanceUnit: "mi",
      swimUnit: "yd",
      enduranceEnabled: false,
    });
  });

  it("refuses an unknown zone", async () => {
    const result = await toolsFor(userId)("update_profile", { timeZone: "Nowhere/Land" });
    expect(result.isError).toBe(true);
  });
});
