import { garminWeighIns } from "@/lib/garmin/weigh-ins";
import { describe, expect, it } from "vitest";

describe("garminWeighIns", () => {
  it("reads each weigh-in in kg, oldest first, once per timestamp", () => {
    const rows = [
      { items: [{ timestampGMT: 2000, weight: 89709 }] },
      { items: [{ timestampGMT: 1000, weight: 91500 }, { timestampGMT: 2000, weight: 89709 }] },
    ];
    expect(garminWeighIns(rows)).toEqual([
      { at: new Date(1000), kg: 91.5 },
      { at: new Date(2000), kg: 89.7 },
    ]);
  });

  it("falls back to `date`, and skips items without a time or a weight", () => {
    const rows = [{ items: [{ date: 3000, weight: 80000 }, { weight: 70000 }, { timestampGMT: 4000, weight: null }, { timestampGMT: 5000, weight: 0 }] }, null, {}];
    expect(garminWeighIns(rows)).toEqual([{ at: new Date(3000), kg: 80 }]);
  });
});
