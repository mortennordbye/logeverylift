import type { DailyMetrics } from "@/lib/garmin/analytics/daily";
import { insightsFor } from "@/lib/garmin/analytics/insights";
import { formScore, readiness, type ReadinessInput } from "@/lib/garmin/analytics/readiness";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const neutral: ReadinessInput = {
  hrv: { lastNight: 70, mean7: 70, bandLow: 60, bandHigh: 81.7, state: "balanced" },
  restingHr: { today: 45, baseline: 45, sd: 2, flag: false },
  sleep: { seconds: 8 * 3600, needSeconds: 8 * 3600 },
  sleepDebtS: 0,
  tsb: 0,
  feel: [],
};

describe("readiness", () => {
  it("scores contributors against the athlete's own baseline", () => {
    const r = readiness(neutral)!;
    const by = Object.fromEntries(r.contributors.map((c) => [c.key, c.score]));
    expect(by.hrv).toBeCloseTo(50, -1);
    expect(by.restingHr).toBe(50);
    expect(by.sleep).toBe(100);
    expect(by.sleepDebt).toBe(100);
    expect(by.form).toBe(75);
    expect(r.signals).toBe(5);
  });

  it("drops a missing contributor and scales the rest, and needs 3 signals", () => {
    const fewer = readiness({ ...neutral, hrv: { ...neutral.hrv, mean7: null }, feel: [5] })!;
    expect(fewer.contributors.map((c) => c.key)).not.toContain("hrv");
    expect(fewer.contributors.find((c) => c.key === "feel")!.score).toBe(100);
    expect(readiness({ ...neutral, hrv: { ...neutral.hrv, mean7: null }, restingHr: { ...neutral.restingHr, today: null }, sleep: { seconds: null, needSeconds: null }, tsb: null })).toBeNull();
  });

  it("caps at 45 when HRV is low and resting HR is raised", () => {
    const r = readiness({ ...neutral, hrv: { ...neutral.hrv, state: "fatigued" }, restingHr: { ...neutral.restingHr, flag: true }, tsb: 20 })!;
    expect(r.score).toBe(45);
    expect(r.capped).toBe(true);
    expect(r.band).toBe("easy");
  });

  it("maps form onto 0 to 100", () => {
    expect(formScore(15)).toBe(100);
    expect(formScore(-10)).toBe(50);
    expect(formScore(-35)).toBe(0);
    expect(formScore(0)).toBe(75);
  });
});

/** A plain day: no load, balanced HRV, no flags. */
function day(i: number, over: Partial<DailyMetrics> = {}): DailyMetrics {
  const zero = { ctl: 30, atl: 30, tsb: 0, load: 0 };
  return {
    date: addDays("2026-08-01", i),
    entries: [],
    pmc: { total: zero, swim: zero, bike: zero, run: zero, strength: zero, other: zero },
    calibrating: false,
    ramp: 0,
    monotony: null,
    bands: { low: 0, mid: 0, high: 0 },
    hrv: { ms: 70, mean7: 70, bandLow: 60, bandHigh: 80, bandSource: "ours", cv7: 5, state: "balanced" },
    restingHr: { bpm: 45, mean7: 45, baseline: 45, sd: 2, flag: false },
    sleepDebtS: 0,
    regularity: 90,
    timing: { onsetSpread: 20, wakeSpread: 20, socialJetlag: 10 },
    sleepSeconds: 8 * 3600,
    sleepNeedS: 8 * 3600,
    readiness: null,
    ...over,
  };
}

const withLoad = (d: DailyMetrics, run: number): DailyMetrics => ({ ...d, pmc: { ...d.pmc, run: { ...d.pmc.run, load: run } } });

describe("insightsFor", () => {
  it("is silent on a plain, balanced day", () => {
    expect(insightsFor(Array.from({ length: 40 }, (_, i) => day(i)))).toEqual([]);
  });

  it("counts the days HRV has been under its band", () => {
    const days = Array.from({ length: 20 }, (_, i) => day(i, i >= 17 ? { hrv: { ...day(0).hrv, state: "fatigued" } } : {}));
    const [first] = insightsFor(days);
    expect(first).toMatchObject({ id: "hrv_low_week", severity: "warning", numbers: { days: 3 } });
    expect(first.text).toBe("HRV has been under your normal range for 3 days. Keep today easy.");
  });

  it("flags a load jump against the three weeks before", () => {
    const days = Array.from({ length: 28 }, (_, i) => withLoad(day(i), i >= 21 ? 120 : 40));
    expect(insightsFor(days).find((x) => x.id === "acwr_high")?.numbers.acwr).toBe(3);
  });

  it("points out weeks with no time above threshold", () => {
    const days = Array.from({ length: 28 }, (_, i) => day(i, { bands: { low: 3000, mid: 200, high: 0 } }));
    expect(insightsFor(days).map((x) => x.id)).toContain("no_high");
  });

  it("warns about sleep debt and irregular bedtimes, and ranks warnings first", () => {
    const days = Array.from({ length: 20 }, (_, i) =>
      day(i, i === 19 ? { sleepDebtS: 6 * 3600, timing: { onsetSpread: 75, wakeSpread: 30, socialJetlag: 40 }, ramp: 9 } : {}),
    );
    const ids = insightsFor(days).map((x) => x.id);
    expect(ids).toEqual(["ramp_fast", "sleep_debt", "sleep_irregular"]);
  });

  it("calls a fresh, ready day a good day for the hard session", () => {
    const fresh = day(30, { pmc: { ...day(0).pmc, total: { ctl: 40, atl: 30, tsb: 10, load: 0 } }, readiness: { score: 82, band: "go_hard", contributors: [], signals: 5, capped: false } });
    const ids = insightsFor([...Array.from({ length: 30 }, (_, i) => day(i)), fresh]).map((x) => x.id);
    expect(ids).toEqual(["fresh"]);
  });
});
