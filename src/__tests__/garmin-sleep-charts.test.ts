import { clockLabel, durationOption, durationRows, hrvOption, minutesAfter18, recoveryStackOption, stagesOption, timingOption, timingRows } from "@/lib/garmin/charts/sleep";
import type { VizTheme } from "@/lib/garmin/charts/theme";
import type { SleepTabData } from "@/lib/garmin/queries";
import { describe, expect, it } from "vitest";

const theme = {
  text: "#fff", textMuted: "#aaa", grid: "#333", surface: "#262626",
  sport: { swim: "#1", bike: "#2", run: "#3", strength: "#4", other: "#5" },
  band: { low: "#l", mid: "#m", high: "#h" }, positive: "#p", negative: "#n",
  status: { good: "#g", warning: "#w", serious: "#s", critical: "#c" },
  zones: ["#z1", "#z2", "#z3", "#z4", "#z5"],
} as VizTheme;

const at = (iso: string) => Date.parse(`${iso}Z`);

const data: SleepTabData = {
  nights: [
    { date: "2026-11-04", start: at("2026-11-03T23:30:00"), end: at("2026-11-04T07:00:00"), seconds: 7 * 3600, needS: 8 * 3600, deep: 3600, light: 4 * 3600, rem: 7200, awake: 0, score: 80 },
    { date: "2026-11-05", start: at("2026-11-05T00:30:00"), end: at("2026-11-05T08:00:00"), seconds: 8 * 3600, needS: 8 * 3600, deep: 0, light: 0, rem: 0, awake: 0, score: null },
  ],
  days: [
    { date: "2026-11-04", hrv: { ms: 70, mean7: 72, bandLow: 60, bandHigh: 80, bandSource: "ours", cv7: 6, state: "balanced" }, restingHr: { bpm: 45, mean7: 45, baseline: 45, sd: 1, flag: false }, sleepDebtS: 3600, regularity: 80, timing: { onsetSpread: 30, wakeSpread: 30, socialJetlag: 20 }, load: 80 },
    { date: "2026-11-05", hrv: { ms: null, mean7: null, bandLow: null, bandHigh: null, bandSource: null, cv7: null, state: "calibrating" }, restingHr: { bpm: null, mean7: null, baseline: null, sd: null, flag: false }, sleepDebtS: null, regularity: null, timing: { onsetSpread: null, wakeSpread: null, socialJetlag: null }, load: 0 },
  ],
  stress: [],
};

type Opt = { grid: unknown[]; yAxis: unknown[]; series: { name: string; data: unknown[] }[] };

describe("sleep charts", () => {
  it("puts clock times on an axis that starts at 18:00 and crosses midnight", () => {
    expect(minutesAfter18(at("2026-11-03T18:00:00"))).toBe(0);
    expect(minutesAfter18(at("2026-11-03T23:30:00"))).toBe(330);
    expect(minutesAfter18(at("2026-11-04T07:00:00"))).toBe(780);
    expect(clockLabel(780)).toBe("07:00");
  });

  it("draws each night from onset to wake, the second bar stacked on an invisible base", () => {
    const rows = timingRows(data);
    expect(rows[0]).toEqual({ date: "2026-11-04", onset: 330, wake: 780 });
    expect(rows[1].onset).toBe(390);
    const o = timingOption(rows, theme) as unknown as Opt;
    expect(o.yAxis).toHaveLength(o.grid.length);
    expect(o.series.map((s) => s.data)).toEqual([[330, 390], [450, 450]]);
  });

  it("gives duration and debt their own axes, and colours a short night", () => {
    const rows = durationRows(data);
    expect(rows[0]).toMatchObject({ hours: 7, needH: 8, debtH: 1 });
    const o = durationOption(rows, theme) as unknown as Opt;
    expect(o.yAxis).toHaveLength(2);
    const slept = o.series.find((s) => s.name === "Slept")!.data as { itemStyle: { color: string } }[];
    expect(slept[0].itemStyle.color).toBe("#2");
    expect(slept[1].itemStyle.color).toBe("#p");
  });

  it("skips nights without stage totals and shows shares that add to 100", () => {
    const o = stagesOption(data, theme) as unknown as Opt;
    expect(o.series[0].data).toHaveLength(1);
    expect(o.series.reduce((s, x) => s + (x.data[0] as number), 0)).toBeCloseTo(100, 0);
  });

  it("draws the HRV band as a floor plus a height, so the band reads low to high", () => {
    const o = hrvOption(data, theme) as unknown as Opt;
    expect(o.yAxis).toHaveLength(o.grid.length);
    expect(o.series.find((s) => s.name === "band floor")!.data[0]).toBe(60);
    expect(o.series.find((s) => s.name === "Normal range")!.data[0]).toBe(20);
  });

  it("stacks load, HRV, resting HR and sleep debt on one date axis, one y axis per grid", () => {
    const o = recoveryStackOption(data, theme) as unknown as Opt & { xAxis: { data: string[] }[] };
    expect(o.grid).toHaveLength(4);
    expect(o.yAxis).toHaveLength(4);
    expect(new Set(o.xAxis.map((x) => x.data.join()))).toEqual(new Set(["2026-11-04,2026-11-05"]));
    expect(o.series.find((s) => s.name === "Load")!.data).toEqual([80, 0]);
    expect(o.series.find((s) => s.name === "Sleep debt")!.data).toEqual([1, null]);
    // A gap stays a gap.
    expect(o.series.find((s) => s.name === "HRV 7-day")!.data).toEqual([72, null]);
  });
});
