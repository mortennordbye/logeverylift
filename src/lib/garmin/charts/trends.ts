/**
 * The Trends tab's chart options (docs/plans/garmin-insights-design.md, 3.7).
 * Pure. Curves use a log duration axis; everything over time uses a time axis,
 * so onIndex reports a value (seconds or epoch ms) and the readout picks the
 * nearest point. One y axis per grid.
 */

import type { CurvePoint, EfPoint, ThresholdWeek, Vo2Point } from "../analytics/trends";
import type { DynamicsBin } from "../analytics/efforts";
import { AXIS_FONT, GRID_SIDES, axisCommon } from "./load";
import type { VizTheme } from "./theme";

const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Day and month for spans under about ten months; month and year beyond, so labels never repeat. */
export function timeLabelFormat(days: string[]): string {
  if (days.length < 2) return "{d} {MMM}";
  const span = (ms(days[days.length - 1]) - ms(days[0])) / 86_400_000;
  return span > 300 ? "{MMM} {yy}" : "{d} {MMM}";
}

function pointerFree(theme: VizTheme) {
  return {
    tooltip: { trigger: "axis", showContent: false, triggerOn: "mousemove|click", axisPointer: { type: "line", lineStyle: { color: theme.textMuted, width: 1 } } },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
  };
}

/** "5s", "1m", "20m", "1h", "2h" */
export function durationTick(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round((s / 3600) * 10) / 10}h`;
}

/** m/s to minutes per km, for a pace axis. */
export const paceMin = (mps: number) => Math.round((1000 / mps / 60) * 100) / 100;
export const paceTick = (min: number) => `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, "0")}`;

export type CurveLine = { name: string; points: CurvePoint[]; color: string; dashed?: boolean; width?: number };

/**
 * Best mean power (or pace) against duration on a log axis. `model` draws the
 * critical power curve P = CP + W'/t over 2 to 20 minutes as a thin line.
 */
export function curveOption(lines: CurveLine[], kind: "power" | "pace", theme: VizTheme, model: { cp: number; w: number } | null = null) {
  const ax = axisCommon(theme);
  const y = (v: number) => (kind === "pace" ? paceMin(v) : Math.round(v));
  return {
    animationDuration: 300,
    ...pointerFree(theme),
    grid: [{ top: 10, bottom: 24, ...GRID_SIDES, left: 40 }],
    xAxis: [{ type: "log", logBase: 10, min: lines.length ? Math.min(...lines.flatMap((l) => l.points.map((p) => p.x))) : 5, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: durationTick } }],
    yAxis: [
      {
        type: "value",
        ...ax,
        scale: true,
        splitNumber: 3,
        inverse: kind === "pace",
        axisLabel: { ...ax.axisLabel, formatter: kind === "pace" ? paceTick : "{value} W" },
      },
    ],
    series: [
      ...lines.map((l) => ({
        name: l.name,
        type: "line",
        data: l.points.map((p) => [p.x, y(p.value)]),
        showSymbol: true,
        symbolSize: 4,
        lineStyle: { width: l.width ?? 2, type: l.dashed ? "dashed" : "solid", color: l.color },
        itemStyle: { color: l.color },
      })),
      ...(model
        ? [
            {
              name: "CP model",
              type: "line",
              data: [120, 180, 300, 600, 720, 1200].map((t) => [t, Math.round(model.cp + model.w / t)]),
              showSymbol: false,
              silent: true,
              lineStyle: { width: 1, color: theme.textMuted },
            },
          ]
        : []),
    ],
  };
}

/**
 * Thresholds week by week, three grids on one time axis: power (FTP, CP),
 * run pace (critical speed), and LTHR (yours per sport, and the watch's).
 * Weeks without an estimate are gaps.
 */
export function thresholdsOption(weeks: ThresholdWeek[], theme: VizTheme) {
  const ax = axisCommon(theme);
  const x = weeks.map((w) => ms(w.weekStart));
  const pair = (vs: (number | null)[]) => vs.map((v, i) => [x[i], v === null ? null : Math.round(v)]);
  const heights = [80, 70, 80];
  const gap = 26;
  const tops = heights.map((_, i) => 8 + heights.slice(0, i).reduce((s, h) => s + h + gap, 0));
  const xAxis = heights.map((_, i) => ({
    type: "time",
    gridIndex: i,
    ...ax,
    splitLine: { show: false },
    axisLabel: i === heights.length - 1 ? { ...ax.axisLabel, hideOverlap: true, formatter: timeLabelFormat(weeks.map((w) => w.weekStart)) } : { show: false },
  }));
  const step = { type: "line", step: "end", showSymbol: false, connectNulls: false };
  return {
    animationDuration: 300,
    ...pointerFree(theme),
    grid: heights.map((h, i) => ({ top: tops[i], height: h, ...GRID_SIDES, left: 40 })),
    xAxis,
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, splitNumber: 2, ...ax, axisLabel: { ...ax.axisLabel, formatter: "{value} W" } },
      { type: "value", gridIndex: 1, scale: true, splitNumber: 2, inverse: true, ...ax, axisLabel: { ...ax.axisLabel, formatter: paceTick } },
      { type: "value", gridIndex: 2, scale: true, splitNumber: 2, ...ax },
    ],
    series: [
      { ...step, name: "FTP", xAxisIndex: 0, yAxisIndex: 0, data: pair(weeks.map((w) => w.ftp)), lineStyle: { width: 2, color: theme.sport.bike } },
      { ...step, name: "CP", xAxisIndex: 0, yAxisIndex: 0, data: pair(weeks.map((w) => w.cp)), lineStyle: { width: 1.5, type: "dashed", color: theme.sport.bike } },
      { ...step, name: "Critical speed", xAxisIndex: 1, yAxisIndex: 1, data: weeks.map((w, i) => [x[i], w.cs ? paceMin(w.cs) : null]), lineStyle: { width: 2, color: theme.sport.run } },
      { ...step, name: "LTHR run", xAxisIndex: 2, yAxisIndex: 2, data: pair(weeks.map((w) => w.lthrRun)), lineStyle: { width: 2, color: theme.sport.run } },
      { ...step, name: "LTHR bike", xAxisIndex: 2, yAxisIndex: 2, data: pair(weeks.map((w) => w.lthrBike)), lineStyle: { width: 2, color: theme.sport.bike } },
      { ...step, name: "LTHR on the watch", xAxisIndex: 2, yAxisIndex: 2, data: pair(weeks.map((w) => w.watchLthr)), lineStyle: { width: 1, type: "dashed", color: theme.textMuted } },
    ],
  };
}

export const THRESHOLDS_HEIGHT = 8 + 80 + 70 + 80 + 2 * 26 + 26;

/** Garmin's running and cycling VO2 max as step lines, each run's own estimate as a dot, and the app's VO2 max (42-day median) as a line. */
export function vo2Option(garmin: { day: string; value: number; sport: "run" | "bike" }[], runs: Vo2Point[], trend: { day: string; value: number }[], theme: VizTheme) {
  const ax = axisCommon(theme);
  return {
    animationDuration: 300,
    ...pointerFree(theme),
    grid: [{ top: 10, bottom: 24, ...GRID_SIDES }],
    xAxis: [{ type: "time", ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, hideOverlap: true, formatter: timeLabelFormat([...runs, ...garmin].map((x) => x.day).sort()) } }],
    yAxis: [{ type: "value", scale: true, splitNumber: 3, ...ax }],
    series: [
      { name: "Run estimate", type: "scatter", data: runs.map((r) => [ms(r.day), r.value]), symbolSize: 6, itemStyle: { color: theme.sport.run, opacity: 0.5 } },
      { name: "App VO2 max", type: "line", data: trend.map((t) => [ms(t.day), t.value]), showSymbol: false, lineStyle: { width: 2, color: theme.sport.run } },
      { name: "Garmin running", type: "line", step: "end", data: garmin.filter((g) => g.sport === "run").map((g) => [ms(g.day), g.value]), showSymbol: false, lineStyle: { width: 2, color: theme.text } },
      { name: "Garmin cycling", type: "line", step: "end", data: garmin.filter((g) => g.sport === "bike").map((g) => [ms(g.day), g.value]), showSymbol: false, lineStyle: { width: 1.5, type: "dashed", color: theme.sport.bike } },
    ],
  };
}

/**
 * Efficiency over time for steady sessions of one sport (dot size = length),
 * and decoupling against session length for both sports, with the 5 % line:
 * how long the aerobic base holds.
 */
export function efOption(points: EfPoint[], sport: "bike" | "run", theme: VizTheme) {
  const ax = axisCommon(theme);
  const xs = points.filter((p) => p.sport === sport);
  return {
    animationDuration: 300,
    ...pointerFree(theme),
    grid: [{ top: 10, bottom: 24, ...GRID_SIDES }],
    xAxis: [{ type: "time", ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, hideOverlap: true, formatter: timeLabelFormat(xs.map((p) => p.day)) } }],
    yAxis: [{ type: "value", scale: true, splitNumber: 3, ...ax }],
    series: [
      {
        name: "Efficiency",
        type: "scatter",
        data: xs.map((p) => [ms(p.day), p.ef, p.durationS]),
        symbolSize: (v: number[]) => Math.max(5, Math.min(16, (v[2] / 3600) * 6)),
        itemStyle: { color: theme.sport[sport], opacity: 0.75 },
      },
    ],
  };
}

export function decouplingOption(points: EfPoint[], theme: VizTheme) {
  const ax = axisCommon(theme);
  return {
    animationDuration: 300,
    tooltip: { show: false },
    grid: [{ top: 10, bottom: 28, ...GRID_SIDES }],
    xAxis: [{ type: "value", min: 0, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${v}h` } }],
    yAxis: [{ type: "value", ...ax, splitNumber: 3, axisLabel: { ...ax.axisLabel, formatter: "{value}%" } }],
    series: (["bike", "run"] as const).map((sport, i) => ({
      name: sport,
      type: "scatter",
      data: points.filter((p) => p.sport === sport && p.decoupling !== null).map((p) => [Math.round((p.durationS / 3600) * 100) / 100, p.decoupling]),
      symbolSize: 7,
      itemStyle: { color: theme.sport[sport], opacity: 0.8 },
      ...(i === 0
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { color: theme.status.warning, type: "dashed", width: 1 },
              label: { show: true, position: "insideEndTop", color: theme.textMuted, fontSize: AXIS_FONT - 1, formatter: "5 %" },
              data: [{ yAxis: 5 }],
            },
          }
        : {}),
    })),
  };
}

/** Run cadence (steps per minute, both feet) and ground contact time at one speed, over time. */
export function dynamicsOption(points: ({ day: string } & DynamicsBin)[], theme: VizTheme) {
  const ax = axisCommon(theme);
  const xAxis = [0, 1].map((i) => ({ type: "time", gridIndex: i, ...ax, splitLine: { show: false }, axisLabel: i === 1 ? { ...ax.axisLabel, hideOverlap: true, formatter: timeLabelFormat(points.map((p) => p.day)) } : { show: false } }));
  return {
    animationDuration: 300,
    ...pointerFree(theme),
    grid: [
      { top: 8, height: 64, ...GRID_SIDES },
      { top: 98, height: 64, ...GRID_SIDES },
    ],
    xAxis,
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, splitNumber: 2, ...ax },
      { type: "value", gridIndex: 1, scale: true, splitNumber: 2, ...ax },
    ],
    series: [
      { name: "Cadence", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: points.map((p) => [ms(p.day), p.cadence !== null ? Math.round(p.cadence * 2) : null]), symbolSize: 5, lineStyle: { width: 1.5, color: theme.sport.run }, itemStyle: { color: theme.sport.run } },
      { name: "Ground contact", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: points.map((p) => [ms(p.day), p.gct !== null ? Math.round(p.gct) : null]), symbolSize: 5, lineStyle: { width: 1.5, color: theme.sport.other }, itemStyle: { color: theme.sport.other } },
    ],
  };
}

/** Weight, and FTP per kg under it on the same time axis. */
export function weightOption(weight: { day: string; kg: number }[], wkg: { day: string; value: number }[], theme: VizTheme) {
  const ax = axisCommon(theme);
  const two = wkg.length > 1;
  // One date range for both grids, so a W/kg step lines up with the weigh-ins above it.
  const days = [...weight.map((w) => w.day), ...wkg.map((w) => w.day)].sort();
  const xAxis = (two ? [0, 1] : [0]).map((i) => ({
    type: "time",
    gridIndex: i,
    min: days.length ? ms(days[0]) : undefined,
    max: days.length ? ms(days[days.length - 1]) : undefined,
    ...ax,
    splitLine: { show: false },
    axisLabel: i === (two ? 1 : 0) ? { ...ax.axisLabel, hideOverlap: true, formatter: timeLabelFormat(days) } : { show: false },
  }));
  return {
    animationDuration: 300,
    ...pointerFree(theme),
    grid: two ? [{ top: 8, height: 80, ...GRID_SIDES }, { top: 112, height: 56, ...GRID_SIDES }] : [{ top: 8, bottom: 24, ...GRID_SIDES }],
    xAxis,
    yAxis: (two ? [0, 1] : [0]).map((i) => ({ type: "value", gridIndex: i, scale: true, splitNumber: 2, ...ax })),
    series: [
      { name: "Weight", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: weight.map((w) => [ms(w.day), w.kg]), symbolSize: 4, lineStyle: { width: 1.5, color: theme.text }, itemStyle: { color: theme.text } },
      ...(two ? [{ name: "W/kg", type: "line", step: "end", xAxisIndex: 1, yAxisIndex: 1, data: wkg.map((w) => [ms(w.day), w.value]), showSymbol: false, lineStyle: { width: 2, color: theme.sport.bike } }] : []),
    ],
  };
}

/** The point of a dated series nearest to an epoch-ms crosshair value. */
export function nearest<T extends { day: string }>(xs: T[], at: number | null): T | null {
  if (!xs.length) return null;
  if (at === null) return xs[xs.length - 1];
  let best = xs[0];
  for (const x of xs) if (Math.abs(ms(x.day) - at) < Math.abs(ms(best.day) - at)) best = x;
  return best;
}
