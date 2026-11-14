import { db } from "@/db";
import { trainingCycleSlots, trainingCycles } from "@/db/schema";
import { reorderCycleSlots, upsertCycleSlot } from "@/lib/actions/training-cycles";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Reordering a rotation's slots. uniq_cycle_order (training_cycle_id,
 * order_index) is checked row by row, so the action must never give a slot a
 * place another slot still holds.
 */

let userId: string;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
});

async function rotation() {
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Rotation", durationWeeks: 4, scheduleType: "rotation" })
    .returning();
  for (let i = 1; i <= 5; i++) {
    const r = await upsertCycleSlot({ trainingCycleId: cycle.id, orderIndex: i, label: `S${i}` });
    if (!r.success) throw new Error(r.error);
  }
  const ids = (
    await db
      .select({ id: trainingCycleSlots.id })
      .from(trainingCycleSlots)
      .where(eq(trainingCycleSlots.trainingCycleId, cycle.id))
      .orderBy(asc(trainingCycleSlots.orderIndex))
  ).map((r) => r.id);
  return { id: cycle.id, ids };
}

const labelsInOrder = async (id: number) =>
  (
    await db
      .select()
      .from(trainingCycleSlots)
      .where(eq(trainingCycleSlots.trainingCycleId, id))
      .orderBy(asc(trainingCycleSlots.orderIndex))
  ).map((r) => `${r.orderIndex}:${r.label}`);

describe("reorderCycleSlots", () => {
  it("moves the last slot of a 5-slot rotation to the front", async () => {
    const { id, ids } = await rotation();

    const result = await reorderCycleSlots(id, [ids[4], ids[0], ids[1], ids[2], ids[3]]);

    expect(result).toEqual({ success: true, data: undefined });
    expect(await labelsInOrder(id)).toEqual(["1:S5", "2:S1", "3:S2", "4:S3", "5:S4"]);
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
    expect(await labelsInOrder(id)).toEqual(["1:S1", "2:S2", "3:S3", "4:S4", "5:S5"]);
  });
});
