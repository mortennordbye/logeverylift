import { db } from "@/db";
import { seasons, trainingCycles } from "@/db/schema";
import { upcomingCycle } from "@/lib/home/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";

/**
 * With no active cycle, Today shows the block scheduled to start next
 * (`upcomingCycle` in src/lib/home/core.ts): only a live, scheduled draft of
 * this user, with its season's name.
 */

let me: string;

beforeEach(async () => {
  me = (await createUser()).id;
});

describe("upcomingCycle", () => {
  it("is null with no scheduled draft", async () => {
    await db.insert(trainingCycles).values({ userId: me, name: "Unscheduled draft", durationWeeks: 8 });
    expect(await upcomingCycle(me)).toBeNull();
  });

  it("returns the scheduled draft with its start and its season's name", async () => {
    const [season] = await db
      .insert(seasons)
      .values({ userId: me, name: "Jevnaker Half 2027", startDate: "2026-11-16", endDate: "2027-08-29" })
      .returning();
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "General", durationWeeks: 8, scheduledStartDate: "2026-11-16", seasonId: season.id })
      .returning();
    expect(await upcomingCycle(me)).toEqual({ id: cycle.id, name: "General", startsOn: "2026-11-16", seasonName: "Jevnaker Half 2027" });
  });

  it("ignores a deleted draft, another user's draft and a deleted season", async () => {
    const other = (await createUser()).id;
    await db.insert(trainingCycles).values({ userId: other, name: "Theirs", durationWeeks: 8, scheduledStartDate: "2026-11-16" });
    await db.insert(trainingCycles).values({ userId: me, name: "Deleted", durationWeeks: 8, scheduledStartDate: "2026-11-16", deletedAt: new Date() });
    expect(await upcomingCycle(me)).toBeNull();

    const [season] = await db
      .insert(seasons)
      .values({ userId: me, name: "Gone", startDate: "2026-11-16", endDate: "2027-08-29", deletedAt: new Date() })
      .returning();
    await db.insert(trainingCycles).values({ userId: me, name: "Mine", durationWeeks: 8, scheduledStartDate: "2026-11-20", seasonId: season.id });
    expect(await upcomingCycle(me)).toMatchObject({ name: "Mine", seasonName: null });
  });
});
