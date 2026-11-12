/**
 * Largest-triangle-three-buckets: pick `threshold` sample indices from (x, y)
 * that keep the shape, peaks included. All streams of an activity are cut at
 * the same indices, so they stay aligned (docs/plans/garmin-insights-design.md, 6.4).
 * Null y values count as 0 for picking but are kept as null in the output.
 */
export function lttbIndices(x: (number | null)[], y: (number | null)[], threshold: number): number[] {
  const n = x.length;
  if (threshold >= n || threshold < 3) return Array.from({ length: n }, (_, i) => i);
  const X = (i: number) => x[i] ?? 0;
  const Y = (i: number) => y[i] ?? 0;
  const out = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const nextStart = Math.floor((i + 1) * every) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += X(j);
      avgY += Y(j);
    }
    const len = Math.max(1, nextEnd - nextStart);
    avgX /= len;
    avgY /= len;
    const start = Math.floor(i * every) + 1;
    const end = Math.floor((i + 1) * every) + 1;
    let best = start;
    let bestArea = -1;
    for (let j = start; j < end; j++) {
      const area = Math.abs((X(a) - avgX) * (Y(j) - Y(a)) - (X(a) - X(j)) * (avgY - Y(a)));
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(best);
    a = best;
  }
  out.push(n - 1);
  return out;
}

/** Every stream cut at the same indices. */
export function takeIndices<T extends Record<string, (number | null)[] | undefined>>(streams: T, idx: number[]): T {
  const out: Record<string, (number | null)[]> = {};
  for (const [k, v] of Object.entries(streams)) if (v) out[k] = idx.map((i) => v[i] ?? null);
  return out as T;
}
