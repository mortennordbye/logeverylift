import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import CycleDetailPage from "@/app/cycles/[id]/page";
import CyclesPage from "@/app/cycles/page";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The cycle pages read cycle state, so like home they first start a block
 * whose scheduled day has come and complete one that is over.
 */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
const statusOf = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];
let userId: string;
let over: number;
let due: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  over = (await db.insert(trainingCycles).values({ userId, name: "Old", durationWeeks: 1, status: "active", startDate: day(-10) }).returning())[0].id;
  due = (await db.insert(trainingCycles).values({ userId, name: "Next", durationWeeks: 4, scheduledStartDate: day(0) }).returning())[0].id;
});

describe("cycle pages settle the active cycle before they read", () => {
  it("/cycles starts the due block and completes the old one", async () => {
    await CyclesPage();
    expect(await statusOf(over)).toMatchObject({ status: "completed" });
    expect(await statusOf(due)).toMatchObject({ status: "active", startDate: day(0), scheduledStartDate: null });
  });

  it("/cycles/[id] completes an over block with nothing scheduled", async () => {
    await db.update(trainingCycles).set({ scheduledStartDate: null }).where(eq(trainingCycles.id, due));
    await CycleDetailPage({ params: Promise.resolve({ id: String(over) }) });
    expect(await statusOf(over)).toMatchObject({ status: "completed" });
  });

  it("/cycles/[id] starts the due block", async () => {
    await CycleDetailPage({ params: Promise.resolve({ id: String(due) }) });
    expect(await statusOf(due)).toMatchObject({ status: "active", startDate: day(0) });
  });
});
