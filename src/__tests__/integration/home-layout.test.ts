import Home from "@/app/page";
import { db, pool } from "@/db";
import { trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { collectUserData } from "@/lib/account-data";
import { saveHomeLayout } from "@/lib/actions/home-layout";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { activeCycle, loadHomeCore } from "@/lib/home/core";
import { defaultLayout, resolveLayout } from "@/lib/home/layout";
import type { StoredHomeLayout } from "@/lib/home/stored-layout";
import { getUserSettings } from "@/lib/user-settings";
import { todayIn } from "@/lib/utils/user-date";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The home layout against a real database (docs/home-widgets-audit.md,
 * section 7): the Server Action (I1), the page's query count with a streamed
 * widget visible (T2), and the write order on an auto-complete day (T3).
 */

let me: string;
let other: string;

beforeEach(async () => {
  const now = new Date();
  const consent = { timeZone: "UTC", termsVersion: LEGAL_VERSION, policySeenVersion: LEGAL_VERSION, termsAcceptedAt: now };
  me = (await createUser(consent)).id;
  other = (await createUser(consent)).id;
  asUser(me);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const stored = async (id: string) => (await db.select({ l: users.homeLayout }).from(users).where(eq(users.id, id)))[0].l;
const LIFTER = { endurance: false, garmin: false };
const items = (over: Partial<Record<string, { size?: "s" | "m" | "l"; hidden?: boolean }>> = {}) =>
  defaultLayout(LIFTER).map((i) => ({ id: i.id, size: over[i.id]?.size ?? i.size, hidden: over[i.id]?.hidden ?? i.hidden }));

describe("saveHomeLayout (I1)", () => {
  it("writes only the caller's row, with a fresh updatedAt", async () => {
    const res = await saveHomeLayout({ items: items({ today: { size: "s" } }), baseUpdatedAt: null, force: false });
    expect(res.success).toBe(true);
    const row = (await stored(me)) as StoredHomeLayout;
    expect(row.v).toBe(1);
    expect(row.items.find((i) => i.id === "today")?.size).toBe("s");
    expect(res.success && res.data.updatedAt).toBe(row.updatedAt);
    expect(await stored(other)).toBeNull();
  });

  it("refuses a hidden critical widget, an unknown id, a bad size, a repeated id, extra keys and too many items", async () => {
    const bad = [
      { items: items({ today: { hidden: true } }), baseUpdatedAt: null, force: false },
      { items: [...items(), { id: "nope", size: "m", hidden: false }], baseUpdatedAt: null, force: false },
      { items: items({ week: { size: "s" } }), baseUpdatedAt: null, force: false },
      { items: [...items(), { id: "today", size: "m", hidden: false }], baseUpdatedAt: null, force: false },
      { items: items(), baseUpdatedAt: null, force: false, userId: other },
      { items: [{ id: "today", size: "m", hidden: false, note: "free text" }], baseUpdatedAt: null, force: false },
      { items: Array.from({ length: 20 }, () => ({ id: "today", size: "m", hidden: false })), baseUpdatedAt: null, force: false },
      { items: [{ id: "cycle", size: "m", hidden: false, settings: { pinned: 3 } }], baseUpdatedAt: null, force: false },
    ];
    for (const data of bad) {
      const res = await saveHomeLayout(data);
      expect(res.success, JSON.stringify(data).slice(0, 80)).toBe(false);
    }
    expect(await stored(me)).toBeNull();
  });

  it("null resets to the default", async () => {
    await saveHomeLayout({ items: items({ week: { hidden: true } }), baseUpdatedAt: null, force: false });
    const base = ((await stored(me)) as StoredHomeLayout).updatedAt;
    const res = await saveHomeLayout({ items: null, baseUpdatedAt: base, force: false });
    expect(res).toEqual({ success: true, data: { updatedAt: null } });
    expect(await stored(me)).toBeNull();
  });

  it("a save from an older base is a conflict; force overwrites", async () => {
    await saveHomeLayout({ items: items({ today: { size: "s" } }), baseUpdatedAt: null, force: false });
    // The second device still edits from the default (base null).
    const stale = await saveHomeLayout({ items: items({ today: { size: "m" } }), baseUpdatedAt: null, force: false });
    expect(stale).toEqual({ success: false, error: "conflict" });
    expect(((await stored(me)) as StoredHomeLayout).items.find((i) => i.id === "today")?.size).toBe("s");

    const forced = await saveHomeLayout({ items: items({ today: { size: "m" } }), baseUpdatedAt: null, force: true });
    expect(forced.success).toBe(true);
    expect(((await stored(me)) as StoredHomeLayout).items.find((i) => i.id === "today")?.size).toBe("m");
  });

  it("a save from the current base succeeds", async () => {
    await saveHomeLayout({ items: items(), baseUpdatedAt: null, force: false });
    const base = ((await stored(me)) as StoredHomeLayout).updatedAt;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(base) + 1000));
    const res = await saveHomeLayout({ items: items({ week: { size: "m" } }), baseUpdatedAt: base, force: false });
    expect(res.success).toBe(true);
  });

  it("keeps the endurance widgets when the switch is off and the user saves", async () => {
    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, me));
    const endurance = defaultLayout({ endurance: true, garmin: false }).map(({ id, size, hidden }) => ({ id, size, hidden }));
    await saveHomeLayout({ items: endurance, baseUpdatedAt: null, force: false });
    let base = ((await stored(me)) as StoredHomeLayout).updatedAt;

    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(base) + 1000));
    await saveHomeLayout({ items: items({ week: { size: "m" } }), baseUpdatedAt: base, force: false });
    const row = (await stored(me)) as StoredHomeLayout;
    expect(row.items.map((i) => i.id)).toContain("enduranceToday");
    base = row.updatedAt;

    await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, me));
    const visible = resolveLayout(row, { endurance: true, garmin: false }).filter((i) => !i.hidden).map((i) => i.id);
    // Kept items are appended after what the user saved (mergeForSave), still visible.
    expect(visible).toEqual(["title", "today", "week", "enduranceToday"]);
  });

  it("does not take a widget the user cannot have from the client", async () => {
    await saveHomeLayout({ items: [...items(), { id: "garminReadiness", size: "m", hidden: false }], baseUpdatedAt: null, force: false });
    expect(((await stored(me)) as StoredHomeLayout).items.map((i) => i.id)).not.toContain("garminReadiness");
  });

  it("the column is in the account export", async () => {
    await saveHomeLayout({ items: items(), baseUpdatedAt: null, force: false });
    const data = await collectUserData(me);
    expect((data.user as { homeLayout: unknown }).homeLayout).toEqual(await stored(me));
  });
});

/** Statements sent while rendering the home once (the T2 harness in home-queries.test.ts). */
async function countHome(): Promise<number> {
  const query = vi.spyOn(pool, "query");
  const connect = vi.spyOn(pool, "connect");
  await Home();
  const n = query.mock.calls.length + connect.mock.calls.length;
  query.mockRestore();
  connect.mockRestore();
  return n;
}

describe("query count (T2)", () => {
  it("a visible streamed widget adds no query to the page itself; its loader runs inside its own Suspense", async () => {
    const before = await countHome();
    await db
      .update(users)
      .set({
        homeLayout: {
          v: 1,
          updatedAt: "2026-11-13T10:00:00.000Z",
          items: [...items(), { id: "recentPrs", size: "m", hidden: false }, { id: "friendsActivity", size: "m", hidden: false }],
        },
      })
      .where(eq(users.id, me));
    expect(await countHome()).toBe(before);
  });
});

describe("write order (T3)", () => {
  it("on an auto-complete day, today is done in both the Today data and the week's completed dates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z")); // Thursday
    const lift = await createExercise();
    const prog = (await createProgram(me, [{ exerciseId: lift.id, sets: [{}] }])).program.id;
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Auto", durationWeeks: 4, status: "active", startDate: "2026-11-02" })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, dayOfWeek: 4, programId: prog, autoComplete: true });

    const session = { user: { id: me, role: "user" as const, name: "Test", email: "t@test.local" }, session: {} };
    const settings = await getUserSettings(me);
    const today = todayIn(settings.timeZone, new Date());
    const core = await loadHomeCore(session as never, settings, today, await activeCycle());
    expect(core.completedToday).toBe(true);
    expect(core.todayAutoSession).not.toBeNull();
    expect(core.completedDates.has("2026-11-05")).toBe(true);
  });
});
