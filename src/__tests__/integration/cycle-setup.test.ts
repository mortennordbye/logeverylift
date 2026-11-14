import { db } from "@/db";
import { trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { createTrainingCycle, reorderCycleSlots, startTrainingCycle, upsertCycleSlot } from "@/lib/actions/training-cycles";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The new cycle setup (docs/plans/plan-tab-redesign.md, P3): a start day for
 * the draft (today starts it, a later day schedules it), and the slot fields
 * the weekday session sheet saves.
 */

let userId: string;
let today: Date;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  today = await userToday(userId);
});

const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];

async function draft(name = "Block", scheduleType: "day_of_week" | "rotation" = "day_of_week") {
  const result = await createTrainingCycle({ name, durationWeeks: 6, scheduleType });
  if (!result.success) throw new Error(result.error);
  return result.data.id;
}

describe("startTrainingCycle with a start day", () => {
  it("schedules the draft for a later day and leaves the running cycle alone", async () => {
    const running = await draft("Running");
    await startTrainingCycle(running);
    const id = await draft();
    const day = toDateStr(addDays(today, 7));

    const result = await startTrainingCycle(id, day);

    expect(result.success).toBe(true);
    expect(await cycleRow(id)).toMatchObject({ status: "draft", scheduledStartDate: day, startDate: null });
    expect((await cycleRow(running)).status).toBe("active");
  });

  it("starts the draft at once for today, completing the running cycle", async () => {
    const running = await draft("Running");
    await startTrainingCycle(running);
    const id = await draft();

    const result = await startTrainingCycle(id, toDateStr(today));

    expect(result.success).toBe(true);
    expect(await cycleRow(id)).toMatchObject({ status: "active", startDate: toDateStr(today), scheduledStartDate: null });
    expect((await cycleRow(running)).status).toBe("completed");
  });

  it("refuses a day in the past and a day too far ahead", async () => {
    const id = await draft();
    expect(await startTrainingCycle(id, toDateStr(addDays(today, -1)))).toEqual({ success: false, error: "The start day is in the past" });
    expect(await startTrainingCycle(id, toDateStr(addDays(today, 121)))).toEqual({
      success: false,
      error: "The start day is more than 120 days ahead",
    });
    expect(await startTrainingCycle(id, "16 Nov")).toEqual({ success: false, error: "Invalid input" });
    expect(await cycleRow(id)).toMatchObject({ status: "draft", scheduledStartDate: null });
  });

  it("does not schedule another user's cycle", async () => {
    const id = await draft();
    asUser((await createUser()).id);

    const result = await startTrainingCycle(id, toDateStr(addDays(today, 3)));

    expect(result).toEqual({ success: false, error: "Training cycle not found" });
    expect((await cycleRow(id)).scheduledStartDate).toBeNull();
  });
});

describe("upsertCycleSlot: the session sheet's fields", () => {
  const slot = async (cycleId: number, daySlot: number) =>
    (
      await db
        .select()
        .from(trainingCycleSlots)
        .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), eq(trainingCycleSlots.dayOfWeek, 7), eq(trainingCycleSlots.daySlot, daySlot)))
    )[0];

  it("saves a label and a note, and null clears them", async () => {
    const id = await draft();
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, label: "Long ride", notes: "Easy start" });
    expect(await slot(id, 1)).toMatchObject({ label: "Long ride", notes: "Easy start" });

    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, label: null, notes: null });
    expect(await slot(id, 1)).toMatchObject({ label: null, notes: null });
  });

  it("saves a key session and a brick link with the endurance features on", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, userId));
    const id = await draft();
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, label: "Long ride", priority: "key", brickWithNext: true });
    expect(await slot(id, 1)).toMatchObject({ priority: "key", brickWithNext: true });

    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, priority: null, brickWithNext: false });
    expect(await slot(id, 1)).toMatchObject({ priority: null, brickWithNext: false, label: "Long ride" });
  });

  it("refuses a key session and a brick link with the endurance features off", async () => {
    const id = await draft();
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, label: "Long ride" });

    expect(await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, priority: "key" })).toEqual({
      success: false,
      error: "Endurance features are not on for this account",
    });
    expect(await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, brickWithNext: true })).toMatchObject({ success: false });
    expect(await slot(id, 1)).toMatchObject({ priority: null, brickWithNext: false });
  });

  it("does not write a slot on another user's cycle", async () => {
    const id = await draft();
    asUser((await createUser({ enduranceEnabled: true })).id);

    expect(await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 7, daySlot: 1, label: "Mine", notes: "x" })).toEqual({
      success: false,
      error: "Cycle not found",
    });
    expect(await slot(id, 1)).toBeUndefined();
  });
});

describe("reorderCycleSlots", () => {
  async function rotation() {
    const id = await draft("Rotation", "rotation");
    for (let i = 1; i <= 5; i++) {
      const r = await upsertCycleSlot({ trainingCycleId: id, orderIndex: i, label: `S${i}` });
      if (!r.success) throw new Error(r.error);
    }
    const rows = await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, id));
    const ids = rows.sort((a, b) => a.orderIndex! - b.orderIndex!).map((r) => r.id);
    return { id, ids };
  }

  const labelsInOrder = async (id: number) =>
    (await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, id)))
      .sort((a, b) => a.orderIndex! - b.orderIndex!)
      .map((r) => `${r.orderIndex}:${r.label}`);

  it("moves one slot to the front of a 5-slot rotation", async () => {
    const { id, ids } = await rotation();

    const result = await reorderCycleSlots(id, [ids[3], ids[0], ids[1], ids[2], ids[4]]);

    expect(result).toEqual({ success: true, data: undefined });
    expect(await labelsInOrder(id)).toEqual(["1:S4", "2:S1", "3:S2", "4:S3", "5:S5"]);
  });

  it("reverses a 5-slot rotation", async () => {
    const { id, ids } = await rotation();

    const result = await reorderCycleSlots(id, [...ids].reverse());

    expect(result).toEqual({ success: true, data: undefined });
    expect(await labelsInOrder(id)).toEqual(["1:S5", "2:S4", "3:S3", "4:S2", "5:S1"]);
  });

  it("does not reorder another user's rotation", async () => {
    const { id, ids } = await rotation();
    asUser((await createUser()).id);

    expect(await reorderCycleSlots(id, [...ids].reverse())).toEqual({ success: false, error: "Cycle not found" });
    asUser(userId);
    expect(await labelsInOrder(id)).toEqual(["1:S1", "2:S2", "3:S3", "4:S4", "5:S5"]);
  });
});
