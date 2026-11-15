/** Planned power blocks with the recorded power line on top (docs/plans/bike-sessions.md, 5.5). */

const W = 320;
const H = 120;
/** Seconds the power line is averaged over, so it reads as a line and not as noise. */
const SMOOTH_S = 30;

export function RideChart({ plan, power }: { plan: { seconds: number; low: number | null; high: number | null }[]; power: { t: (number | null)[]; w: (number | null)[] } | null }) {
  const planTotal = plan.reduce((a, p) => a + p.seconds, 0);
  const lastT = power ? Math.max(0, ...power.t.filter((v): v is number => v != null)) : 0;
  const total = Math.max(planTotal, lastT, 1);
  const top = Math.max(1, ...plan.map((p) => p.high ?? p.low ?? 0), ...(power?.w.filter((v): v is number => v != null) ?? [0])) * 1.1;
  const x = (s: number) => (s / total) * W;
  const y = (w: number) => H - (w / top) * H;

  const starts = plan.map((_, i) => plan.slice(0, i).reduce((a, p) => a + p.seconds, 0));
  const blocks = plan.map((p, i) => {
    const from = starts[i];
    const hi = p.high ?? p.low;
    if (hi == null || p.seconds === 0) return null;
    const lo = p.low ?? 0;
    return <rect key={i} x={x(from)} width={Math.max(1, x(p.seconds) - 1)} y={y(hi)} height={Math.max(2, y(lo) - y(hi))} className="fill-primary/25" />;
  });

  let line = "";
  if (power) {
    const buckets = new Map<number, { sum: number; n: number }>();
    power.t.forEach((t, i) => {
      const w = power.w[i];
      if (t == null || w == null) return;
      const b = Math.floor(t / SMOOTH_S);
      const cur = buckets.get(b) ?? { sum: 0, n: 0 };
      cur.sum += w;
      cur.n++;
      buckets.set(b, cur);
    });
    line = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, v], i) => `${i ? "L" : "M"}${x(b * SMOOTH_S + SMOOTH_S / 2).toFixed(1)},${y(v.sum / v.n).toFixed(1)}`)
      .join(" ");
  }

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Planned power blocks and your recorded power">
        {blocks}
        {line && <path d={line} fill="none" strokeWidth={1.5} className="stroke-foreground" />}
      </svg>
      <figcaption className="text-xs text-muted-foreground">Blocks: plan. Line: your power.</figcaption>
    </figure>
  );
}
