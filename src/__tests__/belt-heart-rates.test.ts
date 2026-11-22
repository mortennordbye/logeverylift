import { beltHeartRates } from "@/lib/utils/belt-heart-rates";
import { describe, expect, it } from "vitest";

/** Treadmill belts with their heart rate, for the coach (docs/plans/strict-targets.md, decision 7). */

describe("beltHeartRates", () => {
  it("groups steps by belt to 0.1 km/h, weights heart rate by time, slowest belt first", () => {
    expect(
      beltHeartRates([
        { beltKmh: 9.5, avgHr: 150, seconds: 600 },
        { beltKmh: 9.0, avgHr: 140, seconds: 1200 },
        { beltKmh: 9.5 + 1e-9, avgHr: 156, seconds: 300 },
      ]),
    ).toEqual([
      { beltKmh: 9, avgHr: 140, minutes: 20, steps: 1 },
      { beltKmh: 9.5, avgHr: 152, minutes: 15, steps: 2 },
    ]);
  });

  it("leaves out steps with no time, and is empty with no steps", () => {
    expect(beltHeartRates([{ beltKmh: 10, avgHr: 160, seconds: 0 }])).toEqual([]);
    expect(beltHeartRates([])).toEqual([]);
  });
});
