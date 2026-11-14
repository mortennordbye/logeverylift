import CycleDetailPage from "@/app/cycles/[id]/page";
import NewCyclePage from "@/app/cycles/new/page";
import EditSeasonPage from "@/app/seasons/[id]/edit/page";
import SeasonPage from "@/app/seasons/[id]/page";
import { createSeasonAction, deleteSeasonAction } from "@/lib/actions/seasons";
import { createTrainingCycle, deleteTrainingCycle } from "@/lib/actions/training-cycles";
import { PlanItemDeleted } from "@/components/features/PlanItemDeleted";
import { db } from "@/db";
import { planRevisions, trainingCycles } from "@/db/schema";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import { deletedPlanCount, type DeletedItem } from "@/lib/plan-deleted";
import { and, desc, eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Pages that delete the cycle or season they show. The delete's
 * revalidatePath makes Next render the current page again in the action
 * response. A notFound() there put a NEXT_HTTP_ERROR_FALLBACK;404 error into
 * the client tree while the client went back, and React reported it as
 * uncaught (minified error 441) when the Back landed first. These pages now
 * say the item was deleted, by name, with the revision Restore brings back;
 * any other missing id is still not found.
 */

let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
});

/** The deleted state a page rendered: the item it names and the revision its Restore brings back. */
function deletedItem(tree: ReactNode) {
  expect(isValidElement(tree) && tree.type === PlanItemDeleted).toBe(true);
  return (tree as ReactElement<{ item: DeletedItem }>).props.item;
}

/** The newest delete revision of an object, which Recently deleted restores too. */
async function deleteRevision(type: "cycle" | "season", id: number) {
  const [row] = await db
    .select({ id: planRevisions.id })
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, type), eq(planRevisions.objectId, id), eq(planRevisions.action, "delete")))
    .orderBy(desc(planRevisions.id))
    .limit(1);
  return row.id;
}

const NOT_FOUND = { digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") };

async function cycle(name = "Base block") {
  const r = await createTrainingCycle({ name, durationWeeks: 4, scheduleType: "day_of_week" });
  if (!r.success) throw new Error(r.error);
  return r.data.id;
}

async function season(name = "Spring") {
  const r = await createSeasonAction({ name, startDate: "2027-01-04", endDate: "2027-06-01" });
  if (!r.success) throw new Error(r.error);
  return r.data.id;
}

/** A cycle and a season of another user, both deleted by that user. */
async function othersDeleted() {
  const other = (await createUser({ timeZone: "UTC" })).id;
  asUser(other);
  const cycleId = await cycle("Theirs");
  expect((await deleteTrainingCycle(cycleId)).success).toBe(true);
  const seasonId = await season("Theirs");
  expect((await deleteSeasonAction({ seasonId })).success).toBe(true);
  asUser(me);
  return { cycleId, seasonId };
}

const newCycle = (id: number) => NewCyclePage({ searchParams: Promise.resolve({ cycle: String(id) }) });
const cycleDetail = (id: number) => CycleDetailPage({ params: Promise.resolve({ id: String(id) }) });
const seasonDetail = (id: number) => SeasonPage({ params: Promise.resolve({ id: String(id) }) });
const seasonEdit = (id: number) => EditSeasonPage({ params: Promise.resolve({ id: String(id) }) });

describe("a page whose cycle was just deleted", () => {
  it("new cycle step 2 says the draft was deleted after Discard", async () => {
    const id = await cycle();
    expect((await deleteTrainingCycle(id)).success).toBe(true);
    expect(deletedItem(await newCycle(id))).toEqual({ what: "cycle", name: "Base block", revisionId: await deleteRevision("cycle", id) });
  });

  it("cycle detail says the cycle was deleted after Delete", async () => {
    const id = await cycle();
    expect((await deleteTrainingCycle(id)).success).toBe(true);
    expect(deletedItem(await cycleDetail(id))).toEqual({ what: "cycle", name: "Base block", revisionId: await deleteRevision("cycle", id) });
  });

  it("restores the cycle with the revision the page offers", async () => {
    const id = await cycle();
    expect((await deleteTrainingCycle(id)).success).toBe(true);
    const { revisionId } = deletedItem(await cycleDetail(id));
    expect((await restorePlanRevision({ revisionId })).success).toBe(true);
    const [row] = await db.select({ deletedAt: trainingCycles.deletedAt }).from(trainingCycles).where(eq(trainingCycles.id, id));
    expect(row.deletedAt).toBeNull();
  });

  it("is still not found for another user's deleted cycle or a missing id", async () => {
    const { cycleId } = await othersDeleted();
    await expect(newCycle(cycleId)).rejects.toMatchObject(NOT_FOUND);
    await expect(cycleDetail(cycleId)).rejects.toMatchObject(NOT_FOUND);
    await expect(newCycle(999_999_999)).rejects.toMatchObject(NOT_FOUND);
    await expect(cycleDetail(999_999_999)).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("a page whose season was just deleted", () => {
  it("season detail and edit say the season was deleted", async () => {
    const id = await season();
    expect((await deleteSeasonAction({ seasonId: id })).success).toBe(true);
    const item = { what: "season", name: "Spring", revisionId: await deleteRevision("season", id) };
    expect(deletedItem(await seasonDetail(id))).toEqual(item);
    expect(deletedItem(await seasonEdit(id))).toEqual(item);
  });

  it("is still not found for another user's deleted season or a missing id", async () => {
    const { seasonId } = await othersDeleted();
    await expect(seasonDetail(seasonId)).rejects.toMatchObject(NOT_FOUND);
    await expect(seasonEdit(seasonId)).rejects.toMatchObject(NOT_FOUND);
    await expect(seasonDetail(999_999_999)).rejects.toMatchObject(NOT_FOUND);
    await expect(seasonEdit(999_999_999)).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("the Plan list's Recently deleted count", () => {
  it("counts the user's deleted cycles and seasons, not another user's or live ones", async () => {
    await othersDeleted();
    const gone = await cycle("Gone");
    expect((await deleteTrainingCycle(gone)).success).toBe(true);
    const goneSeason = await season("Gone");
    expect((await deleteSeasonAction({ seasonId: goneSeason })).success).toBe(true);
    await cycle("Kept");
    await season("Kept");
    expect(await deletedPlanCount(me)).toBe(2);
  });
});
