import { computePmc, TRACKS } from "@/lib/garmin/analytics/pmc";
import { SPORTS } from "@/lib/garmin/analytics/sport";
import {
  distributionOption,
  formBand,
  loadHeadline,
  pmcOption,
  rangeStart,
  weeklyLoadOption,
  weeklyRows,
  weeksInRange,
  type LoadSeries,
} from "@/lib/garmin/charts/load";
import type { VizTheme } from "@/lib/garmin/charts/theme";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const theme: VizTheme = {
  text: "#fff",
  textMuted: "#aaa",
  grid: "#333",
  surface: "#262626",
  sport: { swim: "#1", bike: "#2", run: "#3", strength: "#4", other: "#5" },
  band: { low: "#l", mid: "#m", high: "#h" },
  positive: "#p",
  negative: "#n",
  status: { good: "#g", warning: "#w", serious: "#s", critical: "#c" },
  zones: ["#z1", "#z2", "#z3", "#z4", "#z5"],
};

/** A series of n days from 2026-01-05 (a Monday): run 60 on weekdays, strength 40 on Saturdays. */
function makeSeries(n: number): LoadSeries {
  const dates = Array.from({ length: n }, (_, i) => addDays("2026-01-05", i));
  const loads = Object.fromEntries(
    dates.map((d, i) => [d, i % 7 < 5 ? { run: 60 } : i % 7 === 5 ? { strength: 40 } : {}]),
  );
  const pmc = computePmc(loads, dates[0], dates.at(-1)!);
  const tracks = Object.fromEntries(TRACKS.map((t) => [t, { ctl: pmc.map((p) => p.tracks[t].ctl), atl: pmc.map((p) => p.tracks[t].atl), tsb: pmc.map((p) => p.tracks[t].tsb) }]));
  return {
    dates,
    calibrating: pmc.map((p) => p.calibrating),
    tracks: tracks as LoadSeries["tracks"],
    loads: Object.fromEntries(SPORTS.map((s) => [s, pmc.map((p) => p.tracks[s].load)])) as LoadSeries["loads"],
    bands: { low: dates.map(() => 2400), mid: dates.map(() => 600), high: dates.map(() => 0) },
  };
}

type Opt = { grid: unknown[]; xAxis: { gridIndex?: number }[]; yAxis: { gridIndex?: number }[]; series: { xAxisIndex?: number; yAxisIndex?: number; type: string; name: string; data: unknown[] }[] };

/** Each grid has exactly one y axis, and every series sits on the x and y axes of the same grid. */
function expectOneYAxisPerGrid(o: Opt) {
  expect(o.yAxis).toHaveLength(o.grid.length);
  const gridOfY = o.yAxis.map((y) => y.gridIndex ?? 0);
  expect(new Set(gridOfY).size).toBe(o.grid.length);
  for (const s of o.series) {
    expect(o.xAxis[s.xAxisIndex ?? 0].gridIndex ?? 0).toBe(gridOfY[s.yAxisIndex ?? 0]);
  }
}

describe("load charts", () => {
  const series = makeSeries(120);

  it("cuts the range from the end", () => {
    expect(rangeStart(series, "6w")).toBe(120 - 42);
    expect(rangeStart(series, "all")).toBe(0);
    expect(rangeStart(makeSeries(10), "3m")).toBe(0);
  });

  it("sums weeks from Monday, with ACWR and a distribution label", () => {
    const weeks = weeklyRows(series);
    expect(weeks[0].weekStart).toBe("2026-01-05");
    expect(weeks[0].loads).toMatchObject({ run: 300, strength: 40 });
    expect(weeks[0].total).toBe(340);
    expect(weeks[0].acwr).toBe(1);
    expect(weeks[3].acwr).toBeCloseTo(1, 5);
    expect(weeks[0].label).toBe("no_high");
    expect(weeksInRange(series, "6w").length).toBeLessThanOrEqual(7);
  });

  it("puts fitness and fatigue on one axis and form on its own", () => {
    const o = pmcOption(series, "total", "3m", theme) as unknown as Opt;
    expectOneYAxisPerGrid(o);
    const byName = Object.fromEntries(o.series.map((s) => [s.name, s]));
    expect(byName.Fitness.yAxisIndex).toBe(byName.Fatigue.yAxisIndex);
    expect(byName.Form.yAxisIndex).not.toBe(byName.Fitness.yAxisIndex);
    expect(byName.Fitness.data).toHaveLength(91);
  });

  it("stacks weekly load by sport, only for sports with load, rounding only the top segment", () => {
    const weeks = weeksInRange(series, "all");
    const o = weeklyLoadOption(weeks, theme) as unknown as Opt;
    expectOneYAxisPerGrid(o);
    const bars = o.series.filter((s) => s.type === "bar");
    expect(bars.map((s) => s.name)).toEqual(["Run", "Strength"]);
    const top = bars.find((s) => s.name === "Strength")!.data[0] as { itemStyle?: { borderRadius?: number[] } };
    const under = bars.find((s) => s.name === "Run")!.data[0] as { itemStyle?: { borderRadius?: number[] } };
    expect(top.itemStyle?.borderRadius).toEqual([4, 4, 0, 0]);
    expect(under.itemStyle).toBeUndefined();
  });

  it("shows intensity as 100 % stacks", () => {
    const o = distributionOption(weeksInRange(series, "6w"), theme) as unknown as Opt;
    expectOneYAxisPerGrid(o);
    const [low, mid, high] = o.series.map((s) => s.data[0] as number);
    expect(low + mid + high).toBeCloseTo(100, 0);
    expect(low).toBe(80);
  });

  it("writes the headline from the latest day", () => {
    expect(loadHeadline(series, "total")).toMatch(/^Fitness \d+ \([+-][\d.]+ this week\)\. Form [+-]\d+: \w+\.$/);
    expect(loadHeadline(makeSeries(10), "total")).toMatch(/^Calibrating\./);
    expect(formBand(-35)).toBe("overreaching");
    expect(formBand(-15)).toBe("productive");
    expect(formBand(0)).toBe("neutral");
    expect(formBand(10)).toBe("fresh");
  });
});
