import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import CycleDetailPage from "@/app/cycles/[id]/page";
import { CycleCompletionBanner } from "@/components/features/CycleCompletionBanner";
import { addPhaseAction, createSeasonAction } from "@/lib/actions/seasons";
import { startTrainingCycle } from "@/lib/actions/training-cycles";
import { loadPlanList } from "@/lib/plan-list";
import { getSeasonDetail } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { dayMonth } from "@/lib/utils/plan-list";
import { eq } from "drizzle-orm";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The Plan list, the season page and the cycle page tell one story about a
 * season whose chain another block interrupted (fix round 6, J4-18, J8-09).
 */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
});

function propsOf<P>(tree: ReactNode, type: unknown): P | null {
  if (Array.isArray(tree)) {
    for (const t of tree) {
      const found = propsOf<P>(t, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(tree)) return null;
  if (tree.type === type) return tree.props as P;
  return propsOf<P>((tree.props as { children?: ReactNode }).children, type);
}

/** A season under way: Base runs from today for 4 weeks, Build follows. */
async function runningSeason() {
  const s = await createSeasonAction({ name: "Winter run base", startDate: day(0), endDate: day(200) });
  if (!s.success) throw new Error(s.error);
  const p1 = await addPhaseAction({ seasonId: s.data.id, name: "Base", durationWeeks: 4 });
  const p2 = await addPhaseAction({ seasonId: s.data.id, name: "Build", durationWeeks: 4 });
  if (!p1.success || !p2.success) throw new Error("phase");
  expect((await startTrainingCycle(p1.data.cycleId)).success).toBe(true);
  return { seasonId: s.data.id, one: p1.data.cycleId, two: p2.data.cycleId };
}

async function draft(name: string) {
  const [c] = await db.insert(trainingCycles).values({ userId: me, name, durationWeeks: 4 }).returning();
  return c.id;
}

describe("another block's scheduled start ends the running phase (J4-18)", () => {
  it("the season and the Plan list end the phase the day before that start", async () => {
    const { seasonId } = await runningSeason();
    const other = await draft("Oslo base");
    // The other block takes the start on day 3: that start completes Base (startDueScheduledCycle).
    expect((await startTrainingCycle(other, day(3))).success).toBe(true);

    const detail = (await getSeasonDetail(me, seasonId))!;
    expect(detail.phases[0]).toMatchObject({ state: "active", start: day(0), end: day(2) });

    const list = await loadPlanList(me, false);
    expect(list.hero?.ends).toBe(`Ends ${dayMonth(day(2))}`);
    const card = list.seasons.find((s) => s.id === seasonId)!;
    expect(card.phases[0].sub).toContain(dayMonth(day(2)));
    expect(card.phases[0].badge).toBe("Now");
    expect(card.phases[1].badge).toBe("Paused");
  });

  it("keeps the planned end when the next phase is the one scheduled", async () => {
    const { seasonId } = await runningSeason();
    const detail = (await getSeasonDetail(me, seasonId))!;
    expect(detail.phases[0].end).toBe(day(27));
    expect((await loadPlanList(me, false)).hero?.ends).toBe(`Ends ${dayMonth(day(27))}`);
  });
});

describe("a completed phase names the season's next phase (J8-09)", () => {
  it("not a standalone draft that took the scheduled start", async () => {
    const { one, two } = await runningSeason();
    const upkeep = await draft("Strength upkeep");
    expect((await startTrainingCycle(upkeep, day(10))).success).toBe(true);
    // Base ended early.
    await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.id, one));

    const banner = propsOf<Parameters<typeof CycleCompletionBanner>[0]>(await CycleDetailPage({ params: Promise.resolve({ id: String(one) }) }), CycleCompletionBanner)!;
    expect(banner.next).toMatchObject({ id: two, name: "Build", startsLabel: null });
  });

  it("names the next phase with its start day when it is scheduled", async () => {
    const { one, two } = await runningSeason();
    await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.id, one));
    await db.update(trainingCycles).set({ scheduledStartDate: day(5) }).where(eq(trainingCycles.id, two));

    const banner = propsOf<Parameters<typeof CycleCompletionBanner>[0]>(await CycleDetailPage({ params: Promise.resolve({ id: String(one) }) }), CycleCompletionBanner)!;
    expect(banner.next).toMatchObject({ id: two, name: "Build" });
    expect(banner.next?.startsLabel).not.toBeNull();
  });
});

describe("a phase another start ended early says the day it ended (J8-09)", () => {
  it("ended early on its last day, from the start that ended it", async () => {
    const { one } = await runningSeason();
    const other = await draft("Oslo base");
    // Starting another block today completes Base, which began today.
    expect((await startTrainingCycle(other)).success).toBe(true);

    const banner = propsOf<Parameters<typeof CycleCompletionBanner>[0]>(await CycleDetailPage({ params: Promise.resolve({ id: String(one) }) }), CycleCompletionBanner)!;
    expect(banner.endedLabel).toBe(`ended early on ${dayMonth(day(0))}`);
  });

  it("the season page and the Plan list show the day it ended, not its planned end (round 8)", async () => {
    const { seasonId, one } = await runningSeason();
    // Base began ten days ago; another block starting today ends it yesterday.
    await db.update(trainingCycles).set({ startDate: day(-10) }).where(eq(trainingCycles.id, one));
    expect((await startTrainingCycle(await draft("Oslo base"))).success).toBe(true);

    const detail = (await getSeasonDetail(me, seasonId))!;
    expect(detail.phases[0]).toMatchObject({ state: "done", start: day(-10), end: day(-1), lengthDays: 10 });
    const card = (await loadPlanList(me, false)).seasons.find((s) => s.id === seasonId)!;
    expect(card.phases[0].sub).toContain(dayMonth(day(-1)));
    expect(card.phases[0].sub).not.toContain(dayMonth(day(17)));
  });
});
