import { PartViews } from "@/components/features/measurements/BodyFigure";
import type { BodyPart, Tape } from "@/lib/utils/body-measurement-parts";
import type { MeasurementRow } from "@/lib/utils/body-measurements";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">{children}</p>;
}

/**
 * One line per series over a shared date axis: the first series full, the
 * second (the right side) dashed and muted. A dot marks each latest value.
 */
export function TrendLine({
  series,
  width,
  height,
  className,
  dots = false,
}: {
  series: MeasurementRow[][];
  width: number;
  height: number;
  className?: string;
  /** A dot on every value, not only the latest. */
  dots?: boolean;
}) {
  const all = series.flat();
  if (all.length === 0) return null;
  const pad = 3;
  const t = (r: MeasurementRow) => Date.parse(r.measuredOn);
  const t0 = Math.min(...all.map(t));
  const span = Math.max(...all.map(t)) - t0;
  const v0 = Math.min(...all.map((r) => r.valueCm));
  const vr = Math.max(...all.map((r) => r.valueCm)) - v0 || 1;
  // One date (or the L and R of one date): the points sit in the middle.
  const x = (r: MeasurementRow) => (span === 0 ? width / 2 : pad + ((t(r) - t0) / span) * (width - 2 * pad));
  const y = (r: MeasurementRow) => height - pad - ((r.valueCm - v0) / vr) * (height - 2 * pad);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      {series.map((s, k) => {
        const color = k ? "var(--muted-foreground)" : "var(--foreground)";
        const last = s.at(-1);
        return (
          <g key={k}>
            {s.length > 1 && (
              <polyline
                points={s.map((r) => `${x(r)},${y(r)}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={k ? "2 2" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {(dots ? s : last ? [last] : []).map((r) => (
              <circle key={r.id} cx={x(r)} cy={y(r)} r={dots ? 2.5 : 1.8} fill={color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Where to measure a part, the three steps and the tip, with the whole body from the front and behind and the place lit up. */
export function MeasureGuide({ part, tape }: { part: BodyPart; tape?: Tape | null }) {
  return (
    <div className="space-y-3 text-sm" data-testid="measure-guide">
      <div className="flex justify-center rounded-xl bg-muted py-3">
        <PartViews tape={tape ?? null} rule={part.rule} name={part.name} className="w-full h-auto" />
      </div>
      <p>
        <span className="font-semibold">Where</span> · {part.where}
      </p>
      <ol className="list-decimal pl-5 space-y-1">
        {part.how.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ol>
      <p className="text-muted-foreground">
        <span className="font-semibold text-foreground">Tip</span> · {part.tip}
      </p>
    </div>
  );
}
