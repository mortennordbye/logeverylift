import { STRENGTH_PHASES, strengthDefault, strengthTable } from "@/lib/utils/strength-goal";
import { describe, expect, it } from "vitest";

/** The strength default by goal and phase (docs/plans/athlete-profile.md, 2.5; D10, D21). */

describe("strengthDefault", () => {
  it("keep muscle and get stronger: 2 in base, 1 in race-specific phases, 1 light in the taper, 0 in transition", () => {
    for (const goal of ["keep_muscle", "stronger"] as const) {
      expect(strengthTable(goal).map((r) => [r.phase, r.sessionsPerWeek])).toEqual([
        ["general", 2],
        ["base", 2],
        ["build", 1],
        ["peak", 1],
        ["taper", 1],
        ["maintain", 2],
        ["transition", 0],
      ]);
    }
  });

  it("minimal: one session a week, none in transition", () => {
    expect(strengthTable("minimal").map((r) => r.sessionsPerWeek)).toEqual([1, 1, 1, 1, 1, 1, 0]);
  });

  it("the taper is light: the last heavy session 7-10 days out", () => {
    const t = strengthDefault("stronger", "taper");
    expect(t.light).toBe(true);
    expect(t.scheme).toContain("7-10 days");
  });

  it("schemes follow the goal: heavy 3-6 with plyometrics early for stronger, moderate reps for keep muscle", () => {
    expect(strengthDefault("stronger", "base").scheme).toContain("3-6");
    expect(strengthDefault("stronger", "base").scheme).toContain("plyometrics");
    expect(strengthDefault("stronger", "build").scheme).toContain("No new exercises");
    expect(strengthDefault("keep_muscle", "base").scheme).toContain("6-10");
    expect(strengthDefault("minimal", "peak").scheme).toContain("full-body");
  });

  it("covers every phase, C1's included", () => {
    expect(STRENGTH_PHASES).toEqual(expect.arrayContaining(["general", "transition"]));
  });
});
