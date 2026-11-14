import AddPhaseWeekPage from "@/app/seasons/[id]/phases/[cycleId]/week/page";
import { addPhaseAction, createSeasonAction } from "@/lib/actions/seasons";
import { deleteTrainingCycle } from "@/lib/actions/training-cycles";
import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Step 2 of Add phase, after its Cancel removed the phase. The delete's
 * revalidatePath makes Next render this page again in the action response.
 * A notFound() there put an error into the client tree while useReturnTo
 * went back, and React reported it as uncaught (minified error 441) when
 * the Back landed first. The page now says the phase was removed.
 */

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

const page = (seasonId: number, cycleId: number) =>
  AddPhaseWeekPage({ params: Promise.resolve({ id: String(seasonId), cycleId: String(cycleId) }) });

async function seasonWithPhase(name: string) {
  const s = await createSeasonAction({ name, startDate: "2027-01-04", endDate: "2027-06-01" });
  if (!s.success) throw new Error(s.error);
  const p = await addPhaseAction({ seasonId: s.data.id, name: "Recovery block", durationWeeks: 2 });
  if (!p.success) throw new Error(p.error);
  return { seasonId: s.data.id, cycleId: p.data.cycleId };
}

describe("add phase, step 2", () => {
  it("renders, without notFound, for a phase its Cancel just removed", async () => {
    const { seasonId, cycleId } = await seasonWithPhase("Spring block");
    expect((await deleteTrainingCycle(cycleId)).success).toBe(true);

    const tree = await page(seasonId, cycleId);
    expect(propsOf<{ href: string }>(tree, Link)?.href).toBe(`/seasons/${seasonId}`);
  });

  it("is still not found for a cycle that never was a phase of the season", async () => {
    const a = await seasonWithPhase("Spring block");
    const b = await seasonWithPhase("Autumn block");
    expect((await deleteTrainingCycle(b.cycleId)).success).toBe(true);

    await expect(page(a.seasonId, b.cycleId)).rejects.toThrow();
    await expect(page(a.seasonId, 999_999_999)).rejects.toThrow();
  });
});
