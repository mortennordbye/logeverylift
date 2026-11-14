/**
 * The Load tab's data and chart options (docs/plans/garmin-insights-design.md, 3.3).
 * Pure: the page passes the series in, the EChart component draws the result.
 * Rules enforced here: one y axis per grid, thin marks, rounded data ends only
 * at the top of a stack, a surface gap between stacked segments, calibrating
 * days marked.
 */

import { uncoupledAcwr } from "@/lib/utils/periodization";
import { addDays, mondayOf } from "../dates";
import { RACE_TSB, type Projection } from "../analytics/projection";
import type { Track } from "../analytics/pmc";
import { SPORTS, type Sport } from "../analytics/sport";
import { distributionLabel, type DistributionLabel } from "../analytics/zones";
import { SPORT_LABEL, type VizTheme } from "./theme";
import { dateLabel } from "@/lib/utils/date-label";

export type LoadSeries = {
  dates: string[];
  calibrating: boolean[];
  tracks: Record<Track, { ctl: number[]; atl: number[]; tsb: number[] }>;
  loads: Record<Sport, number[]>;
  bands: { low: number[]; mid: number[]; high: number[] };
};

export type RangeKey = "6w" | "3m" | "1y" | "all";
export const RANGE_DAYS: Record<RangeKey, number | null> = { "6w": 42, "3m": 91, "1y": 365, all: null };
export const RANGE_LABEL: Record<RangeKey, string> = { "6w": "6W", "3m": "3M", "1y": "1Y", all: "All" };

/** Index of the first day shown for a range. */
export function rangeStart(series: LoadSeries, range: RangeKey): number {
  const days = RANGE_DAYS[range];
  return days === null ? 0 : Math.max(0, series.dates.length - days);
}

export const r1 = (n: number) => Math.round(n * 10) / 10;

export function shortDate(date: string) {
  return dateLabel(date, "d MMM");
}

// ── Form bands ──────────────────────────────────────────────────────────────

export type FormBand = "transition" | "fresh" | "neutral" | "productive" | "overreaching";
export const FORM_BANDS: { band: FormBand; label: string; from: number; to: number }[] = [
  { band: "transition", label: "Transition", from: 25, to: 1000 },
  { band: "fresh", label: "Fresh", from: 5, to: 25 },
  { band: "neutral", label: "Neutral", from: -10, to: 5 },
  { band: "productive", label: "Productive", from: -30, to: -10 },
  { band: "overreaching", label: "Overreaching", from: -1000, to: -30 },
];

export function formBand(tsb: number): FormBand {
  return FORM_BANDS.find((b) => tsb >= b.from && tsb < b.to)?.band ?? "neutral";
}

export function formBandLabel(tsb: number): string {
  return FORM_BANDS.find((b) => b.band === formBand(tsb))!.label;
}

// ── Weeks ───────────────────────────────────────────────────────────────────

export type WeekRow = {
  weekStart: string;
  loads: Record<Sport, number>;
  total: number;
  acwr: number;
  bands: { low: number; mid: number; high: number };
  label: DistributionLabel;
};

/** Weekly totals (Monday start) over the whole series, with ACWR from the existing uncoupledAcwr. */
export function weeklyRows(series: LoadSeries): WeekRow[] {
  const weeks: WeekRow[] = [];
  series.dates.forEach((date, i) => {
    const ws = mondayOf(date);
    let w = weeks.at(-1);
    if (!w || w.weekStart !== ws) {
      w = { weekStart: ws, loads: { swim: 0, bike: 0, run: 0, strength: 0, other: 0 }, total: 0, acwr: 1, bands: { low: 0, mid: 0, high: 0 }, label: "no_data" };
      weeks.push(w);
    }
    for (const sport of SPORTS) w.loads[sport] += series.loads[sport][i] ?? 0;
    w.bands.low += series.bands.low[i] ?? 0;
    w.bands.mid += series.bands.mid[i] ?? 0;
    w.bands.high += series.bands.high[i] ?? 0;
  });
  for (const w of weeks) {
    w.total = SPORTS.reduce((s, sp) => s + w.loads[sp], 0);
    w.label = distributionLabel(w.bands);
  }
  const acwr = uncoupledAcwr(weeks.map((w) => w.total));
  weeks.forEach((w, i) => (w.acwr = acwr[i]));
  return weeks;
}

/** The newest week with any load, or with any HR time when bands is set: the readouts' default. */
export function latestWeekWithData(weeks: WeekRow[], bands = false): number {
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    if (bands ? w.bands.low + w.bands.mid + w.bands.high > 0 : w.total > 0) return i;
  }
  return Math.max(0, weeks.length - 1);
}

export function weeksInRange(series: LoadSeries, range: RangeKey): WeekRow[] {
  const from = series.dates[rangeStart(series, range)];
  return weeklyRows(series).filter((w) => w.weekStart >= mondayOf(from ?? "0000-01-01"));
}

// ── Headline ────────────────────────────────────────────────────────────────

/** The one sentence at the top of the tab (3.1: answer first, charts as evidence). */
export function loadHeadline(series: LoadSeries, track: Track): string {
  const n = series.dates.length;
  if (n === 0) return "No training load yet. It appears as Garmin activities import.";
  const t = series.tracks[track];
  const today = n - 1;
  const ctl = t.ctl[today];
  const week = today >= 7 ? ctl - t.ctl[today - 7] : null;
  const tsb = t.tsb[today];
  // Sign from the rounded value, so -0.04 reads "+0", not "0" or "-0".
  const signed = (v: number) => `${v >= 0 ? "+" : ""}${v}`;
  const parts = [`Fitness ${Math.round(ctl)}${week !== null ? ` (${signed(r1(week) + 0)} this week)` : ""}.`];
  parts.push(`Form ${signed(Math.round(tsb) + 0)}: ${formBandLabel(tsb).toLowerCase()}.`);
  if (series.calibrating[today]) parts.unshift("Calibrating.");
  return parts.join(" ");
}

// ── Chart options ───────────────────────────────────────────────────────────

export const AXIS_FONT = 10;
export const GRID_SIDES = { left: 34, right: 10 };

export function axisCommon(theme: VizTheme) {
  return {
    axisLine: { lineStyle: { color: theme.grid } },
    axisTick: { show: false },
    axisLabel: { color: theme.textMuted, fontSize: AXIS_FONT },
    splitLine: { lineStyle: { color: theme.grid, width: 1 } },
  };
}

export function pointer(theme: VizTheme) {
  return {
    tooltip: { trigger: "axis", showContent: false, triggerOn: "mousemove|click", axisPointer: { type: "line", lineStyle: { color: theme.textMuted, width: 1 } } },
    axisPointer: { link: [{ xAxisIndex: "all" }], snap: true },
  };
}

/**
 * Three stacked grids on one x axis and one crosshair, each with its own y axis:
 * fitness and fatigue (same unit), form, and daily load. Daily load gets its
 * own strip because single days reach 3 to 5 times fitness and would flatten the lines.
 */
export function pmcOption(series: LoadSeries, track: Track, range: RangeKey, theme: VizTheme, projection: Projection | null = null) {
  const from = rangeStart(series, range);
  // The plan runs on to race day (total only: the projection is for all sports together).
  const plan = track === "total" ? projection : null;
  const future = plan?.dates ?? [];
  const pad = (xs: (number | null)[]) => [...xs, ...future.map(() => null)];
  const dates = [...series.dates.slice(from), ...future];
  const histLen = series.dates.length - from;
  // The plan lines start at today's value so they join the history.
  const joined = (todayValue: number, values: number[]) => [...Array(histLen - 1).fill(null), r1(todayValue), ...values.map(r1)];
  const t = series.tracks[track];
  const dailyLoad = series.dates.map((_, i) => (track === "total" ? SPORTS.reduce((s, sp) => s + (series.loads[sp][i] ?? 0), 0) : (series.loads[track][i] ?? 0))).slice(from);
  const calibratingEnd = series.calibrating.lastIndexOf(true) - from;
  const ax = axisCommon(theme);

  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [
      { top: 8, height: 140, ...GRID_SIDES },
      { top: 162, height: 70, ...GRID_SIDES },
      { top: 246, height: 40, ...GRID_SIDES },
    ],
    xAxis: [
      { type: "category", data: dates, gridIndex: 0, boundaryGap: true, ...ax, axisLabel: { show: false }, splitLine: { show: false } },
      { type: "category", data: dates, gridIndex: 1, boundaryGap: true, ...ax, axisLabel: { show: false }, splitLine: { show: false } },
      { type: "category", data: dates, gridIndex: 2, boundaryGap: true, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, ...ax, splitNumber: 3, min: 0 },
      { type: "value", gridIndex: 1, ...ax, splitNumber: 2 },
      { type: "value", gridIndex: 2, ...ax, splitNumber: 1, min: 0 },
    ],
    series: [
      {
        name: "Daily load",
        type: "bar",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: pad(dailyLoad.map(r1)),
        barMaxWidth: 6,
        itemStyle: { color: theme.textMuted, opacity: 0.35, borderRadius: [2, 2, 0, 0] },
        emphasis: { disabled: true },
        ...(calibratingEnd >= 0
          ? {
              markArea: {
                silent: true,
                itemStyle: { color: theme.grid, opacity: 0.5 },
                label: { show: true, position: "insideTopLeft", color: theme.textMuted, fontSize: AXIS_FONT, formatter: "Calibrating" },
                data: [[{ xAxis: dates[0] }, { xAxis: dates[Math.min(calibratingEnd, dates.length - 1)] }]],
              },
            }
          : {}),
      },
      { name: "Fitness", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: pad(t.ctl.slice(from).map(r1)), showSymbol: false, lineStyle: { width: 2.5, color: theme.positive }, itemStyle: { color: theme.positive } },
      { name: "Fatigue", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: pad(t.atl.slice(from).map(r1)), showSymbol: false, lineStyle: { width: 1.5, color: theme.sport.bike }, itemStyle: { color: theme.sport.bike } },
      {
        name: "Form",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 6,
        data: pad(t.tsb.slice(from)).map((v) =>
          v === null ? null : { value: r1(v), itemStyle: { color: v >= 0 ? theme.positive : theme.negative, borderRadius: v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } },
        ),
        markArea: {
          silent: true,
          label: { show: true, position: "insideRight", color: theme.textMuted, fontSize: 9 },
          data: [
            [{ name: "Fresh", yAxis: 5, itemStyle: { color: theme.positive, opacity: 0.07 } }, { yAxis: 25 }],
            [{ name: "Productive", yAxis: -30, itemStyle: { color: theme.status.good, opacity: 0.08 } }, { yAxis: -10 }],
            [{ name: "Overreaching", yAxis: -80, itemStyle: { color: theme.status.critical, opacity: 0.08 } }, { yAxis: -30 }],
          ],
        },
      },
      ...(plan
        ? [
            {
              name: "Fitness (plan)",
              type: "line",
              xAxisIndex: 0,
              yAxisIndex: 0,
              data: joined(t.ctl.at(-1) ?? 0, plan.ctl),
              showSymbol: false,
              lineStyle: { width: 2, type: "dashed", color: theme.positive },
              itemStyle: { color: theme.positive },
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: theme.text, width: 1 },
                label: { show: true, position: "insideEndTop", color: theme.text, fontSize: 9, formatter: "Race" },
                data: [{ xAxis: plan.raceDay }],
              },
            },
            { name: "Fatigue (plan)", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: joined(t.atl.at(-1) ?? 0, plan.atl), showSymbol: false, lineStyle: { width: 1.25, type: "dashed", color: theme.sport.bike }, itemStyle: { color: theme.sport.bike } },
            // Form band (± 15 % load) as a stacked area: an invisible floor, then the band height.
            { name: "form band floor", type: "line", stack: "formband", xAxisIndex: 1, yAxisIndex: 1, data: [...Array(histLen).fill(null), ...plan.tsbLow.map(r1)], showSymbol: false, lineStyle: { opacity: 0 }, silent: true },
            {
              name: "Form band",
              type: "line",
              stack: "formband",
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: [...Array(histLen).fill(null), ...plan.tsbHigh.map((v, i) => r1(v - plan.tsbLow[i]))],
              showSymbol: false,
              lineStyle: { opacity: 0 },
              areaStyle: { color: theme.textMuted, opacity: 0.2 },
              silent: true,
            },
            {
              name: "Form (plan)",
              type: "line",
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: joined(t.tsb.at(-1) ?? 0, plan.tsb),
              showSymbol: false,
              lineStyle: { width: 1.5, type: "dashed", color: theme.text },
              itemStyle: { color: theme.text },
              markArea: {
                silent: true,
                itemStyle: { color: theme.status.good, opacity: 0.25 },
                label: { show: false },
                data: [[{ xAxis: addDays(plan.raceDay, -6), yAxis: RACE_TSB[0] }, { xAxis: plan.raceDay, yAxis: RACE_TSB[1] }]],
              },
            },
          ]
        : []),
    ],
  };
}

/** Weekly load stacked by sport, and ACWR per week on its own small axis with the 1.3 ceiling. */
export function weeklyLoadOption(weeks: WeekRow[], theme: VizTheme) {
  const sports = SPORTS.filter((sp) => weeks.some((w) => w.loads[sp] > 0));
  const labels = weeks.map((w) => w.weekStart);
  const ax = axisCommon(theme);
  // Round only the top segment of each week's stack.
  const topSport = weeks.map((w) => [...sports].reverse().find((sp) => w.loads[sp] > 0));

  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [
      { top: 8, height: 140, ...GRID_SIDES },
      { top: 172, height: 46, ...GRID_SIDES },
    ],
    xAxis: [
      { type: "category", data: labels, gridIndex: 0, ...ax, axisLabel: { show: false }, splitLine: { show: false } },
      { type: "category", data: labels, gridIndex: 1, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, ...ax, splitNumber: 3, min: 0 },
      { type: "value", gridIndex: 1, ...ax, splitNumber: 1, min: 0, max: (v: { max: number }) => Math.max(1.6, Math.ceil(v.max * 10) / 10) },
    ],
    series: [
      ...sports.map((sp) => ({
        name: SPORT_LABEL[sp],
        type: "bar",
        stack: "load",
        xAxisIndex: 0,
        yAxisIndex: 0,
        barMaxWidth: 24,
        itemStyle: { color: theme.sport[sp], borderColor: theme.surface, borderWidth: 1 },
        data: weeks.map((w, i) => ({
          value: r1(w.loads[sp]),
          itemStyle: topSport[i] === sp ? { borderRadius: [4, 4, 0, 0] } : undefined,
        })),
      })),
      {
        name: "ACWR",
        type: "scatter",
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbolSize: 8,
        data: weeks.map((w) => ({
          value: Math.round(w.acwr * 100) / 100,
          itemStyle: { color: w.acwr > 1.3 ? theme.status.critical : theme.textMuted, borderColor: theme.surface, borderWidth: 2 },
        })),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: theme.status.critical, width: 1, type: "solid", opacity: 0.6 },
          label: { show: true, position: "insideEndTop", color: theme.textMuted, fontSize: 9, formatter: "1.3" },
          data: [{ yAxis: 1.3 }],
        },
      },
    ],
  };
}

/** Share of low, mid and high intensity per week, as 100 % stacks. */
export function distributionOption(weeks: WeekRow[], theme: VizTheme) {
  const ax = axisCommon(theme);
  const pct = (w: WeekRow, k: "low" | "mid" | "high") => {
    const total = w.bands.low + w.bands.mid + w.bands.high;
    return total > 0 ? Math.round((w.bands[k] / total) * 1000) / 10 : 0;
  };
  const keys = [
    { k: "low" as const, name: "Low" },
    { k: "mid" as const, name: "Mid" },
    { k: "high" as const, name: "High" },
  ];
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, height: 120, ...GRID_SIDES }],
    xAxis: [{ type: "category", data: weeks.map((w) => w.weekStart), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", ...ax, min: 0, max: 100, splitNumber: 2, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } }],
    series: keys.map(({ k, name }, i) => ({
      name,
      type: "bar",
      stack: "dist",
      barMaxWidth: 24,
      itemStyle: { color: theme.band[k], borderColor: theme.surface, borderWidth: 1, ...(i === 2 ? { borderRadius: [4, 4, 0, 0] } : {}) },
      data: weeks.map((w) => pct(w, k)),
      // The Ironman build target: 75 to 85 % low (2.9).
      ...(k === "low"
        ? {
            markArea: {
              silent: true,
              itemStyle: { color: "transparent", borderColor: theme.text, borderWidth: 1, borderType: "solid", opacity: 0.6 },
              label: { show: false },
              data: [[{ yAxis: 75 }, { yAxis: 85 }]],
            },
          }
        : {}),
    })),
  };
}

export const DISTRIBUTION_TEXT: Record<DistributionLabel, string> = {
  polarized: "Polarized",
  pyramidal: "Pyramidal",
  threshold: "Threshold-heavy",
  mixed: "Mixed",
  no_high: "No high intensity",
  no_data: "No HR data",
};

/** The sports the per-sport fitness chart shows: those with any fitness in the range. */
export function sportsWithFitness(series: LoadSeries, range: RangeKey): Sport[] {
  const from = rangeStart(series, range);
  return SPORTS.filter((sp) => sp !== "other" && series.tracks[sp].ctl.slice(from).some((v) => v >= 0.5));
}

/** Fitness (CTL) per sport as one line each on one axis: is the build balanced, or does one sport carry it? */
export function sportFitnessOption(series: LoadSeries, range: RangeKey, theme: VizTheme) {
  const from = rangeStart(series, range);
  const ax = axisCommon(theme);
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, bottom: 22, ...GRID_SIDES }],
    xAxis: [{ type: "category", data: series.dates.slice(from), ...ax, boundaryGap: false, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", ...ax, min: 0, splitNumber: 3 }],
    series: sportsWithFitness(series, range).map((sp) => ({
      name: SPORT_LABEL[sp],
      type: "line",
      data: series.tracks[sp].ctl.slice(from).map(r1),
      showSymbol: false,
      lineStyle: { width: 2, color: theme.sport[sp] },
      itemStyle: { color: theme.sport[sp] },
    })),
  };
}
