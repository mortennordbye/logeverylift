"use client";

import type uPlotType from "uplot";
import { useEffect, useRef, useState } from "react";

/**
 * A dense time series drawn with uPlot (canvas): all-day heart rate, overnight
 * HRV. One y axis per chart. Time is local wall-clock milliseconds written as
 * UTC, so axis labels are formatted in UTC and show the athlete's local time.
 *
 * - ranges: shaded spans (the sleep window, activities on a lane at the bottom).
 * - lines: horizontal reference lines (resting HR, a baseline).
 * - band: a grey y band behind the series (an HRV baseline band).
 * - Touch: a finger drag moves the crosshair; vertical swipes still scroll.
 * - onIndex reports the sample under the crosshair for the readout row.
 */

export type TsSeries = { label: string; values: (number | null)[]; color: string; width?: number; points?: boolean; fill?: string };
export type TsRange = { from: number; to: number; color: string; lane?: "full" | "bottom"; label?: string };
export type TsLine = { y: number; color: string };

type Props = {
  /** Local wall-clock ms, ascending. */
  x: number[];
  series: TsSeries[];
  ranges?: TsRange[];
  lines?: TsLine[];
  band?: { from: number; to: number; color: string };
  xRange?: [number, number];
  yRange?: [number, number];
  height: number;
  ariaLabel: string;
  axisColor: string;
  gridColor: string;
  onIndex?: (index: number | null) => void;
  /** Charts with the same key share one crosshair (the stream stack of an activity). */
  syncKey?: string;
  /** "clock": x is wall-clock ms, labelled 06:00. "elapsed": x is seconds from start × 1000, labelled 1:30. */
  xFormat?: "clock" | "elapsed";
  /** Draw the x axis labels (off for all but the bottom chart of a stack). */
  showXAxis?: boolean;
  /** Smaller values up (pace: faster is up). */
  invertY?: boolean;
};

const LANE_H = 10;

/** The data range plus 8 % each side (at least 0.5), so lines don't touch the edges at any scale. */
export function paddedRange(min: number, max: number): [number, number] {
  const pad = Math.max((max - min) * 0.08, 0.5);
  return [min - pad, max + pad];
}

/** Elapsed-time ticks: every 5, 10, 15, 30 or 60 minutes, about five across. Values in seconds. */
export function elapsedSplits(minS: number, maxS: number): number[] {
  const span = maxS - minS;
  const step = [300, 600, 900, 1800, 3600, 7200].find((s) => span / s <= 6) ?? 7200;
  const out: number[] = [];
  for (let t = Math.ceil(minS / step) * step; t <= maxS; t += step) out.push(t);
  return out;
}

export function elapsedLabel(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}` : `${m}m`;
}

/** Ticks on whole hours: every 6 h over long spans, 3 h over a day, 2 h over a night. Values in seconds. */
export function hourSplits(minS: number, maxS: number): number[] {
  const spanH = (maxS - minS) / 3600;
  const step = (spanH > 20 ? 6 : spanH > 12 ? 3 : spanH > 4 ? 2 : 1) * 3600;
  const out: number[] = [];
  for (let t = Math.ceil(minS / step) * step; t <= maxS; t += step) out.push(t);
  return out;
}

function timeLabel(ms: number) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function TimeSeriesChart(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlotType | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    propsRef.current = props;
  });

  const { x, series, height } = props;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const el = box.current;
    if (!el) return;

    void import("./uplot-core").then(({ uPlot }) => {
      if (disposed || !box.current) return;
      const p = propsRef.current;
      const width = box.current.clientWidth;

      const drawUnder = (u: uPlotType) => {
        const { ctx } = u;
        const { left, top, width: w, height: h } = u.bbox;
        ctx.save();
        if (p.band) {
          const y1 = u.valToPos(p.band.to, "y", true);
          const y2 = u.valToPos(p.band.from, "y", true);
          ctx.fillStyle = p.band.color;
          ctx.fillRect(left, y1, w, y2 - y1);
        }
        for (const r of p.ranges ?? []) {
          const x1 = Math.max(left, u.valToPos(r.from / 1000, "x", true));
          const x2 = Math.min(left + w, u.valToPos(r.to / 1000, "x", true));
          if (x2 <= x1) continue;
          ctx.fillStyle = r.color;
          const laneH = LANE_H * devicePixelRatio;
          if (r.lane === "bottom") ctx.fillRect(x1, top + h - laneH, Math.max(x2 - x1, 2 * devicePixelRatio), laneH);
          else ctx.fillRect(x1, top, x2 - x1, h);
        }
        for (const l of p.lines ?? []) {
          const y = Math.round(u.valToPos(l.y, "y", true)) + 0.5;
          ctx.strokeStyle = l.color;
          ctx.lineWidth = devicePixelRatio;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(left + w, y);
          ctx.stroke();
        }
        ctx.restore();
      };

      const opts: uPlotType.Options = {
        width,
        height: p.height,
        legend: { show: false },
        cursor: { y: false, points: { size: 8, width: 2 }, drag: { x: false, y: false }, ...(p.syncKey ? { sync: { key: p.syncKey } } : {}) },
        scales: {
          x: { time: false, range: p.xRange ? [p.xRange[0] / 1000, p.xRange[1] / 1000] : undefined },
          y: { dir: p.invertY ? -1 : 1, range: p.yRange ? () => p.yRange! : (_u, min, max) => paddedRange(min, max) },
        },
        axes: [
          {
            stroke: p.axisColor,
            grid: { show: false },
            ticks: { show: false },
            font: "10px system-ui",
            // Room for one row of 10 px labels; uPlot's default band is 50 px.
            size: p.showXAxis === false ? 4 : 22,
            show: true,
            splits: (_u, _i, min, max) => (p.xFormat === "elapsed" ? elapsedSplits(min, max) : hourSplits(min, max)),
            values: (_u, splits) => (p.showXAxis === false ? splits.map(() => "") : splits.map((s) => (p.xFormat === "elapsed" ? elapsedLabel(s) : timeLabel(s * 1000)))),
          },
          { stroke: p.axisColor, grid: { stroke: p.gridColor, width: 1 }, ticks: { show: false }, font: "10px system-ui", size: 34, space: 28 },
        ],
        series: [{}, ...p.series.map((s) => ({ label: s.label, stroke: s.color, width: s.width ?? 1.5, fill: s.fill, points: { show: s.points ?? false, size: 4, fill: s.color, stroke: s.color }, spanGaps: false }))],
        hooks: {
          drawAxes: [drawUnder],
          setCursor: [(u) => propsRef.current.onIndex?.(u.cursor.idx ?? null)],
        },
      };
      const data = [p.x.map((t) => t / 1000), ...p.series.map((s) => s.values)] as uPlotType.AlignedData;
      const u = new uPlot(opts, data, box.current);
      plot.current = u;

      // Touch: a horizontal drag moves the crosshair; a vertical one scrolls the page.
      const over = u.over;
      let startX = 0;
      let startY = 0;
      let tracking: boolean | null = null;
      const move = (e: TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        if (tracking === null) {
          const dx = Math.abs(t.clientX - startX);
          const dy = Math.abs(t.clientY - startY);
          if (dx < 6 && dy < 6) return;
          tracking = dx > dy;
        }
        if (!tracking) return;
        e.preventDefault();
        const rect = over.getBoundingClientRect();
        u.setCursor({ left: Math.max(0, Math.min(rect.width, t.clientX - rect.left)), top: 10 });
      };
      const start = (e: TouchEvent) => {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        tracking = null;
        const rect = over.getBoundingClientRect();
        u.setCursor({ left: t.clientX - rect.left, top: 10 });
      };
      over.addEventListener("touchstart", start, { passive: true });
      over.addEventListener("touchmove", move, { passive: false });

      observer = new ResizeObserver(() => {
        if (box.current) u.setSize({ width: box.current.clientWidth, height: propsRef.current.height });
      });
      observer.observe(box.current);
      setReady(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // The chart is rebuilt when its data or size changes; colours come with the data.
  }, [x, series, height]);

  return <div ref={box} role="img" aria-label={props.ariaLabel} style={{ height, touchAction: "pan-y" }} className={`w-full ${ready ? "" : "opacity-0"}`} />;
}
