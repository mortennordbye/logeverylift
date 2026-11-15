import type { ProfileBlock } from "@/lib/utils/workout-edit";

/** Fill per power zone, zone 1 first; a step with no power target is grey. */
const ZONE_FILL = ["#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"];
const HEIGHT = 64;
/** The top of the chart, in % FTP. */
const TOP = 130;

/**
 * The editor's small profile chart: one block per step, width by time, height
 * by % FTP, colour by power zone, and the FTP line dashed. The session page
 * draws its own (S3).
 */
export function ProfileChart({ blocks }: { blocks: ProfileBlock[] }) {
  const total = blocks.reduce((a, b) => a + b.seconds, 0);
  if (!total) return null;
  const starts = blocks.map((_, i) => blocks.slice(0, i).reduce((a, b) => a + b.seconds, 0));
  const ftpY = HEIGHT - (100 / TOP) * HEIGHT;
  return (
    <svg viewBox={`0 0 ${total} ${HEIGHT}`} preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label="Workout profile: each block is a step, higher is harder">
      {blocks.map((b, i) => {
        const h = b.pctFtp !== null ? Math.max(4, (Math.min(b.pctFtp, TOP) / TOP) * HEIGHT) : 8;
        return <rect key={i} x={starts[i]} y={HEIGHT - h} width={Math.max(b.seconds - total / 400, 1)} height={h} fill={b.zone ? ZONE_FILL[b.zone - 1] : "#55555a"} opacity={b.open ? 0.5 : 1} />;
      })}
      <line x1={0} x2={total} y1={ftpY} y2={ftpY} stroke="currentColor" strokeOpacity={0.5} strokeDasharray={`${total / 80} ${total / 120}`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
