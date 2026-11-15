import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Edit details in two tabs (round 8 B13): the form sends the version it read,
 * so a save from a stale tab is refused instead of undoing the other tab's save.
 */

let userId: string;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
});

const rowOf = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];

describe("a save from a stale Edit details tab", () => {
  it("is refused with a clear message, and the other tab's save stays", async () => {
    const [cycle] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 8 }).returning();
    const read = cycle.version;

    // Tab A renames.
    expect((await updateTrainingCycle({ id: cycle.id, name: "Strength block", durationWeeks: 8, expectedVersion: read })).success).toBe(true);
    // Tab B still shows the old name and changes the length.
    const stale = await updateTrainingCycle({ id: cycle.id, name: "Block", durationWeeks: 6, expectedVersion: read });
    expect(stale).toEqual({ success: false, error: "This cycle changed in another tab. Reload to see it." });
    expect(await rowOf(cycle.id)).toMatchObject({ name: "Strength block", durationWeeks: 8 });
  });

  it("saves when nothing changed it since the form was read", async () => {
    const [cycle] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 8 }).returning();
    expect((await updateTrainingCycle({ id: cycle.id, name: "Renamed", expectedVersion: cycle.version })).success).toBe(true);
    expect((await rowOf(cycle.id)).name).toBe("Renamed");
  });

  it("refuses another user's cycle and changes nothing", async () => {
    const [cycle] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 8 }).returning();
    asUser((await createUser()).id);
    expect((await updateTrainingCycle({ id: cycle.id, name: "Taken", expectedVersion: cycle.version })).success).toBe(false);
    expect((await rowOf(cycle.id)).name).toBe("Block");
  });
});
