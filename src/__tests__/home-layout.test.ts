import {
  afterTrainingRow,
  defaultLayout,
  itemSchema,
  mergeForSave,
  parseStoredLayout,
  resolveLayout,
  toRows,
  visibleStreamed,
  type ResolvedItem,
} from "@/lib/home/layout";
import { noticesIn } from "@/lib/home/notices";
import type { StoredHomeItem, StoredHomeLayout } from "@/lib/home/stored-layout";
import { afterEach, describe, expect, it, vi } from "vitest";

/** U1 and U2 in docs/home-widgets-audit.md, section 7. */

const LIFTER = { endurance: false, garmin: false, cycle: true };
const ENDURANCE = { endurance: true, garmin: false, cycle: true };
const ADMIN = { endurance: false, garmin: true, cycle: true };

const stored = (items: StoredHomeItem[]): StoredHomeLayout => ({ v: 1, updatedAt: "2026-11-13T10:00:00.000Z", items });
const visible = (items: ResolvedItem[]) => items.filter((i) => !i.hidden).map((i) => i.id);
const hidden = (items: ResolvedItem[]) => items.filter((i) => i.hidden).map((i) => i.id);

afterEach(() => vi.restoreAllMocks());

describe("resolveLayout (U1)", () => {
  it("null gives the default per audience", () => {
    expect(visible(resolveLayout(null, LIFTER))).toEqual(["title", "today", "week"]);
    expect(visible(resolveLayout(null, ENDURANCE))).toEqual(["title", "today", "enduranceToday", "week"]);
    expect(resolveLayout(null, LIFTER)).toEqual(defaultLayout(LIFTER));
  });

  it("the default lists every other available widget hidden, and nothing unavailable", () => {
    expect(hidden(defaultLayout(LIFTER))).toEqual(["cycle", "weeklyGoal", "recentPrs", "friendsActivity"]);
    expect(hidden(defaultLayout(ADMIN))).toContain("garminReadiness");
    expect(defaultLayout(LIFTER).map((i) => i.id)).not.toContain("enduranceToday");
  });

  it("default sizes: title M, today L, week L, endurance today M", () => {
    const sizes = Object.fromEntries(defaultLayout(ENDURANCE).map((i) => [i.id, i.size]));
    expect(sizes).toMatchObject({ title: "m", today: "l", enduranceToday: "m", week: "l" });
  });

  it("drops unknown and duplicate ids, keeping the first", () => {
    const r = resolveLayout(
      stored([
        { id: "week", size: "m", hidden: false },
        { id: "nope", size: "m", hidden: false },
        { id: "today", size: "s", hidden: false },
        { id: "week", size: "l", hidden: true },
      ]),
      LIFTER,
    );
    expect(r.slice(0, 2)).toEqual([
      { id: "week", size: "m", hidden: false },
      { id: "today", size: "s", hidden: false },
    ]);
    expect(r.map((i) => i.id)).not.toContain("nope");
    expect(r.filter((i) => i.id === "week")).toHaveLength(1);
  });

  it("a size the widget does not offer falls back to its default", () => {
    const r = resolveLayout(stored([{ id: "week", size: "s", hidden: false }]), LIFTER);
    expect(r.find((i) => i.id === "week")?.size).toBe("l");
  });

  it("a hidden critical widget becomes visible", () => {
    const r = resolveLayout(
      stored([
        { id: "today", size: "m", hidden: true },
        { id: "enduranceToday", size: "m", hidden: true },
      ]),
      ENDURANCE,
    );
    expect(r.find((i) => i.id === "today")?.hidden).toBe(false);
    expect(r.find((i) => i.id === "enduranceToday")?.hidden).toBe(false);
  });

  it("a missing critical widget is put back visible at its place: Today after the title, Endurance today after Today", () => {
    const r = resolveLayout(
      stored([
        { id: "week", size: "l", hidden: false },
        { id: "title", size: "m", hidden: false },
      ]),
      ENDURANCE,
    );
    expect(visible(r)).toEqual(["week", "title", "today", "enduranceToday"]);
  });

  it("a user who saved a layout and later gets the endurance switch sees Endurance today", () => {
    const saved = stored(defaultLayout(LIFTER));
    expect(visible(resolveLayout(saved, ENDURANCE))).toEqual(["title", "today", "enduranceToday", "week"]);
  });

  it("other missing widgets are appended hidden", () => {
    const r = resolveLayout(stored([{ id: "today", size: "l", hidden: false }]), LIFTER);
    expect(r[0].id).toBe("today");
    expect(r.slice(1).every((i) => i.hidden)).toBe(true);
    expect(r.map((i) => i.id)).toEqual(expect.arrayContaining(["title", "week", "recentPrs"]));
  });

  it("without a cycle, Cycle progress is not offered, and a saved one comes back with a cycle", () => {
    const NO_CYCLE = { ...LIFTER, cycle: false };
    expect(defaultLayout(NO_CYCLE).map((i) => i.id)).not.toContain("cycle");
    const saved = stored([
      { id: "today", size: "l", hidden: false },
      { id: "cycle", size: "s", hidden: false },
    ]);
    expect(resolveLayout(saved, NO_CYCLE).map((i) => i.id)).not.toContain("cycle");
    expect(mergeForSave(saved, [{ id: "today", size: "m", hidden: false }], NO_CYCLE).map((i) => i.id)).toEqual(["today", "cycle"]);
    expect(resolveLayout(saved, LIFTER).find((i) => i.id === "cycle")).toEqual({ id: "cycle", size: "s", hidden: false });
  });

  it("leaves out widgets the audience cannot have", () => {
    const r = resolveLayout(
      stored([
        { id: "garminReadiness", size: "m", hidden: false },
        { id: "enduranceToday", size: "m", hidden: false },
        { id: "today", size: "l", hidden: false },
      ]),
      LIFTER,
    );
    expect(r.map((i) => i.id)).not.toContain("garminReadiness");
    expect(r.map((i) => i.id)).not.toContain("enduranceToday");
  });
});

describe("parseStoredLayout (U1)", () => {
  it("null stays null", () => {
    expect(parseStoredLayout(null)).toBeNull();
  });

  it("a valid row parses", () => {
    const row = stored([{ id: "today", size: "l", hidden: false }]);
    expect(parseStoredLayout(row)).toEqual(row);
  });

  it("bad JSON gives null and logs only the user id", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseStoredLayout({ v: 2, items: [] }, "u1")).toBeNull();
    expect(log).toHaveBeenCalledWith("[homeLayout] invalid", { userId: "u1" });
  });

  it("strict: extra keys are refused, at the top and on an item", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseStoredLayout({ ...stored([]), extra: 1 })).toBeNull();
    expect(parseStoredLayout(stored([{ id: "today", size: "l", hidden: false, note: "x" } as StoredHomeItem]))).toBeNull();
  });

  it("settings hold ids and numbers, never free text", () => {
    expect(itemSchema.safeParse({ id: "x", size: "m", hidden: false, settings: { entryId: 12, kind: "abc-1" } }).success).toBe(true);
    expect(itemSchema.safeParse({ id: "x", size: "m", hidden: false, settings: { note: "I feel tired today" } }).success).toBe(false);
  });
});

describe("mergeForSave (U1)", () => {
  it("keeps stored items the user cannot see now, in their stored order", () => {
    const before = stored([
      { id: "enduranceToday", size: "m", hidden: false },
      { id: "today", size: "l", hidden: false },
      { id: "garminReadiness", size: "s", hidden: false },
    ]);
    const items: StoredHomeItem[] = [
      { id: "today", size: "m", hidden: false },
      { id: "week", size: "l", hidden: false },
    ];
    expect(mergeForSave(before, items, LIFTER).map((i) => i.id)).toEqual(["today", "week", "enduranceToday", "garminReadiness"]);
  });

  it("does not repeat an item the user saved, and drops unknown stored ids", () => {
    const before = stored([
      { id: "today", size: "l", hidden: false },
      { id: "gone", size: "m", hidden: false },
    ]);
    expect(mergeForSave(before, [{ id: "today", size: "s", hidden: false }], LIFTER)).toEqual([{ id: "today", size: "s", hidden: false }]);
  });
});

describe("the default home per user type (U2)", () => {
  /** The parts in render order, as the T1 e2e spec names them, with the notice slots. */
  function parts(audience: typeof LIFTER, notices: { afterTraining: string[] }) {
    const items = defaultLayout(audience);
    const rows = toRows(items);
    const at = afterTrainingRow(rows);
    const out = ["home-title"];
    rows.forEach((r, n) => {
      out.push(...r.ids);
      if (n === at) out.push(...notices.afterTraining);
    });
    return out;
  }

  it("lifter with a missed day: title, today, missed, week", () => {
    expect(parts(LIFTER, { afterTraining: ["missed"] })).toEqual(["home-title", "today", "missed", "week"]);
  });

  it("endurance: title, today, endurance today, did you do it, week", () => {
    expect(parts(ENDURANCE, { afterTraining: ["didYouDoIt"] })).toEqual(["home-title", "today", "enduranceToday", "didYouDoIt", "week"]);
  });

  it("the slots hold the notices in the old page's order", () => {
    expect(noticesIn("top")).toEqual(["policy", "checkin", "illness"]);
    expect(noticesIn("afterTraining")).toEqual(["readinessSwap", "didYouDoIt", "missed"]);
    expect(noticesIn("end")).toEqual(["share"]);
  });
});

describe("toRows", () => {
  it("pairs consecutive S widgets; a lone S takes half a row", () => {
    const items: ResolvedItem[] = [
      { id: "title", size: "m", hidden: false },
      { id: "today", size: "s", hidden: false },
      { id: "weeklyGoal", size: "s", hidden: false },
      { id: "cycle", size: "s", hidden: false },
      { id: "week", size: "l", hidden: false },
      { id: "recentPrs", size: "s", hidden: true },
    ];
    expect(toRows(items)).toEqual([
      { ids: ["today", "weeklyGoal"], half: true },
      { ids: ["cycle"], half: true },
      { ids: ["week"], half: false },
    ]);
  });

  it("the afterTraining slot follows the later training widget", () => {
    const rows = toRows([
      { id: "enduranceToday", size: "m", hidden: false },
      { id: "week", size: "l", hidden: false },
      { id: "today", size: "m", hidden: false },
    ]);
    expect(afterTrainingRow(rows)).toBe(2);
  });
});

describe("visibleStreamed (U5)", () => {
  it("is exactly the visible streamed widgets; a hidden one is never loaded", () => {
    const items: ResolvedItem[] = [
      ...defaultLayout(ADMIN).filter((i) => i.id !== "recentPrs" && i.id !== "garminReadiness"),
      { id: "recentPrs", size: "m", hidden: false },
      { id: "garminReadiness", size: "m", hidden: true },
    ];
    expect(visibleStreamed(items)).toEqual(["recentPrs"]);
    expect(visibleStreamed(defaultLayout(ADMIN))).toEqual([]);
  });
});
