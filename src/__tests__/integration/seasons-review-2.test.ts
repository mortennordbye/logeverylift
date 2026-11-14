import { db } from "@/db";
import { planRevisions, seasonRaces, seasons, trainingCycles } from "@/db/schema";
import { addPhaseAction, addRaceAction, clearReplanAction, createSeasonAction, removeRaceAction, updateRaceAction } from "@/lib/actions/seasons";
import { startTrainingCycle } from "@/lib/actions/training-cycles";
import { addPhase, createSeason } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { todayIn } from "@/lib/utils/user-date";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** Fixes from the second code review of the Plan redesign branch. */

const day = (offset: number) => toDateStr(addDays(todayIn("UTC"), offset));
let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
});

const seasonsOf = (userId: string) => db.select().from(seasons).where(eq(seasons.userId, userId));
const seasonRow = async (id: number) => (await db.select().from(seasons).where(eq(seasons.id, id)))[0];
const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];
const racesOf = (id: number) => db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, id)).orderBy(asc(seasonRaces.id));

async function draft(name = "Block") {
  const [c] = await db.insert(trainingCycles).values({ userId: me, name, durationWeeks: 4 }).returning();
  return c.id;
}

describe("addPhase takes the scheduled start only when asked", () => {
  it("a first phase with no takeStart leaves the running block and the other scheduled start", async () => {
    const s = await createSeasonAction({ name: "Running", startDate: day(0), endDate: day(200) });
    if (!s.success) throw new Error(s.error);
    const p1 = await addPhaseAction({ seasonId: s.data.id, name: "Base", durationWeeks: 6 });
    const p2 = await addPhaseAction({ seasonId: s.data.id, name: "Build", durationWeeks: 4 });
    if (!p1.success || !p2.success) throw new Error("phase");
    expect((await startTrainingCycle(p1.data.cycleId)).success).toBe(true);
    expect((await cycleRow(p2.data.cycleId)).scheduledStartDate).toBe(day(42));

    const later = await createSeasonAction({ name: "Later", startDate: day(2), endDate: day(150) });
    if (!later.success) throw new Error(later.error);
    const first = await addPhase({ userId: me, writer: "user" }, later.data.id, { name: "General", durationWeeks: 4 });
    expect((await cycleRow(first.cycleId)).scheduledStartDate).toBeNull();
    expect((await cycleRow(p2.data.cycleId)).scheduledStartDate).toBe(day(42));
  });
});
