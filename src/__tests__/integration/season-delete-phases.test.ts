import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import { addPhaseAction, createSeasonAction } from "@/lib/actions/seasons";
import { deleteManyTrainingCycles, startTrainingCycle } from "@/lib/actions/training-cycles";
import { getSeasonDetail } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { seasonPaused } from "@/lib/utils/seasons";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Select mode deletes the running phase and the next one (fix round 8): the
 * phase left is not scheduled, and the season page dates it from today, not
 * from the season start two weeks ago.
 */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
});

describe("deleting a season's started phases", () => {
  it("dates the phase left from today, as the next phase to start", async () => {
    const s = await createSeasonAction({ name: "Winter", startDate: day(-14), endDate: day(200) });
    if (!s.success) throw new Error(s.error);
    const ids: number[] = [];
    for (const name of ["Base", "Build", "Peak and test"]) {
      const p = await addPhaseAction({ seasonId: s.data.id, name, durationWeeks: 3 });
      if (!p.success) throw new Error(p.error);
      ids.push(p.data.cycleId);
    }
    expect((await startTrainingCycle(ids[0])).success).toBe(true);
    // The running phase began with the season, two weeks ago.
    await db.update(trainingCycles).set({ startDate: day(-14) }).where(eq(trainingCycles.id, ids[0]));

    expect(await deleteManyTrainingCycles([ids[0], ids[1]])).toMatchObject({ success: true });

    const detail = (await getSeasonDetail(me, s.data.id))!;
    expect(detail.phases.map((p) => [p.name, p.start, p.end])).toEqual([["Peak and test", day(0), day(20)]]);
    expect(detail.next).toMatchObject({ scheduled: false, plannedStart: day(0) });
    expect(seasonPaused(detail.next!, detail.phases, day(0))).toBe(false);
  });
});
