"use client";

import { FrontFigure, TapeBand } from "@/components/features/measurements/BodyFigure";
import { SectionLabel, TrendLine } from "@/components/features/measurements/measurement-ui";
import { Segmented } from "@/components/features/season-ui";
import { BODY_PARTS, type BodyPart } from "@/lib/utils/body-measurement-parts";
import {
  CHANGE_SINCE_OPTIONS,
  bodyRatios,
  changeSince,
  formatChange,
  formatCm,
  nextLogFrom,
  seriesOf,
  sideNote,
  type ChangeSince,
  type MeasurementRow,
} from "@/lib/utils/body-measurements";
import { formatDateShort } from "@/lib/utils/format";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const CIRCUMFERENCE = BODY_PARTS.filter((p) => p.kind === "circumference");
const LENGTHS = BODY_PARTS.filter((p) => p.kind === "length");
const partHref = (p: BodyPart) => `/more/account/measurements/${p.site}`;

/** A part's series: one for a trunk part, left then right for a sided part. */
function seriesFor(rows: MeasurementRow[], p: BodyPart): MeasurementRow[][] {
  return p.sides ? [seriesOf(rows, p.site, "left"), seriesOf(rows, p.site, "right")] : [seriesOf(rows, p.site, "none")];
}

type PartView = { part: BodyPart; series: MeasurementRow[][]; value: string | null; change: string | null; note: string | null };

function viewOf(rows: MeasurementRow[], part: BodyPart, since: ChangeSince, today: string, letters: boolean): PartView {
  const series = seriesFor(rows, part);
  const latest = series.map((s) => s.at(-1)?.valueCm ?? null);
  const changes = series.map((s) => changeSince(s, since, today));
  let value: string | null;
  let change: string | null;
  if (part.sides) {
    const [l, r] = latest;
    const bits = [l !== null && `${letters ? "L " : ""}${formatCm(l)}`, r !== null && `${letters ? "R " : ""}${formatCm(r)}`].filter(Boolean);
    value = bits.length ? bits.join(" · ") : null;
    change = changes.some(Boolean) ? changes.map((c) => (c ? formatChange(c.delta) : "new")).join(" · ") : null;
  } else {
    value = latest[0] !== null ? formatCm(latest[0]) : null;
    change = changes[0] ? formatChange(changes[0].delta) : null;
  }
  return { part, series, value, change, note: part.sides ? sideNote(latest[0], latest[1]) : null };
}

export function MeasurementsClient({
  rows,
  today,
  gender,
  heightCm,
}: {
  rows: MeasurementRow[];
  today: string;
  gender: string | null;
  heightCm: number | null;
}) {
  const [since, setSince] = useState<ChangeSince>("first");
  const logButton = (
    <div className="shrink-0 px-4 pt-3 pb-4 bg-background">
      <Link
        href="/more/account/measurements/log"
        className="flex items-center justify-center w-full min-h-[52px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-80"
      >
        Log measurements
      </Link>
    </div>
  );

  if (rows.length === 0) {
    return (
      <>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2">
          <div className="rounded-2xl bg-card p-4 space-y-1" data-testid="measurements-empty">
            <p className="font-semibold">No measurements yet</p>
            <p className="text-sm text-muted-foreground">
              Measure with a soft tape, in the morning, before training. Log the parts you measured. You can leave the others empty.
            </p>
          </div>
          <div className="rounded-2xl bg-card px-2 pt-3 pb-2 mt-3 w-full max-w-md mx-auto">
            <ValueMap views={CIRCUMFERENCE.map((p) => viewOf(rows, p, "first", today, false))} />
            <p className="text-xs text-muted-foreground text-center pt-1">Tap a point to see how to measure it</p>
          </div>
        </div>
        {logButton}
      </>
    );
  }

  const dates = rows.map((r) => r.measuredOn).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const latest = (site: BodyPart["site"]) => seriesOf(rows, site, "none").at(-1)?.valueCm ?? null;
  const ratios = bodyRatios({
    gender,
    heightCm,
    neck: latest("neck"),
    shoulders: latest("shoulders"),
    waist: latest("waist"),
    hips: latest("hips"),
  });

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-4 flex flex-col gap-5">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground px-1">
            Last log {formatDateShort(last)}
            {first !== last && ` · first log ${formatDateShort(first)}`}
          </p>
          <Segmented label="Change since" value={since} options={CHANGE_SINCE_OPTIONS} onChange={setSince} />
        </div>

        <div className="rounded-2xl bg-card px-2 pt-3 pb-2 w-full max-w-md mx-auto">
          <ValueMap views={CIRCUMFERENCE.map((p) => viewOf(rows, p, since, today, false))} />
          <p className="text-xs text-muted-foreground text-center pt-1">Tap a point to see how to measure it</p>
        </div>

        {ratios.length > 0 && (
          <div>
            <SectionLabel>Body ratios</SectionLabel>
            <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
              {ratios.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 min-h-[52px] py-3" data-testid={`ratio-${r.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.note}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionLabel>Circumference · cm</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
            {CIRCUMFERENCE.map((p) => (
              <PartRow key={p.site} view={viewOf(rows, p, since, today, true)} />
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Length · cm</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
            {LENGTHS.map((p) => {
              const v = latest(p.site);
              return (
                <Link key={p.site} href={partHref(p)} className="flex items-center gap-3 px-4 min-h-[52px] py-3 active:opacity-60" data-testid={`measurement-row-${p.site}`}>
                  <span className="flex-1 text-sm">
                    {p.n} · {p.name}
                  </span>
                  <span className={`text-sm ${v === null ? "text-muted-foreground" : "font-semibold"}`}>{v === null ? "Not set" : `${formatCm(v)} cm`}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center" data-testid="next-log">
          Next log from {formatDateShort(nextLogFrom(last))} · every 2 to 4 weeks
        </p>
      </div>
      {logButton}
    </>
  );
}

function PartRow({ view }: { view: PartView }) {
  const { part, series, value, change, note } = view;
  return (
    <Link href={partHref(part)} className="flex items-center gap-3 px-4 min-h-[52px] py-3 active:opacity-60" data-testid={`measurement-row-${part.site}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {part.n} · {part.name}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <TrendLine series={series} width={48} height={20} className="w-12 h-5 shrink-0" />
      <div className="text-right shrink-0 min-w-[84px]">
        <p className={`text-sm tabular-nums ${value ? "font-semibold" : "text-muted-foreground"}`}>{value ? (part.sides ? value : `${value} cm`) : "Not set"}</p>
        {change && <p className="text-xs text-muted-foreground tabular-nums">{change}</p>}
      </div>
    </Link>
  );
}

// The map: the figure at x 80 in a 340 wide box, labels left of x 106 or right of x 254.
const MAP_X = 80;
const LABEL_L = 106;
const LABEL_R = 254;

function ValueMap({ views }: { views: PartView[] }) {
  const router = useRouter();
  return (
    <svg viewBox="0 0 340 392" className="w-full" role="img" aria-label="Body map with the latest value at each point">
      <g transform={`translate(${MAP_X} 0)`}>
        <FrontFigure />
        {views.map((v) => (
          <TapeBand key={v.part.site} tape={v.part.tape!} width={2} />
        ))}
      </g>
      {views.map(({ part, value, change }) => {
        const t = part.tape!;
        const left = t.label === "L";
        const ex = MAP_X + (left ? t.x1 : t.x2);
        const tx = left ? LABEL_L : LABEL_R;
        const anchor = left ? "end" : "start";
        return (
          <g key={part.site} onClick={() => router.push(`/more/account/measurements/${part.site}`)} style={{ cursor: "pointer" }} data-testid={`map-point-${part.site}`}>
            <polyline points={`${ex},${t.y} ${left ? tx + 8 : tx - 8},${t.ly}`} fill="none" stroke="var(--muted-foreground)" strokeWidth={0.9} opacity={0.6} />
            <circle cx={ex} cy={t.y} r={2.6} fill="var(--primary)" />
            <text x={tx} y={t.ly - 4} textAnchor={anchor} fontSize={11} fill="var(--muted-foreground)">
              {part.name}
            </text>
            {value && (
              <text x={tx} y={t.ly + 12} textAnchor={anchor} fontSize={14.5} fontWeight={700} fill="var(--foreground)">
                {value}
                {change && change !== "±0" && !part.sides && (
                  <tspan fontSize={10.5} fontWeight={500} fill="var(--muted-foreground)" dx={4}>
                    {change}
                  </tspan>
                )}
              </text>
            )}
            {/* A 44 px tap area over the label. */}
            <rect x={left ? 0 : tx - 10} y={t.ly - 21} width={left ? tx + 10 : 340 - tx + 10} height={42} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
