import { markerX, profileGeometry, type ProfileBlock } from "@/lib/utils/workout-profile";

/**
 * The workout profile as plain SVG (docs/plans/bike-sessions.md, 5.1, 5.2,
 * 5.4): blocks over time, height = % FTP, colour = power zone. The label
 * names every block, so the colour is never the only carrier of meaning.
 */
export function ProfileChart({
  blocks,
  height = 90,
  axis = true,
  ftp = null,
  nowSeconds = null,
}: {
  blocks: ProfileBlock[];
  height?: number;
  axis?: boolean;
  /** Draws the dashed FTP line with this label. */
  ftp?: number | null;
  /** Draws the "now" marker after this many planned seconds. */
  nowSeconds?: number | null;
}) {
  if (blocks.length === 0) return null;
  const width = 358;
  const g = profileGeometry(blocks, width, height, axis);
  const label = `Workout profile: ${blocks.map((b) => `${Math.round(b.seconds / 60)} min Z${b.zone}`).join(", ")}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={label} data-testid="profile-chart">
      {g.rects.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2} fill={`var(--viz-zone-${r.zone})`} />
          {r.fuel && <circle cx={r.x + 3} cy={Math.max(3, r.y - 6)} r={3} fill="var(--color-amber-500, #d9a43a)" />}
        </g>
      ))}
      {ftp !== null && (
        <>
          <line x1={0} x2={width} y1={g.ftpY} y2={g.ftpY} stroke="currentColor" strokeOpacity={0.45} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <text x={width - 2} y={g.ftpY - 3} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>
            FTP {ftp} W
          </text>
        </>
      )}
      {nowSeconds !== null && (
        <line x1={markerX(g, nowSeconds)} x2={markerX(g, nowSeconds)} y1={0} y2={g.base} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="profile-now" />
      )}
      {g.ticks.map((t) => (
        <text key={t.anchor} x={t.x} y={height - 2} textAnchor={t.anchor} fontSize={10} fill="currentColor" fillOpacity={0.6}>
          {t.label}
        </text>
      ))}
    </svg>
  );
}
