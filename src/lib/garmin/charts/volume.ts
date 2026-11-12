/**
 * Chart options for training volume (hours per sport) and the long-session
 * ladder. Pure, like the other builders: one y axis per grid, one crosshair.
 */

import { DEMAND_TARGETS, type Endurance, type VolumeWeek } from "../analytics/demands";
import type { RaceDistance } from "../analytics/overview";
import { SPORTS } from "../analytics/sport";
import { GRID_SIDES, axisCommon, pointer, r1, shortDate } from "./load";
import { SPORT_LABEL, type VizTheme } from "./theme";

/** Weekly hours stacked by sport. */
export function weeklyHoursOption(weeks: VolumeWeek[], theme: VizTheme) {
  const sports = SPORTS.filter((sp) => weeks.some((w) => w.hours[sp] > 0));
  const ax = axisCommon(theme);
  const topSport = weeks.map((w) => [...sports].reverse().find((sp) => w.hours[sp] > 0));
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: [{ top: 8, bottom: 22, ...GRID_SIDES }],
    xAxis: [{ type: "category", data: weeks.map((w) => w.weekStart), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } }],
    yAxis: [{ type: "value", ...ax, splitNumber: 3, min: 0, axisLabel: { ...ax.axisLabel, formatter: "{value} h" } }],
    series: sports.map((sp) => ({
      name: SPORT_LABEL[sp],
      type: "bar",
      stack: "hours",
      barMaxWidth: 24,
      itemStyle: { color: theme.sport[sp], borderColor: theme.surface, borderWidth: 1 },
      data: weeks.map((w, k) => ({ value: r1(w.hours[sp]), itemStyle: topSport[k] === sp ? { borderRadius: [4, 4, 0, 0] } : undefined })),
    })),
  };
}

const LADDER_SPORTS: Endurance[] = ["swim", "bike", "run"];

/** The value a ladder step shows: km for swims, hours for rides and runs. */
export function ladderValue(sport: Endurance, w: VolumeWeek): number | null {
  const l = w.longest[sport];
  if (!l) return null;
  return sport === "swim" ? r1((l.distanceM ?? 0) / 1000) : Math.round((l.durationS / 3600) * 100) / 100;
}

export function ladderTarget(sport: Endurance, distance: RaceDistance): number {
  const t = DEMAND_TARGETS[distance];
  return sport === "swim" ? t.swimM / 1000 : (sport === "bike" ? t.bikeS : t.runS) / 3600;
}

/**
 * The longest swim (km), ride (h) and run (h) of each week, three grids on one
 * x axis. Each grid has its own y axis, starts at zero and reaches the race
 * target, which is drawn as a line, so the gap reads at a glance.
 */
export function ladderOption(weeks: VolumeWeek[], distance: RaceDistance, theme: VizTheme) {
  const ax = axisCommon(theme);
  const labels = weeks.map((w) => w.weekStart);
  const h = 70;
  const gap = 18;
  return {
    animationDuration: 300,
    ...pointer(theme),
    grid: LADDER_SPORTS.map((_, i) => ({ top: 8 + i * (h + gap), height: h, ...GRID_SIDES })),
    xAxis: LADDER_SPORTS.map((_, i) => ({
      type: "category",
      data: labels,
      gridIndex: i,
      ...ax,
      splitLine: { show: false },
      axisLabel: i === LADDER_SPORTS.length - 1 ? { ...ax.axisLabel, formatter: shortDate, hideOverlap: true } : { show: false },
    })),
    yAxis: LADDER_SPORTS.map((sp, i) => {
      const target = ladderTarget(sp, distance);
      // Fixed from the data, so a sport with no sessions still shows its target line.
      const top = Math.max(target, ...weeks.map((w) => ladderValue(sp, w) ?? 0));
      return {
        type: "value",
        gridIndex: i,
        ...ax,
        min: 0,
        max: Math.ceil(top * 1.1),
        interval: Math.ceil(top * 1.1) / 2,
        axisLabel: { ...ax.axisLabel, formatter: (v: number) => (v === 0 ? "" : `${r1(v)}${sp === "swim" ? "k" : "h"}`) },
      };
    }),
    series: LADDER_SPORTS.map((sp, i) => ({
      name: SPORT_LABEL[sp],
      type: "bar",
      xAxisIndex: i,
      yAxisIndex: i,
      barMaxWidth: 10,
      itemStyle: { color: theme.sport[sp], borderRadius: [3, 3, 0, 0] },
      data: weeks.map((w) => ladderValue(sp, w)),
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: theme.text, type: "dashed", width: 1 },
        label: { show: true, position: "insideStartTop", color: theme.textMuted, fontSize: 9, formatter: `race target ${ladderTarget(sp, distance)}${sp === "swim" ? " km" : " h"}` },
        data: [{ yAxis: ladderTarget(sp, distance) }],
      },
    })),
  };
}
