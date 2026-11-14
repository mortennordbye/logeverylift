/**
 * The Sleep tab's chart options (docs/plans/garmin-insights-design.md, 3.4).
 * Pure. One y axis per grid; stage totals are shown as shares, never as a
 * made-up timeline (the API has none).
 */

import type { SleepTabData } from "../queries";
import type { VizTheme } from "./theme";
import { dateLabel } from "@/lib/utils/date-label";

const DAY_MS = 86_400_000;
/** The timing chart's y axis runs from 18:00 to 12:00 the next day, in minutes after 18:00. */
const AXIS_START_MIN = 18 * 60;

/** Minutes after 18:00 for a local wall-clock timestamp. */
export function minutesAfter18(ts: number): number {
  const m = (((ts % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
  return (m - AXIS_START_MIN + 1440) % 1440;
}

export function clockLabel(minAfter18: number): string {
  const m = (minAfter18 + AXIS_START_MIN) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
}

const shortDate = (date: string) => dateLabel(date, "d MMM");
const SIDES = { left: 38, right: 10 };

function ax(theme: VizTheme) {
  return {
    axisLine: { lineStyle: { color: theme.grid } },
    axisTick: { show: false },
    axisLabel: { color: theme.textMuted, fontSize: 10 },
    splitLine: { lineStyle: { color: theme.grid, width: 1 } },
  };
}

function pointer(theme: VizTheme) {
  return {
    tooltip: { trigger: "axis", showContent: false, axisPointer: { type: "line", lineStyle: { color: theme.textMuted, width: 1 } } },
    axisPointer: { link: [{ xAxisIndex: "all" }], snap: true },
  };
}

export type TimingRow = { date: string; onset: number; wake: number };

/** Nights with a window, as minutes after 18:00 (onset before wake). */
export function timingRows(data: SleepTabData, nights = 28): TimingRow[] {
  return data.nights
    .filter((n): n is typeof n & { start: number; end: number } => n.start !== null && n.end !== null && n.end > n.start)
    .slice(-nights)
    .map((n) => {
      const onset = minutesAfter18(n.start);
      return { date: n.date, onset, wake: onset + (n.end - n.start) / 60_000 };
    });
}

/** Floating bars from bedtime to wake, with the median of each as a line. */
export function timingOption(rows: TimingRow[], theme: VizTheme) {
  const a = ax(theme);
  const mOnset = median(rows.map((r) => r.onset));
  const mWake = median(rows.map((r) => r.wake));
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, bottom: 22, ...SIDES }],
    xAxis: [{ type: "category", data: rows.map((r) => r.date), ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [
      {
        type: "value",
        inverse: true,
        // Both ends on the 2-hour tick grid, so the last label never crowds the one before.
        min: (v: { min: number }) => Math.max(0, Math.floor((v.min - 30) / 120) * 120),
        max: (v: { max: number }) => Math.min(18 * 60, Math.ceil((v.max + 30) / 120) * 120),
        interval: 120,
        ...a,
        axisLabel: { ...a.axisLabel, formatter: (v: number) => clockLabel(v) },
      },
    ],
    series: [
      { name: "base", type: "bar", stack: "t", silent: true, itemStyle: { color: "transparent" }, data: rows.map((r) => r.onset), barMaxWidth: 10 },
      {
        name: "Asleep",
        type: "bar",
        stack: "t",
        barMaxWidth: 10,
        itemStyle: { color: theme.positive, borderRadius: 4 },
        data: rows.map((r) => Math.round(r.wake - r.onset)),
        markLine:
          mOnset !== null && mWake !== null
            ? {
                silent: true,
                symbol: "none",
                lineStyle: { color: theme.textMuted, width: 1, type: "solid" },
                label: { color: theme.textMuted, fontSize: 9, position: "insideEndTop", formatter: (p: { value: number }) => clockLabel(p.value) },
                data: [{ yAxis: mOnset }, { yAxis: mWake }],
              }
            : undefined,
      },
    ],
  };
}

export type DurationRow = { date: string; hours: number | null; needH: number | null; debtH: number | null; score: number | null };

export function durationRows(data: SleepTabData, nights = 28): DurationRow[] {
  const debt = new Map(data.days.map((d) => [d.date, d.sleepDebtS]));
  return data.nights.slice(-nights).map((n) => ({
    date: n.date,
    hours: n.seconds !== null ? Math.round((n.seconds / 3600) * 10) / 10 : null,
    needH: n.needS !== null ? Math.round((n.needS / 3600) * 10) / 10 : null,
    debtH: debt.get(n.date) != null ? Math.round((debt.get(n.date)! / 3600) * 10) / 10 : null,
    score: n.score,
  }));
}

/** Hours slept with the night's need as a tick, and the running debt on its own axis below. */
export function durationOption(rows: DurationRow[], theme: VizTheme) {
  const a = ax(theme);
  const dates = rows.map((r) => r.date);
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [
      { top: 8, height: 120, ...SIDES },
      { top: 150, height: 50, ...SIDES },
    ],
    xAxis: [
      { type: "category", data: dates, gridIndex: 0, ...a, axisLabel: { show: false }, splitLine: { show: false } },
      { type: "category", data: dates, gridIndex: 1, ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: shortDate, hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, min: 0, splitNumber: 3, ...a, axisLabel: { ...a.axisLabel, formatter: "{value}h" } },
      { type: "value", gridIndex: 1, min: 0, splitNumber: 1, ...a, axisLabel: { ...a.axisLabel, formatter: "{value}h" } },
    ],
    series: [
      {
        name: "Slept",
        type: "bar",
        xAxisIndex: 0,
        yAxisIndex: 0,
        barMaxWidth: 12,
        data: rows.map((r) => ({ value: r.hours, itemStyle: { color: r.hours !== null && r.needH !== null && r.hours < r.needH ? theme.sport.bike : theme.positive, borderRadius: [4, 4, 0, 0] } })),
      },
      { name: "Need", type: "scatter", xAxisIndex: 0, yAxisIndex: 0, symbol: "rect", symbolSize: [12, 2], data: rows.map((r) => r.needH), itemStyle: { color: theme.text } },
      { name: "Debt", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: rows.map((r) => r.debtH), showSymbol: false, lineStyle: { width: 2, color: theme.sport.bike }, areaStyle: { color: theme.sport.bike, opacity: 0.1 } },
    ],
  };
}

/** Nights with stage totals, the rows the stages chart draws. */
export function stageRows(data: SleepTabData, nights = 28) {
  return data.nights.slice(-nights).filter((n) => (n.deep ?? 0) + (n.light ?? 0) + (n.rem ?? 0) > 0);
}

/** Stage shares per night as 100 % stacks. */
export function stagesOption(data: SleepTabData, theme: VizTheme, nights = 28) {
  const a = ax(theme);
  const rows = stageRows(data, nights);
  const pct = (n: (typeof rows)[number], v: number | null) => {
    const total = (n.deep ?? 0) + (n.light ?? 0) + (n.rem ?? 0) + (n.awake ?? 0);
    return total > 0 ? Math.round(((v ?? 0) / total) * 1000) / 10 : 0;
  };
  const stages = [
    { name: "Deep", key: "deep" as const, color: theme.band.low },
    { name: "Light", key: "light" as const, color: theme.band.mid },
    { name: "REM", key: "rem" as const, color: theme.sport.other },
    { name: "Awake", key: "awake" as const, color: theme.textMuted },
  ];
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, height: 110, ...SIDES }],
    xAxis: [{ type: "category", data: rows.map((r) => r.date), ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", min: 0, max: 100, splitNumber: 2, ...a, axisLabel: { ...a.axisLabel, formatter: "{value}%" } }],
    series: stages.map((s, i) => ({
      name: s.name,
      type: "bar",
      stack: "stages",
      barMaxWidth: 12,
      itemStyle: { color: s.color, borderColor: theme.surface, borderWidth: 1, ...(i === stages.length - 1 ? { borderRadius: [3, 3, 0, 0] } : {}) },
      data: rows.map((r) => pct(r, r[s.key])),
    })),
  };
}

/** Nightly HRV dots, the 7-day mean as a line, the baseline band behind; CV7 on its own axis below. */
export function hrvOption(data: SleepTabData, theme: VizTheme) {
  const a = ax(theme);
  const d = data.days;
  const dates = d.map((x) => x.date);
  const r = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [
      { top: 8, height: 130, ...SIDES },
      { top: 162, height: 44, ...SIDES },
    ],
    xAxis: [
      { type: "category", data: dates, gridIndex: 0, ...a, axisLabel: { show: false }, splitLine: { show: false } },
      { type: "category", data: dates, gridIndex: 1, ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: shortDate, hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, splitNumber: 3, ...a },
      { type: "value", gridIndex: 1, min: 0, splitNumber: 1, ...a, axisLabel: { ...a.axisLabel, formatter: "{value}%" } },
    ],
    series: [
      // The band as a stacked area: an invisible floor, then the band height.
      { name: "band floor", type: "line", stack: "band", xAxisIndex: 0, yAxisIndex: 0, data: d.map((x) => r(x.hrv.bandLow)), showSymbol: false, lineStyle: { opacity: 0 }, silent: true },
      {
        name: "Normal range",
        type: "line",
        stack: "band",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: d.map((x) => (x.hrv.bandLow !== null && x.hrv.bandHigh !== null ? Math.round(x.hrv.bandHigh - x.hrv.bandLow) : null)),
        showSymbol: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color: theme.textMuted, opacity: 0.18 },
        silent: true,
      },
      { name: "Night", type: "scatter", xAxisIndex: 0, yAxisIndex: 0, symbolSize: 5, data: d.map((x) => r(x.hrv.ms)), itemStyle: { color: theme.positive, opacity: 0.55 } },
      { name: "7-day mean", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: d.map((x) => r(x.hrv.mean7)), showSymbol: false, lineStyle: { width: 2, color: theme.positive } },
      { name: "CV", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: d.map((x) => (x.hrv.cv7 === null ? null : Math.round(x.hrv.cv7 * 10) / 10)), showSymbol: false, lineStyle: { width: 1.5, color: theme.textMuted } },
    ],
  };
}

/** Resting HR per day, its 7-day mean and 60-day baseline, on one axis. */
export function restingHrOption(data: SleepTabData, theme: VizTheme) {
  const a = ax(theme);
  const d = data.days;
  const r = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, height: 110, ...SIDES, bottom: 22 }],
    xAxis: [{ type: "category", data: d.map((x) => x.date), ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", scale: true, splitNumber: 3, ...a }],
    series: [
      { name: "Day", type: "scatter", symbolSize: 5, data: d.map((x) => x.restingHr.bpm), itemStyle: { color: theme.negative, opacity: 0.55 } },
      { name: "7-day mean", type: "line", data: d.map((x) => r(x.restingHr.mean7)), showSymbol: false, lineStyle: { width: 2, color: theme.negative } },
      { name: "Baseline", type: "line", data: d.map((x) => r(x.restingHr.baseline)), showSymbol: false, lineStyle: { width: 1, color: theme.textMuted } },
    ],
  };
}

/** Time per stress level each day, as hours stacked. */
export function stressOption(data: SleepTabData, theme: VizTheme, days = 28) {
  const a = ax(theme);
  const rows = data.stress.slice(-days);
  const levels = [
    { name: "Rest", key: "rest" as const, color: theme.band.low },
    { name: "Low", key: "low" as const, color: theme.band.mid },
    { name: "Medium", key: "medium" as const, color: theme.status.warning },
    { name: "High", key: "high" as const, color: theme.status.critical },
  ];
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, height: 110, ...SIDES }],
    xAxis: [{ type: "category", data: rows.map((r) => r.date), ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", min: 0, splitNumber: 2, ...a, axisLabel: { ...a.axisLabel, formatter: "{value}h" } }],
    series: levels.map((l, i) => ({
      name: l.name,
      type: "bar",
      stack: "stress",
      barMaxWidth: 12,
      itemStyle: { color: l.color, borderColor: theme.surface, borderWidth: 1, ...(i === levels.length - 1 ? { borderRadius: [3, 3, 0, 0] } : {}) },
      data: rows.map((r) => Math.round((r[l.key] / 3600) * 10) / 10),
    })),
  };
}

/**
 * The recovery stack: daily load, the HRV 7-day mean in its band, resting HR
 * against its baseline, and sleep debt, as four grids on one date axis with
 * one crosshair. Cause (load) on top, the body's answer below it.
 */
export function recoveryStackOption(data: SleepTabData, theme: VizTheme) {
  const a = ax(theme);
  const d = data.days;
  const dates = d.map((x) => x.date);
  const r = (v: number | null, k = 0) => (v === null ? null : Math.round(v * 10 ** k) / 10 ** k);
  const heights = [56, 84, 64, 44];
  const gap = STACK_GAP;
  const tops = heights.map((_, i) => 8 + heights.slice(0, i).reduce((s, h) => s + h + gap, 0));
  const xAxis = heights.map((_, i) => ({
    type: "category",
    data: dates,
    gridIndex: i,
    ...a,
    splitLine: { show: false },
    axisLabel: i === heights.length - 1 ? { ...a.axisLabel, formatter: shortDate, hideOverlap: true } : { show: false },
  }));
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: heights.map((h, i) => ({ top: tops[i], height: h, ...SIDES })),
    xAxis,
    yAxis: [
      { type: "value", gridIndex: 0, min: 0, splitNumber: 1, ...a },
      { type: "value", gridIndex: 1, scale: true, splitNumber: 2, ...a },
      { type: "value", gridIndex: 2, scale: true, splitNumber: 2, ...a },
      { type: "value", gridIndex: 3, min: 0, splitNumber: 1, ...a, axisLabel: { ...a.axisLabel, formatter: "{value}h" } },
    ],
    series: [
      { name: "Load", type: "bar", xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 6, data: d.map((x) => Math.round(x.load)), itemStyle: { color: theme.textMuted, borderRadius: [2, 2, 0, 0] } },
      { name: "band floor", type: "line", stack: "band", xAxisIndex: 1, yAxisIndex: 1, data: d.map((x) => r(x.hrv.bandLow)), showSymbol: false, lineStyle: { opacity: 0 }, silent: true },
      {
        name: "HRV normal",
        type: "line",
        stack: "band",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: d.map((x) => (x.hrv.bandLow !== null && x.hrv.bandHigh !== null ? r(x.hrv.bandHigh - x.hrv.bandLow) : null)),
        showSymbol: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color: theme.textMuted, opacity: 0.18 },
        silent: true,
      },
      { name: "HRV 7-day", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: d.map((x) => r(x.hrv.mean7)), showSymbol: false, lineStyle: { width: 2, color: theme.positive } },
      { name: "Resting HR baseline", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: d.map((x) => r(x.restingHr.baseline, 1)), showSymbol: false, lineStyle: { width: 1, type: "dashed", color: theme.textMuted } },
      { name: "Resting HR 7-day", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: d.map((x) => r(x.restingHr.mean7, 1)), showSymbol: false, lineStyle: { width: 2, color: theme.negative } },
      {
        name: "Sleep debt",
        type: "bar",
        xAxisIndex: 3,
        yAxisIndex: 3,
        barMaxWidth: 6,
        data: d.map((x) => (x.sleepDebtS === null ? null : r(x.sleepDebtS / 3600, 1))),
        itemStyle: { color: theme.sport.other, borderRadius: [2, 2, 0, 0] },
      },
    ],
  };
}

const STACK_GAP = 28;
/** Height of the recovery stack's canvas. */
export const RECOVERY_STACK_HEIGHT = 8 + 56 + 84 + 64 + 44 + 3 * STACK_GAP + 26;
