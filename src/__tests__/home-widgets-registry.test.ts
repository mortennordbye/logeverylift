import { RETIRED_IDS, WIDGETS, widgetDef } from "@/lib/home/widgets";
import { describe, expect, it } from "vitest";

/** U4 in docs/home-widgets-audit.md, section 7: the registry keeps its own rules. */

const defs = Object.entries(WIDGETS);

describe("widget registry", () => {
  it("each key is its def's id, and ids are unique", () => {
    for (const [key, def] of defs) expect(def.id).toBe(key);
    expect(new Set(defs.map(([, d]) => d.id)).size).toBe(defs.length);
  });

  it("each default size is one of the widget's sizes", () => {
    for (const [, def] of defs) expect(def.sizes).toContain(def.defaultSize);
  });

  it("Today and Endurance today are critical, and nothing else is", () => {
    expect(defs.filter(([, d]) => d.critical).map(([id]) => id)).toEqual(["today", "enduranceToday"]);
  });

  it("no live id is also retired", () => {
    for (const [id] of defs) expect(RETIRED_IDS).not.toContain(id);
  });

  it("exactly one header", () => {
    expect(defs.filter(([, d]) => d.kind === "header").map(([id]) => id)).toEqual(["title"]);
  });

  it("new widgets are hidden by default for every audience", () => {
    const audiences = [
      { endurance: false, garmin: false, cycle: true },
      { endurance: true, garmin: true, cycle: true },
    ];
    for (const id of ["recentPrs", "friendsActivity", "garminReadiness"] as const) {
      for (const a of audiences) expect(widgetDef(id).defaultVisible(a)).toBe(false);
    }
  });
});
