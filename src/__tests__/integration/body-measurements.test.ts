import { db } from "@/db";
import { bodyMeasurements } from "@/db/schema";
import { deleteBodyMeasurement, getBodyMeasurements, saveBodyMeasurement } from "@/lib/actions/body-measurements";
import { collectUserData } from "@/lib/account-data";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

let meId: string;
let otherId: string;

beforeEach(async () => {
  meId = (await createUser()).id;
  otherId = (await createUser()).id;
  asUser(meId);
});

const rowsOf = (userId: string) => db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId));

describe("saveBodyMeasurement", () => {
  it("replaces the value of the same date, site and side", async () => {
    expect((await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 91, measuredOn: "2026-11-01" })).success).toBe(true);
    const second = await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 90.46, measuredOn: "2026-11-01" });
    expect(second).toMatchObject({ success: true, data: { site: "waist", valueCm: 90.5, measuredOn: "2026-11-01" } });
    await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 92, measuredOn: "2026-10-01" });
    await saveBodyMeasurement({ site: "calf", side: "left", valueCm: 38, measuredOn: "2026-11-01" });
    await saveBodyMeasurement({ site: "calf", side: "right", valueCm: 39, measuredOn: "2026-11-01" });

    const rows = await rowsOf(meId);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.site === "waist").map((r) => r.valueCm).sort()).toEqual([90.5, 92]);
  });

  it("refuses a wrong side, a value out of range and a future date", async () => {
    expect((await saveBodyMeasurement({ site: "calf", side: "none", valueCm: 38, measuredOn: "2026-11-01" })).success).toBe(false);
    expect((await saveBodyMeasurement({ site: "waist", side: "left", valueCm: 90, measuredOn: "2026-11-01" })).success).toBe(false);
    expect((await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 0.5, measuredOn: "2026-11-01" })).success).toBe(false);
    expect((await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 301, measuredOn: "2026-11-01" })).success).toBe(false);
    expect((await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 90, measuredOn: "2999-01-01" })).success).toBe(false);
    expect(await rowsOf(meId)).toHaveLength(0);
  });

  it("refuses a date that is not on the calendar before it reaches the database", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const measuredOn of ["2026-02-30", "2026-02-29", "2026-13-01"]) {
      expect(await saveBodyMeasurement({ site: "waist", side: "none", valueCm: 90, measuredOn })).toMatchObject({ success: false, error: "Invalid input" });
    }
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
    expect(await rowsOf(meId)).toHaveLength(0);
  });
});

describe("getBodyMeasurements and deleteBodyMeasurement", () => {
  it("reads and deletes only the user's own rows", async () => {
    asUser(otherId);
    const theirs = await saveBodyMeasurement({ site: "neck", side: "none", valueCm: 35, measuredOn: "2026-11-01" });
    asUser(meId);
    await saveBodyMeasurement({ site: "neck", side: "none", valueCm: 39, measuredOn: "2026-11-02" });
    await saveBodyMeasurement({ site: "neck", side: "none", valueCm: 38.5, measuredOn: "2026-10-02" });

    const mine = await getBodyMeasurements();
    expect(mine.success && mine.data.map((r) => [r.measuredOn, r.valueCm])).toEqual([
      ["2026-10-02", 38.5],
      ["2026-11-02", 39],
    ]);

    // Someone else's row is not found and stays.
    if (!theirs.success) throw new Error("setup");
    expect((await deleteBodyMeasurement({ id: theirs.data.id })).success).toBe(false);
    expect(await rowsOf(otherId)).toHaveLength(1);

    if (!mine.success) throw new Error("setup");
    expect(await deleteBodyMeasurement({ id: mine.data[0].id })).toEqual({ success: true, data: undefined });
    expect((await rowsOf(meId)).map((r) => r.valueCm)).toEqual([39]);
  });
});

describe("export", () => {
  it("includes the user's measurements and not other users'", async () => {
    await saveBodyMeasurement({ site: "hips", side: "none", valueCm: 104, measuredOn: "2026-11-01" });
    asUser(otherId);
    await saveBodyMeasurement({ site: "hips", side: "none", valueCm: 99, measuredOn: "2026-11-01" });
    const data = await collectUserData(meId);
    expect(data.body_measurement.map((r) => r.valueCm)).toEqual([104]);
  });
});
