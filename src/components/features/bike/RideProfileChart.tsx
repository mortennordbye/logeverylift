/**
 * The planned power profile of a ride (docs/plans/bike-ride-logger.md,
 * section 5): zone bands Z1 to Z4, a watt scale, the FTP line and one bar per
 * step. A range shows a cap to its high end, a ramp a slope, an "under"
 * target a dashed cap. One accent; the zone shows as its opacity. The zone
 * names sit in a gutter right of the plot, so no bar label covers them.
 * The layout comes from `rideChart` (src/lib/utils/bike-ride-view.ts).
 */

import { CHART, type RideChart } from "@/lib/utils/bike-ride-view";
import type { DoneChart } from "@/lib/utils/ride-stream";

/** Accent opacity per power zone, one step up per zone to zone 5 and above: easy quiet, hard strong. */
const ZONE_OPACITY = [0.25, 0.42, 0.6, 0.78, 0.95];
export const zoneOpacity = (zone: number) => ZONE_OPACITY[Math.min(Math.max(zone, 1), 5) - 1];
const opacity = zoneOpacity;

export function RideProfileChart({ chart, label }: { chart: RideChart; label: string }) {
  const { left, right, base, width, height } = CHART;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block w-full h-auto" data-testid="ride-profile">
      {chart.bands.map((b) => (
        <g key={b.zone}>
          <rect x={left} y={b.y} width={right - left} height={b.h} className="fill-foreground" fillOpacity={b.zone % 2 ? 0.03 : 0.07} />
          {b.h >= 6 && (
            <text x={width - 1} y={b.y + Math.min(b.h / 2 + 2.5, b.h - 1)} textAnchor="end" fontSize={7} className="fill-muted-foreground">
              Z{b.zone}
            </text>
          )}
        </g>
      ))}
      {chart.yTicks.map((t) => (
        <text key={t.label} x={left - 3} y={t.y + 2.5} textAnchor="end" fontSize={7.5} className="fill-muted-foreground">
          {t.label}
        </text>
      ))}
      {chart.ftpY !== null && (
        <>
          <line x1={left} y1={chart.ftpY} x2={right} y2={chart.ftpY} className="stroke-foreground" strokeOpacity={0.55} strokeDasharray="3 3" />
          <text x={left - 3} y={chart.ftpY + 2.5} textAnchor="end" fontSize={7.5} className="fill-foreground">
            FTP
          </text>
        </>
      )}
      {chart.bars.map((b) => {
        const labelY = Math.min(b.capY ?? b.y, b.y2) - 4;
        return (
          <g key={b.key}>
            {b.kind === "ramp" ? (
              <polygon points={`${b.x},${base} ${b.x},${b.y} ${b.x + b.w},${b.y2} ${b.x + b.w},${base}`} className="fill-brand" fillOpacity={0.5} />
            ) : (
              <rect x={b.x} y={b.y} width={b.w} height={Math.max(0, base - b.y)} className="fill-brand" fillOpacity={b.kind === "none" ? 0.15 : opacity(b.zone)} />
            )}
            {b.kind === "range" && b.capY !== null && (
              <rect x={b.x} y={b.capY} width={b.w} height={Math.max(0, b.y - b.capY)} className="fill-brand stroke-brand" fillOpacity={0.45 * opacity(b.zone)} strokeWidth={0.8} />
            )}
            {b.kind === "under" && b.capY !== null && (
              <line x1={b.x} y1={b.capY} x2={b.x + b.w} y2={b.capY} className="stroke-brand" strokeWidth={1.5} strokeDasharray="2 2" />
            )}
            {b.label && (
              <text x={b.x + b.w / 2} y={labelY} textAnchor="middle" fontSize={7.5} fontWeight={600} className="fill-foreground">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
      <line x1={left} y1={base} x2={right} y2={base} className="stroke-muted-foreground" strokeOpacity={0.5} />
      {chart.xTicks.map((t, i) => (
        <text
          key={t.label}
          x={t.x}
          y={base + 11}
          textAnchor={i === 0 ? "start" : i === chart.xTicks.length - 1 ? "end" : "middle"}
          fontSize={7.5}
          className="fill-muted-foreground"
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
}

/** Time in power zones as one bar with minutes under it: planned on the bike screen, done on the summary. */
export function RideZoneBar({ zones, label, testId }: { zones: { zone: number; m: number }[]; label: string; testId?: string }) {
  if (!zones.length) return null;
  return (
    <div data-testid={testId}>
      <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label}, ${zones.map((z) => `Z${z.zone} ${z.m} min`).join(", ")}`}>
        {zones.map((z) => (
          <i key={z.zone} className="bg-brand" style={{ flex: z.m, opacity: zoneOpacity(z.zone) }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        {zones.map((z, i) => (
          <span key={z.zone}>
            Z{z.zone} {z.m}
            {i === zones.length - 1 ? " min" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Plan against done from a Garmin stream (section 5, "Summary"): each ridden
 * step's power target as a band, the power line, and heart rate as a dashed
 * line on its own scale. The layout comes from `rideDoneChart`
 * (src/lib/utils/ride-stream.ts).
 */
export function RideDoneChart({ chart }: { chart: DoneChart }) {
  const { left, right, base, width, height } = CHART;
  const label = `Done against plan${chart.power ? ", power line over the target bands" : ""}${chart.hr ? ", heart rate dashed" : ""}`;
  return (
    <div data-testid="summary-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block w-full h-auto">
        {chart.bands.map((b) => (
          <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} className="fill-brand" fillOpacity={0.18} />
        ))}
        {chart.ftpY !== null && (
          <>
            <line x1={left} y1={chart.ftpY} x2={right} y2={chart.ftpY} className="stroke-foreground" strokeOpacity={0.4} strokeDasharray="3 3" />
            <text x={left - 3} y={chart.ftpY + 2.5} textAnchor="end" fontSize={7.5} className="fill-foreground">
              FTP
            </text>
          </>
        )}
        {chart.yTicks.map((t) => (
          <text key={t.label} x={left - 3} y={t.y + 2.5} textAnchor="end" fontSize={7.5} className="fill-muted-foreground">
            {t.label}
          </text>
        ))}
        {chart.power && <polyline points={chart.power} fill="none" className="stroke-brand" strokeWidth={1.3} strokeLinejoin="round" data-testid="chart-power" />}
        {chart.hr && (
          <polyline points={chart.hr} fill="none" className="stroke-foreground" strokeOpacity={0.75} strokeWidth={1.1} strokeDasharray="3 2" data-testid="chart-hr" />
        )}
        {chart.hrLabel && (
          <text x={chart.hrLabel.x} y={chart.hrLabel.y} textAnchor="end" fontSize={7} className="fill-foreground">
            {chart.hrLabel.text}
          </text>
        )}
        <line x1={left} y1={base} x2={right} y2={base} className="stroke-muted-foreground" strokeOpacity={0.5} />
        {chart.xTicks.map((t, i) => (
          <text
            key={t.label}
            x={t.x}
            y={base + 11}
            textAnchor={i === 0 ? "start" : i === chart.xTicks.length - 1 ? "end" : "middle"}
            fontSize={7.5}
            className="fill-muted-foreground"
          >
            {t.label}
          </text>
        ))}
      </svg>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
        {chart.power && (
          <span className="inline-flex items-center gap-1">
            <i className="inline-block w-3 border-t-2 border-brand" />
            Power
          </span>
        )}
        {chart.hr && (
          <span className="inline-flex items-center gap-1">
            <i className="inline-block w-3 border-t-2 border-dashed border-foreground opacity-75" />
            Heart rate
          </span>
        )}
        {chart.bands.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <i className="inline-block w-3 h-2 bg-brand opacity-30" />
            Target
          </span>
        )}
      </div>
    </div>
  );
}
