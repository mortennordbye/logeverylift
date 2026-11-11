import { MIN_PAIRS, findings, spearman, type CorrelationDay } from "@/lib/garmin/analytics/correlations";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const day = (i: number, over: Partial<CorrelationDay>): CorrelationDay => ({
  date: addDays("2026-01-01", i),
  hrvMs: null,
  hrvMean7: null,
  sleepH: null,
  sleepDebtH: null,
  regularity: null,
  load: null,
  highMin: null,
  strengthLoad: null,
  runEf: null,
  decoupling: null,
  ...over,
});

describe("spearman", () => {
  it("is 1 for any increasing relation, -1 for a decreasing one, and handles ties", () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [9, 7, 3, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 2, 2], [1, 1, 2, 2])).toBeCloseTo(1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("findings", () => {
  it("states a clear pair as a split, with HRV the morning after the load", () => {
    // Load on day i, HRV on day i + 1 falls as load rises.
    const days = Array.from({ length: 40 }, (_, i) => day(i, { load: (i % 10) * 20, hrvMs: i === 0 ? null : 90 - ((i - 1) % 10) * 3 }));
    const f = findings(days);
    const load = f.find((x) => x.id === "load_hrv")!;
    expect(load.rho).toBeCloseTo(-1);
    expect(load.n).toBe(39);
    expect(load.sentence).toMatch(/^With the day's training load at \d+ or more, HRV the next morning goes with \d+ % lower/);
  });

  it("stays silent under the minimum number of days or with no relation", () => {
    const few = Array.from({ length: MIN_PAIRS - 1 }, (_, i) => day(i, { sleepH: 6 + (i % 3), hrvMs: 60 + (i % 3) * 10 }));
    expect(findings(few)).toEqual([]);
    const flat = Array.from({ length: 40 }, (_, i) => day(i, { sleepH: 6 + (i % 4), hrvMs: 70 + ((i * 7) % 5) - 2 }));
    expect(findings(flat).find((x) => x.id === "sleep_hrv")).toBeUndefined();
  });
});
