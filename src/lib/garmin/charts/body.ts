/**
 * The body signal sheet's 90-day chart: one value per calendar day (gaps kept
 * as gaps), a 7-day mean for daily signals, your normal as a band, and the
 * crosshair the readout above the chart follows. Pure, so the days are tested.
 */

import type { BodySignal } from "../analytics/overview";
import { addDays } from "../dates";
import { axisCommon, pointer, shortDate } from "./load";
import type { VizTheme } from "./theme";

export type SignalDays = { dates: string[]; values: (number | null)[]; mean7: (number | null)[] | null };

/** Fewer points than this over 90 days (VO2 max, weigh-ins) get no 7-day mean: it would just repeat them. */
const MEAN_MIN_POINTS = 28;

export function signalDays(s: BodySignal): SignalDays {
  if (!s.points.length) return { dates: [], values: [], mean7: null };
  const byDate = new Map(s.points.map((p) => [p.date, p.value]));
  const dates: string[] = [];
  for (let d = s.points[0].date; d <= s.points.at(-1)!.date; d = addDays(d, 1)) dates.push(d);
  const values = dates.map((d) => byDate.get(d) ?? null);
  if (s.points.length < MEAN_MIN_POINTS) return { dates, values, mean7: null };
  const mean7 = values.map((_, i) => {
    const win = values.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v !== null);
    return win.length >= 4 ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
  return { dates, values, mean7 };
}

export function signalOption(days: SignalDays, normal: [number, number] | null, color: string, theme: VizTheme) {
  const ax = axisCommon(theme);
  const daily = days.mean7 !== null;
  const band = normal
    ? [
        { name: "band floor", type: "line", stack: "band", data: days.dates.map(() => normal[0]), showSymbol: false, lineStyle: { opacity: 0 }, silent: true },
        { name: "Your normal", type: "line", stack: "band", data: days.dates.map(() => normal[1] - normal[0]), showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.15 }, silent: true },
      ]
    : [];
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, left: 40, right: 10, bottom: 22 }],
    xAxis: [{ type: "category", data: days.dates, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", scale: true, splitNumber: 3, ...ax }],
    series: [
      ...band,
      daily
        ? { name: "Day", type: "scatter", symbolSize: 5, data: days.values, itemStyle: { color, opacity: 0.55 } }
        : { name: "Value", type: "line", connectNulls: true, symbolSize: 6, data: days.values, lineStyle: { width: 2, color }, itemStyle: { color } },
      ...(daily ? [{ name: "7-day mean", type: "line", data: days.mean7, showSymbol: false, connectNulls: false, lineStyle: { width: 2.5, color } }] : []),
    ],
  };
}

/** Garmin's body battery key levels on the Day tab's clock window, 0 to 100, with the crosshair. */
export function bodyBatteryOption(points: { t: number; level: number }[], window: [number, number], color: string, theme: VizTheme) {
  const ax = axisCommon(theme);
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, left: 34, right: 10, bottom: 22 }],
    xAxis: [{ type: "value", min: window[0], max: window[1], ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: hhmm, hideOverlap: true }, splitNumber: 5 }],
    yAxis: [{ type: "value", min: 0, max: 100, interval: 25, ...ax }],
    series: [{ name: "Body battery", type: "line", data: points.map((p) => [p.t, p.level]), symbolSize: 7, lineStyle: { width: 2.5, color }, itemStyle: { color }, areaStyle: { color, opacity: 0.12 } }],
  };
}
