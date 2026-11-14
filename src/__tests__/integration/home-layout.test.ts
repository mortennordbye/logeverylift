import Home from "@/app/page";
import { RENDERERS } from "@/components/features/home/widgets";
import type { HomeGridProps } from "@/components/features/home/HomeGrid";
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
import { isValidElement, type ReactElement, type ReactNode } from "react";
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
const LIFTER = { endurance: false, garmin: false, cycle: true };
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
    const endurance = defaultLayout({ endurance: true, garmin: false, cycle: true }).map(({ id, size, hidden }) => ({ id, size, hidden }));
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
    const visible = resolveLayout(row, { endurance: true, garmin: false, cycle: true }).filter((i) => !i.hidden).map((i) => i.id);
    // Kept items are appended after what the user saved (mergeForSave), still visible.
    expect(visible).toEqual(["title", "today", "week", "enduranceToday"]);
  });

  it("without an active cycle, a saved Cycle progress is kept but not taken from the client", async () => {
    const [cycle] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" })
      .returning();
    await saveHomeLayout({ items: items({ cycle: { size: "s", hidden: false } }), baseUpdatedAt: null, force: false });
    const base = ((await stored(me)) as StoredHomeLayout).updatedAt;
    expect(((await stored(me)) as StoredHomeLayout).items.find((i) => i.id === "cycle")).toEqual({ id: "cycle", size: "s", hidden: false });

    await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.id, cycle.id));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(base) + 1000));
    const noCycle = items().filter((i) => i.id !== "cycle");
    await saveHomeLayout({ items: [...noCycle, { id: "cycle", size: "m", hidden: true }], baseUpdatedAt: base, force: false });
    // The client's cycle item is not taken; the stored one stays, as it was.
    expect(((await stored(me)) as StoredHomeLayout).items.find((i) => i.id === "cycle")).toEqual({ id: "cycle", size: "s", hidden: false });
  });

  it("does not take a widget the user cannot have from the client", async () => {
    await saveHomeLayout({ items: [...items(), { id: "garminReadiness", size: "m", hidden: false }], baseUpdatedAt: null, force: false });
    expect(((await stored(me)) as StoredHomeLayout).items.map((i) => i.id)).not.toContain("garminReadiness");
  });

  it("a stored layout that does not parse renders the default, and a save from it is not a conflict", async () => {
    const broken = { v: 2, updatedAt: "2026-11-13T10:00:00.000Z", items: [] };
    await db.update(users).set({ homeLayout: broken as never }).where(eq(users.id, me));
    const grid = await homeGridProps();
    expect(grid.items).toEqual(defaultLayout(LIFTER).filter((i) => i.id !== "cycle"));
    const res = await saveHomeLayout({ items: items({ week: { size: "m" } }), baseUpdatedAt: grid.baseUpdatedAt, force: false });
    expect(res.success).toBe(true);
    expect(((await stored(me)) as StoredHomeLayout).v).toBe(1);
  });

  it("the column is in the account export", async () => {
    await saveHomeLayout({ items: items(), baseUpdatedAt: null, force: false });
    const data = await collectUserData(me);
    expect((data.user as { homeLayout: unknown }).homeLayout).toEqual(await stored(me));
  });
});

/** The props the home page gives HomeGrid. */
async function homeGridProps(): Promise<HomeGridProps> {
  const page = (await Home()) as ReactElement<{ children: ReactElement<HomeGridProps> }>;
  return page.props.children.props;
}

/**
 * Await every async Server Component in a tree, as the server would while it
 * streams. That is where a streamed widget's loader runs. Plain components
 * are not called: a client part would need React to render it.
 */
async function stream(node: ReactNode | unknown): Promise<void> {
  if (Array.isArray(node)) {
    for (const n of node) await stream(n);
    return;
  }
  if (!isValidElement(node)) return;
  const { type, props } = node as ReactElement<{ children?: ReactNode }>;
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    await (type as (p: unknown) => Promise<unknown>)(props);
    return;
  }
  await stream(props.children);
}

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
          items: items({ recentPrs: { hidden: false }, friendsActivity: { hidden: false } }),
        },
      })
      .where(eq(users.id, me));
    expect(await countHome()).toBe(before);
    // The two are really on the page (a repeated id would be dropped as hidden).
    expect(Object.keys((await homeGridProps()).slots)).toEqual(expect.arrayContaining(["recentPrs", "friendsActivity"]));
  });
});

describe("hidden streamed widgets (U5)", () => {
  async function loads(hidden: boolean) {
    await db
      .update(users)
      .set({
        homeLayout: {
          v: 1,
          updatedAt: "2026-11-13T10:00:00.000Z",
          items: items({ recentPrs: { hidden }, friendsActivity: { hidden } }),
        },
      })
      .where(eq(users.id, me));
    const prs = vi.spyOn(RENDERERS.recentPrs, "load");
    const friends = vi.spyOn(RENDERERS.friendsActivity, "load");
    await stream(Object.values((await homeGridProps()).slots));
    const n = [prs.mock.calls.length, friends.mock.calls.length];
    prs.mockRestore();
    friends.mockRestore();
    return n;
  }

  it("with Recent PRs and Friends hidden, their loaders never run", async () => {
    expect(await loads(true)).toEqual([0, 0]);
  });

  it("visible, each loader runs once (the harness sees a load)", async () => {
    expect(await loads(false)).toEqual([1, 1]);
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
