/**
 * Geometry for the home widgets' hand-drawn SVG: rings, sparklines and bars
 * (docs/design/home-redesign/home-locked.html). Pure, no React, so the maths
 * is unit tested (src/__tests__/home-charts.test.ts).
 */

/** A progress ring: radius, circumference and the dash offset that leaves `pct` (0..1) drawn. */
export function ringDash(size: number, stroke: number, pct: number): { r: number; c: number; offset: number } {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0;
  return { r, c, offset: c * (1 - p) };
}

const f2 = (n: number) => Number(n.toFixed(2));

/**
 * A sparkline in a 100 x `h` box: the line's path, the closed area under it,
 * and the last point's height as a percentage of `h` (for the end dot). Fewer
 * than two values draw nothing. A flat series sits in the middle.
 */
export function sparkline(values: number[], h: number): { line: string; area: string; endPct: number } | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = f2((i / (n - 1)) * 100);
    const y = span === 0 ? h / 2 : f2(h - 3 - ((v - min) / span) * (h - 6));
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return { line, area: `${line} L100 ${h} L0 ${h} Z`, endPct: f2((pts[n - 1][1] / h) * 100) };
}

/** Bars in a 100 x `h` box, one slot per value, scaled to `max`. Zero values get no bar. */
export function bars(values: number[], h: number, max: number): { x: number; y: number; w: number; height: number; i: number }[] {
  const bw = 100 / Math.max(1, values.length);
  const top = max > 0 ? max : 1;
  return values.flatMap((v, i) => {
    if (!(v > 0)) return [];
    const height = f2((Math.min(v, top) / top) * h);
    return [{ x: f2(i * bw + bw * 0.2), y: f2(h - height), w: f2(bw * 0.6), height, i }];
  });
}

/** A line through the middle of each bar slot, scaled to `max`, as an SVG path. */
export function slotLine(values: number[], h: number, max: number): string {
  const bw = 100 / Math.max(1, values.length);
  const top = max > 0 ? max : 1;
  return values.map((v, i) => `${i ? "L" : "M"}${f2(i * bw + bw / 2)} ${f2(h - (Math.min(Math.max(v, 0), top) / top) * h)}`).join(" ");
}
