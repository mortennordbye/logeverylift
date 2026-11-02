import { describe, expect, it } from "vitest";
import { isCustomWeight } from "@/lib/utils/picker-options";
import {
  WEIGHT_STACKS,
  gapAbove,
  nearestRung,
  pickStack,
  stackLabel,
  stackRungs,
} from "@/lib/utils/weight-stacks";

describe("pickStack", () => {
  it("takes the most common pattern that contains the weight", () => {
    expect(pickStack([18])).toBe("kg4_5");
    expect(pickStack([18.1])).toBe("lb10");
    expect(pickStack([17])).toBe("kg1");
  });

  it("needs a pattern containing every weight of the session", () => {
    expect(pickStack([18, 22.5])).toBe("kg4_5");
    expect(pickStack([18, 20])).toBe("kg2");
  });

  it("finds nothing for a weight no pattern has", () => {
    expect(pickStack([17.3])).toBeNull();
    expect(pickStack([18, 17.3])).toBeNull();
    expect(pickStack([])).toBeNull();
  });
});

describe("the pattern list", () => {
  it("keeps every ladder ascending and above zero", () => {
    for (const { id } of WEIGHT_STACKS) {
      const rungs = stackRungs(id)!;
      expect(rungs[0]).toBeGreaterThan(0);
      expect(rungs.every((r, i) => i === 0 || r > rungs[i - 1])).toBe(true);
    }
  });

  it("writes pound stacks the way the plates read in kg", () => {
    expect(stackRungs("lb10")!.slice(0, 5)).toEqual([4.5, 9.1, 13.6, 18.1, 22.7]);
    expect(stackRungs("lb15_top10")!.slice(0, 4)).toEqual([4.5, 11.3, 18.1, 24.9]);
    expect(stackRungs("lb5")!.slice(0, 4)).toEqual([2.3, 4.5, 6.8, 9.1]);
  });

  it("treats an id no longer in the list as no pattern", () => {
    expect(stackRungs("retired")).toBeNull();
    expect(stackRungs(null)).toBeNull();
    expect(stackLabel("retired")).toBeNull();
  });

  it("names a pattern by its step", () => {
    expect(stackLabel("kg4_5")).toBe("4.5 kg steps");
    expect(stackLabel("lb10")).toBe("10 lb steps");
  });
});

describe("heavy machines", () => {
  it("knows weights well above 200 kg", () => {
    expect(pickStack([225])).toBe("kg5");
    expect(gapAbove(200, "kg5")).toBe(5);
    expect(nearestRung(205, "kg5")).toBe(205);
  });

  it("does not pull a load above the top of the list back down", () => {
    const top = stackRungs("kg5")!.at(-1)!;
    expect(nearestRung(top + 7, "kg5")).toBe(top + 7);
  });
});

describe("nearestRung", () => {
  it("snaps to the closest weight on the stack", () => {
    expect(nearestRung(23, "kg4_5")).toBe(22.5);
    expect(nearestRung(25.5, "kg4_5")).toBe(27);
  });

  it("goes up on a tie", () => {
    expect(nearestRung(7.5, "kg5")).toBe(10);
  });
});

describe("gapAbove", () => {
  it("is the distance to the next weight up", () => {
    expect(gapAbove(18, "kg4_5")).toBe(4.5);
    expect(gapAbove(19, "kg4_5")).toBeCloseTo(3.5);
    expect(gapAbove(0, "kg4_5")).toBe(4.5);
  });

  it("follows uneven gaps", () => {
    expect(gapAbove(18.1, "lb10")).toBeCloseTo(4.6);
  });

  it("keeps the last gap above the top of the stack", () => {
    const rungs = stackRungs("kg5")!;
    expect(gapAbove(rungs[rungs.length - 1] + 1, "kg5")).toBe(5);
  });
});

describe("isCustomWeight", () => {
  it("with no pattern, counts only what the picker and the engine cannot produce", () => {
    expect(isCustomWeight(18, null, "cable")).toBe(true);
    expect(isCustomWeight(17.5, null, "cable")).toBe(false);
    // Above 20 the picker moves to 2.5 steps but the engine still suggests 1.25
    // ones: accepting its own suggestion must not read as a custom weight.
    expect(isCustomWeight(41.25, null, "machine")).toBe(false);
  });

  it("with a pattern, counts anything off it", () => {
    expect(isCustomWeight(22.5, "kg4_5", "cable")).toBe(false);
    expect(isCustomWeight(20, "kg4_5", "cable")).toBe(true);
  });

  it("keeps the 1.25 kg exemption to equipment the engine moves in 1.25 steps", () => {
    expect(isCustomWeight(41.25, null, null)).toBe(false);
    expect(isCustomWeight(41.25, null, "dumbbell")).toBe(true);
    expect(isCustomWeight(41.25, null, "barbell")).toBe(true);
  });

  it("treats a retired pattern as none", () => {
    expect(isCustomWeight(17.5, "retired", "cable")).toBe(false);
  });
});
