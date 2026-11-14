import { db } from "@/db";
import { seasons, trainingCycles } from "@/db/schema";
import { selectToday } from "@/components/features/home/widgets/today/View";
import { selectTitle } from "@/components/features/home/widgets/title/View";
import { upcomingCycle } from "@/lib/cycle-start";
import { activeCycle, loadHomeCore } from "@/lib/home/core";
import { getUserSettings } from "@/lib/user-settings";
import { todayIn } from "@/lib/utils/user-date";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * With no active cycle, Today shows the block scheduled to start next
 * (`upcomingCycle` in src/lib/cycle-start.ts): only a live, scheduled draft of
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

describe("a running cycle that a scheduled start cuts (fix round 7)", () => {
  afterEach(() => vi.useRealTimers());

  it("counts its weeks and its end to the day before the scheduled start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z")); // Saturday
    asUser(me);
    await db.insert(trainingCycles).values({ userId: me, name: "Base", durationWeeks: 7, status: "active", startDate: "2026-11-09" });
    await db.insert(trainingCycles).values({ userId: me, name: "Build", durationWeeks: 4, scheduledStartDate: "2026-11-16" });

    const session = { user: { id: me, role: "user" as const, name: "Test", email: "t@test.local" }, session: {} };
    const settings = await getUserSettings(me);
    const core = await loadHomeCore(session as never, settings, todayIn(settings.timeZone, new Date()), await activeCycle());
    expect(core.upcoming).toBeNull();
    expect(selectTitle(core).cycleWeek).toBe("Week 1 of 1");
    expect(selectToday(core).cycle).toMatchObject({ currentWeek: 1, durationWeeks: 1, endFormatted: "Nov 15" });
  });
});
