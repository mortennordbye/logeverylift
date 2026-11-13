import { defaultLayout, type ResolvedItem } from "@/lib/home/layout";
import { editReducer, initEdit, movableItems, type EditAction, type EditState } from "@/lib/home/layout-reducer";
import { describe, expect, it } from "vitest";

/** U3 in docs/home-widgets-audit.md, section 7. */

const start = (): EditState =>
  initEdit([
    { id: "title", size: "m", hidden: false },
    { id: "today", size: "l", hidden: false },
    { id: "week", size: "l", hidden: false },
    { id: "cycle", size: "m", hidden: false },
    { id: "recentPrs", size: "m", hidden: true },
  ]);

const run = (s: EditState, ...actions: EditAction[]) => actions.reduce(editReducer, s);
const order = (s: EditState) => movableItems(s.items).map((i) => i.id);
const find = (s: EditState, id: string) => s.items.find((i) => i.id === id) as ResolvedItem;

describe("editReducer", () => {
  it("moveUp and moveDown swap with the neighbour", () => {
    expect(order(run(start(), { type: "moveUp", id: "week" }))).toEqual(["week", "today", "cycle"]);
    expect(order(run(start(), { type: "moveDown", id: "today" }))).toEqual(["week", "today", "cycle"]);
  });

  it("at the ends nothing changes and nothing goes on the undo stack", () => {
    const s = start();
    expect(run(s, { type: "moveUp", id: "today" })).toBe(s);
    expect(run(s, { type: "moveDown", id: "cycle" })).toBe(s);
  });

  it("the title stays first: no widget moves above it, and it does not move", () => {
    const s = start();
    expect(run(s, { type: "moveUp", id: "today" })).toBe(s);
    expect(run(s, { type: "move", id: "cycle", overId: "title" })).toBe(s);
    expect(run(s, { type: "move", id: "title", overId: "cycle" })).toBe(s);
  });

  it("moves skip hidden widgets", () => {
    const s = run(start(), { type: "hide", id: "week" });
    expect(order(run(s, { type: "moveUp", id: "cycle" }))).toEqual(["cycle", "today"]);
  });

  it("move puts the widget where the other one was (drag)", () => {
    expect(order(run(start(), { type: "move", id: "cycle", overId: "today" }))).toEqual(["cycle", "today", "week"]);
    expect(order(run(start(), { type: "move", id: "today", overId: "cycle" }))).toEqual(["week", "cycle", "today"]);
  });

  it("resize to an allowed size changes it; a size the widget does not offer is refused", () => {
    expect(find(run(start(), { type: "resize", id: "today", size: "s" }), "today").size).toBe("s");
    const s = start();
    expect(run(s, { type: "resize", id: "week", size: "s" })).toBe(s);
  });

  it("hide refuses a critical widget", () => {
    const s = start();
    expect(run(s, { type: "hide", id: "today" })).toBe(s);
  });

  it("show puts a hidden widget back at its old place and size", () => {
    const s = run(start(), { type: "resize", id: "week", size: "m" }, { type: "hide", id: "week" });
    expect(order(s)).toEqual(["today", "cycle"]);
    const back = run(s, { type: "show", id: "week" });
    expect(order(back)).toEqual(["today", "week", "cycle"]);
    expect(find(back, "week").size).toBe("m");
  });

  it("add puts a hidden widget last at its default size", () => {
    const s = run(start(), { type: "add", id: "recentPrs" });
    expect(order(s)).toEqual(["today", "week", "cycle", "recentPrs"]);
    expect(find(s, "recentPrs")).toEqual({ id: "recentPrs", size: "m", hidden: false });
  });

  it("undo steps back one change at a time", () => {
    const a = run(start(), { type: "moveUp", id: "week" }, { type: "hide", id: "cycle" });
    const b = run(a, { type: "undo" });
    expect(order(b)).toEqual(["week", "today", "cycle"]);
    const c = run(b, { type: "undo" });
    expect(c.items).toEqual(start().items);
    expect(run(c, { type: "undo" })).toBe(c);
  });

  it("reset gives the default and can be undone", () => {
    const def = defaultLayout({ endurance: false, garmin: false, cycle: true });
    const s = run(start(), { type: "reset", items: def });
    expect(s.items).toEqual(def);
    expect(run(s, { type: "undo" }).items).toEqual(start().items);
  });
});
