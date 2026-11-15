import { db } from "@/db";
import { athleteProfiles, trainingCycles } from "@/db/schema";
import AddPhasePage from "@/app/seasons/[id]/phases/new/page";
import SeasonPage from "@/app/seasons/[id]/page";
import NewSeasonPage from "@/app/seasons/new/page";
import { AddPhaseForm } from "@/components/features/AddPhaseForm";
import { SeasonDetailClient } from "@/components/features/SeasonDetailClient";
import { SeasonForm } from "@/components/features/SeasonForm";
import { addPhaseAction, createSeasonAction } from "@/lib/actions/seasons";
import { startTrainingCycle } from "@/lib/actions/training-cycles";
import { generateTriathlonPlan } from "@/lib/actions/triathlon-plan";
import { getSeasonDetail } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { todayIn } from "@/lib/utils/user-date";
import { eq } from "drizzle-orm";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * A season's first phase takes the one scheduled start (chainSeason `claim`):
 * on its day the running cycle ends, and another scheduled start is dropped
 * now. That happens only when the user confirmed it (`takeStart`); without
 * it the running block and its chain stay as they are. The screens that make
 * a first phase, and Resume, get the running cycle and the scheduled draft to
 * say so first.
 */

// Days in the user's zone (UTC), as the app counts them. The runtime's own
// date is a day off near midnight wherever the local date is not the UTC one.
const day = (offset: number) => toDateStr(addDays(todayIn("UTC"), offset));
let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  // The plan needs an endurance level and training days; Fri and Sat off are the plan's own rest days.
  await db.insert(athleteProfiles).values({ userId: me, enduranceLevel: "intermediate" as const, availableDays: [1, 2, 3, 4, 7] });
  asUser(me);
});

const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];

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

/** A season under way: phase 1 runs, phase 2 is scheduled for the day after it ends. */
async function runningSeason() {
  const s = await createSeasonAction({ name: "Jevnaker Half 2027", startDate: day(0), endDate: day(200) });
  if (!s.success) throw new Error(s.error);
  const p1 = await addPhaseAction({ seasonId: s.data.id, name: "Base", durationWeeks: 6 });
  const p2 = await addPhaseAction({ seasonId: s.data.id, name: "Build", durationWeeks: 4 });
  if (!p1.success || !p2.success) throw new Error("phase");
  expect((await startTrainingCycle(p1.data.cycleId)).success).toBe(true);
  expect((await cycleRow(p2.data.cycleId)).scheduledStartDate).toBe(day(42));
  return { seasonId: s.data.id, running: p1.data.cycleId, waiting: p2.data.cycleId };
}

async function laterSeason() {
  const s = await createSeasonAction({ name: "Oslo Tri 2027", startDate: day(2), endDate: day(150) });
  if (!s.success) throw new Error(s.error);
  return s.data.id;
}

describe("a season's first phase while another season runs", () => {
  it("without takeStart: the other season keeps its scheduled start and the new one waits", async () => {
    const old = await runningSeason();
    const id = await laterSeason();
    const p = await addPhaseAction({ seasonId: id, name: "General", durationWeeks: 4 });
    expect(p.success).toBe(true);
    expect((await cycleRow(old.waiting)).scheduledStartDate).toBe(day(42));
    expect((await cycleRow(p.success ? p.data.cycleId : 0)).scheduledStartDate).toBeNull();
    expect((await getSeasonDetail(me, id))!.next).toMatchObject({ scheduled: false });
  });

  it("with takeStart: the new first phase takes the start and the other season's next start is dropped", async () => {
    const old = await runningSeason();
    const id = await laterSeason();
    const p = await addPhaseAction({ seasonId: id, name: "General", durationWeeks: 4, takeStart: true });
    expect((await cycleRow(p.success ? p.data.cycleId : 0)).scheduledStartDate).toBe(day(2));
    expect((await cycleRow(old.waiting)).scheduledStartDate).toBeNull();
  });

  it("New season with cycles I already have takes the start only with takeStart", async () => {
    const old = await runningSeason();
    const [draft] = await db.insert(trainingCycles).values({ userId: me, name: "Draft block", durationWeeks: 4 }).returning();
    const made = await createSeasonAction({ name: "Later", startDate: day(5), endDate: day(90), cycleIds: [draft.id] });
    expect(made.success).toBe(true);
    expect((await cycleRow(draft.id)).scheduledStartDate).toBeNull();
    expect((await cycleRow(old.waiting)).scheduledStartDate).toBe(day(42));
  });

  it("Make a triathlon plan takes the start only with takeStart", async () => {
    const old = await runningSeason();
    const plan = { name: "Oslo Tri 2027", startDate: day(2), race: { name: "Oslo 70.3", raceDate: day(240), distance: "half" as const } };
    const first = await generateTriathlonPlan(plan);
    if (!first.success) throw new Error(first.error);
    expect((await getSeasonDetail(me, first.data.seasonId))!.next).toMatchObject({ scheduled: false });
    expect((await cycleRow(old.waiting)).scheduledStartDate).toBe(day(42));

    const second = await generateTriathlonPlan({ ...plan, name: "Oslo Tri 2027 b", takeStart: true });
    if (!second.success) throw new Error(second.error);
    expect((await getSeasonDetail(me, second.data.seasonId))!.next).toMatchObject({ scheduled: true, plannedStart: day(2) });
    expect((await cycleRow(old.waiting)).scheduledStartDate).toBeNull();
  });
});

describe("the screens get what a season start ends and drops", () => {
  it("New season, Add phase and the season page get the running cycle and the scheduled draft", async () => {
    const old = await runningSeason();
    const running = { id: old.running, name: "Base", startDate: day(0), durationWeeks: 6, durationDays: null, seasonId: old.seasonId };
    const scheduled = { id: old.waiting, name: "Build", day: day(42), season: { id: old.seasonId, name: "Jevnaker Half 2027" } };

    const form = propsOf<Parameters<typeof SeasonForm>[0]>(await NewSeasonPage({ searchParams: Promise.resolve({}) }), SeasonForm)!;
    expect(form).toMatchObject({ today: day(0), running, scheduled });

    const id = await laterSeason();
    const add = propsOf<Parameters<typeof AddPhaseForm>[0]>(await AddPhasePage({ params: Promise.resolve({ id: String(id) }) }), AddPhaseForm)!;
    expect(add).toMatchObject({ today: day(0), running, scheduled });

    const page = propsOf<Parameters<typeof SeasonDetailClient>[0]>(await SeasonPage({ params: Promise.resolve({ id: String(id) }) }), SeasonDetailClient)!;
    expect(page).toMatchObject({ running, scheduled });
  });
});
