import { db } from "@/db";
import { userWeightEntries, users } from "@/db/schema";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { mcpTools } from "./mcp-call";

/** update_profile and manage_weight against real rows (docs/plans/ai-coach.md, section 6). */

let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
});

const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const weights = (id: string) => db.select().from(userWeightEntries).where(eq(userWeightEntries.userId, id));

describe("update_profile", () => {
  it("changes only the fields it is given, and logs a new weight", async () => {
    const result = await mcpTools(registerProfileTools, me)("update_profile", {
      heightCm: 182,
      weightKg: 80,
      goals: ["strength", "endurance"],
      timeZone: "Europe/Oslo",
      distanceUnit: "mi",
    });
    expect(result.isError, result.raw).toBe(false);
    const row = await userRow(me);
    expect(row).toMatchObject({ heightCm: 182, weightKg: 80, timeZone: "Europe/Oslo", distanceUnit: "mi", swimUnit: "m" });
    expect(JSON.parse(row.goals!)).toEqual(["strength", "endurance"]);
    expect(await weights(me)).toHaveLength(1);
    expect(await weights(other)).toEqual([]);
  });

  it("clears with null, and refuses values out of range or an unknown zone", async () => {
    const call = mcpTools(registerProfileTools, me);
    await call("update_profile", { heightCm: 182 });
    expect((await call("update_profile", { heightCm: null })).isError).toBe(false);
    expect((await userRow(me)).heightCm).toBeNull();

    const before = await userRow(me);
    expect((await call("update_profile", { heightCm: 400 })).isError).toBe(true);
    expect((await call("update_profile", { timeZone: "Mars/Olympus" })).isError).toBe(true);
    // Not a field of the tool: dropped by its schema, so the call has nothing to change.
    expect(await call("update_profile", { enduranceEnabled: true })).toMatchObject({ isError: true, raw: "Error: No profile field to update" });
    const after = await userRow(me);
    expect(after.heightCm).toBe(before.heightCm);
    expect(after.timeZone).toBe(before.timeZone);
    expect(after.enduranceEnabled).toBe(false);
  });
});

describe("get_profile", () => {
  it("returns the stored home layout, or the default flag, and nothing of another user's", async () => {
    const call = mcpTools(registerProfileTools, me);
    expect((await call("get_profile")).data.homeLayout).toEqual({ isDefault: true, items: null });
    const items = [{ id: "today", size: "s" as const, hidden: false }];
    await db.update(users).set({ homeLayout: { v: 1, updatedAt: "2026-11-13T10:00:00.000Z", items } }).where(eq(users.id, me));
    await db
      .update(users)
      .set({ homeLayout: { v: 1, updatedAt: "2026-11-13T10:00:00.000Z", items: [{ id: "week", size: "m", hidden: true }] } })
      .where(eq(users.id, other));
    expect((await call("get_profile")).data.homeLayout).toEqual({ isDefault: false, items });
  });
});

describe("manage_weight", () => {
  it("logs an entry and moves the profile's weight", async () => {
    const result = await mcpTools(registerProfileTools, me)("manage_weight", { operation: "log", weightKg: 78.5 });
    expect(result.isError, result.raw).toBe(false);
    expect((await userRow(me)).weightKg).toBe(78.5);
    expect((await weights(me)).map((w) => w.id)).toEqual([result.data.id]);
  });

  it("refuses a future time and a missing weight", async () => {
    const call = mcpTools(registerProfileTools, me);
    expect((await call("manage_weight", { operation: "log", weightKg: 80, recordedAt: new Date(Date.now() + 86_400_000).toISOString() })).isError).toBe(true);
    expect((await call("manage_weight", { operation: "log" })).isError).toBe(true);
    expect(await weights(me)).toEqual([]);
  });

  it("deletes the user's own entry only", async () => {
    const theirs = await mcpTools(registerProfileTools, other)("manage_weight", { operation: "log", weightKg: 70 });
    const call = mcpTools(registerProfileTools, me);
    const refused = await call("manage_weight", { operation: "delete", entryId: theirs.data.id });
    expect(refused).toMatchObject({ isError: true, raw: "Error: Weight entry not found" });
    expect(await weights(other)).toHaveLength(1);

    const mine = await call("manage_weight", { operation: "log", weightKg: 80 });
    expect((await call("manage_weight", { operation: "delete", entryId: mine.data.id })).data).toEqual({ deleted: true });
    expect(await weights(me)).toEqual([]);
  });
});
