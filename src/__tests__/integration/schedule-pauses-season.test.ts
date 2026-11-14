import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import CycleDetailPage from "@/app/cycles/[id]/page";
import NewCyclePage from "@/app/cycles/new/page";
import { CreateCycleForm } from "@/components/features/CreateCycleForm";
import { StartCycleButton } from "@/components/features/CycleDetailClient";
import { addPhaseAction, createSeasonAction } from "@/lib/actions/seasons";
import { startTrainingCycle } from "@/lib/actions/training-cycles";
import { getSeasonDetail } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { seasonPaused } from "@/lib/utils/seasons";
import { eq } from "drizzle-orm";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * One cycle is scheduled at a time (scheduleCycle): a standalone draft that
 * takes the scheduled start from a season's next phase pauses the season, the
 * screens that choose the start say so first, and the season then offers
 * Resume.
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

async function seasonWithPhases(start: string) {
  const s = await createSeasonAction({ name: "Jevnaker Half 2027", startDate: start, endDate: day(200) });
  if (!s.success) throw new Error(s.error);
  const p1 = await addPhaseAction({ seasonId: s.data.id, name: "Base", durationWeeks: 4 });
  const p2 = await addPhaseAction({ seasonId: s.data.id, name: "Build", durationWeeks: 4 });
  if (!p1.success || !p2.success) throw new Error("phase");
  return { seasonId: s.data.id, one: p1.data.cycleId, two: p2.data.cycleId };
}

async function draft(name: string) {
  const [c] = await db.insert(trainingCycles).values({ userId: me, name, durationWeeks: 4 }).returning();
  return c.id;
}

const scheduledOf = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0].scheduledStartDate;

async function pausedWithResume(seasonId: number) {
  const detail = (await getSeasonDetail(me, seasonId))!;
  return { scheduled: detail.next!.scheduled, paused: seasonPaused(detail.next!, detail.phases, day(0)) };
}

describe("a standalone draft takes the scheduled start from a season", () => {
  it("while a phase runs: both screens name the season first, and after the schedule it shows paused with Resume", async () => {
    const { seasonId, one, two } = await seasonWithPhases(day(0));
    await startTrainingCycle(one);
    expect(await scheduledOf(two)).toBe(day(28));
    const peak = await draft("Strength peak");

    const phase = { id: two, name: "Build", day: day(28), season: { id: seasonId, name: "Jevnaker Half 2027" } };
    const start = propsOf<Parameters<typeof StartCycleButton>[0]>(await CycleDetailPage({ params: Promise.resolve({ id: String(peak) }) }), StartCycleButton)!;
    expect(start.otherScheduled).toEqual(phase);
    const form = propsOf<Parameters<typeof CreateCycleForm>[0]>(await NewCyclePage({ searchParams: Promise.resolve({}) }), CreateCycleForm)!;
    expect(form.scheduled).toEqual(phase);

    expect((await startTrainingCycle(peak, day(10))).success).toBe(true);
    expect(await scheduledOf(two)).toBeNull();
    expect(await pausedWithResume(seasonId)).toEqual({ scheduled: false, paused: true });
  });

  it("before the season starts: its first phase loses the start and the season shows paused with Resume", async () => {
    const { seasonId, one } = await seasonWithPhases(day(5));
    expect(await scheduledOf(one)).toBe(day(5));
    const peak = await draft("Strength peak");

    expect((await startTrainingCycle(peak, day(3))).success).toBe(true);
    expect(await scheduledOf(one)).toBeNull();
    expect(await pausedWithResume(seasonId)).toEqual({ scheduled: false, paused: true });
  });
});
