import CycleDetailPage from "@/app/cycles/[id]/page";
import NewCyclePage from "@/app/cycles/new/page";
import EditSeasonPage from "@/app/seasons/[id]/edit/page";
import SeasonPage from "@/app/seasons/[id]/page";
import { createSeasonAction, deleteSeasonAction } from "@/lib/actions/seasons";
import { createTrainingCycle, deleteTrainingCycle } from "@/lib/actions/training-cycles";
import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Pages that delete the cycle or season they show. The delete's
 * revalidatePath makes Next render the current page again in the action
 * response. A notFound() there put a NEXT_HTTP_ERROR_FALLBACK;404 error into
 * the client tree while the client went back, and React reported it as
 * uncaught (minified error 441) when the Back landed first. These pages now
 * say the item was deleted; any other missing id is still not found.
 */

let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
});

function hrefsOf(tree: ReactNode): string[] {
  if (Array.isArray(tree)) return tree.flatMap(hrefsOf);
  if (!isValidElement(tree)) return [];
  const props = tree.props as { href?: string; children?: ReactNode };
  // Render our own components (PlanItemDeleted) to reach their links.
  if (typeof tree.type === "function" && tree.type !== Link) return hrefsOf((tree.type as (p: unknown) => ReactNode)(props));
  const own = tree.type === Link && props.href ? [props.href] : [];
  return [...own, ...hrefsOf(props.children)];
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
    expect(hrefsOf(await newCycle(id))).toEqual(["/cycles", "/cycles/deleted"]);
  });

  it("cycle detail says the cycle was deleted after Delete", async () => {
    const id = await cycle();
    expect((await deleteTrainingCycle(id)).success).toBe(true);
    expect(hrefsOf(await cycleDetail(id))).toEqual(["/cycles", "/cycles/deleted"]);
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
    expect(hrefsOf(await seasonDetail(id))).toEqual(["/cycles", "/cycles/deleted"]);
    expect(hrefsOf(await seasonEdit(id))).toEqual(["/cycles", "/cycles/deleted"]);
  });

  it("is still not found for another user's deleted season or a missing id", async () => {
    const { seasonId } = await othersDeleted();
    await expect(seasonDetail(seasonId)).rejects.toMatchObject(NOT_FOUND);
    await expect(seasonEdit(seasonId)).rejects.toMatchObject(NOT_FOUND);
    await expect(seasonDetail(999_999_999)).rejects.toMatchObject(NOT_FOUND);
    await expect(seasonEdit(999_999_999)).rejects.toMatchObject(NOT_FOUND);
  });
});
