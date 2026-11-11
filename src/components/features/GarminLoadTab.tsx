"use client";

import { EChart } from "@/components/charts/EChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import type { Track } from "@/lib/garmin/analytics/pmc";
import { rampBand } from "@/lib/garmin/analytics/pmc";
import { SPORTS, type Sport } from "@/lib/garmin/analytics/sport";
import {
  DISTRIBUTION_TEXT,
  RANGE_LABEL,
  distributionOption,
  formBandLabel,
  latestWeekWithData,
  loadHeadline,
  pmcOption,
  rangeStart,
  weeksInRange,
  weeklyLoadOption,
  type LoadSeries,
  type RangeKey,
} from "@/lib/garmin/charts/load";
import { SPORT_LABEL, SPORT_MARK } from "@/lib/garmin/charts/theme";
import { formatDateShort } from "@/lib/utils/format";
import { useMemo, useState } from "react";

const RANGES: RangeKey[] = ["6w", "3m", "1y", "all"];

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`h-9 min-w-11 px-3 rounded-full text-sm font-medium flex-none flex items-center justify-center gap-1.5 active:opacity-70 ${
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SportDot({ sport }: { sport: Sport }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ background: `var(--viz-${sport})` }}
    >
      {SPORT_MARK[sport]}
    </span>
  );
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

/** Line key (lines) or swatch (bars) + name, as the legend; values come in the readout. */
function Legend({ items }: { items: { name: string; color: string; kind: "line" | "bar" | "dot"; mark?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          {i.kind === "line" ? (
            <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: i.color }} />
          ) : i.kind === "dot" ? (
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: i.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.mark && <span className="font-semibold text-foreground">{i.mark}</span>}
          {i.name}
        </span>
      ))}
    </div>
  );
}

/** The values at the crosshair, above the chart where a finger can't hide them. Values lead, names follow. */
function Readout({ title, values }: { title: string; values: { label: string; value: string }[] }) {
  return (
    <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap min-h-[34px] tabular-nums" aria-live="polite">
      <span className="text-[11px] text-muted-foreground w-full">{title}</span>
      {values.map((v) => (
        <span key={v.label} className="text-xs text-muted-foreground">
          <span className="text-base font-semibold text-foreground">{v.value}</span> {v.label}
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

export function GarminLoadTab({ series, computedAt }: { series: LoadSeries; computedAt: string | null }) {
  const theme = useVizTheme();
  const [range, setRange] = useState<RangeKey>("3m");
  const [track, setTrack] = useState<Track>("total");
  const [pmcIdx, setPmcIdx] = useState<number | null>(null);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [distIdx, setDistIdx] = useState<number | null>(null);

  const from = rangeStart(series, range);
  const weeks = useMemo(() => weeksInRange(series, range), [series, range]);
  const sportsWithLoad = SPORTS.filter((s) => series.loads[s].some((v) => v > 0));
  const pmc = useMemo(() => (theme ? pmcOption(series, track, range, theme) : null), [series, track, range, theme]);
  const weekly = useMemo(() => (theme ? weeklyLoadOption(weeks, theme) : null), [weeks, theme]);
  const dist = useMemo(() => (theme ? distributionOption(weeks, theme) : null), [weeks, theme]);

  const n = series.dates.length;
  if (n === 0) {
    return <p className="text-sm text-muted-foreground text-center py-12">No load yet. It is computed in the background as Garmin data imports.</p>;
  }

  const t = series.tracks[track];
  const last = n - 1;
  const weekAgo = Math.max(0, last - 7);
  const ramp = t.ctl[last] - t.ctl[weekAgo];
  const pi = pmcIdx !== null ? from + pmcIdx : last;
  const wk = weeks[weekIdx ?? latestWeekWithData(weeks)];
  const dk = weeks[distIdx ?? latestWeekWithData(weeks, true)];
  const dayLoad = track === "total" ? SPORTS.reduce((s, sp) => s + series.loads[sp][pi], 0) : series.loads[track][pi];
  const pct = (w: (typeof weeks)[number], k: "low" | "mid" | "high") => {
    const total = w.bands.low + w.bands.mid + w.bands.high;
    return total > 0 ? `${Math.round((w.bands[k] / total) * 100)}%` : "–";
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar" role="toolbar" aria-label="Range and sport">
        {RANGES.map((r) => (
          <Chip key={r} active={range === r} onClick={() => setRange(r)}>
            {RANGE_LABEL[r]}
          </Chip>
        ))}
        <span className="w-px bg-border flex-none my-1" />
        <Chip active={track === "total"} onClick={() => setTrack("total")}>
          All
        </Chip>
        {sportsWithLoad.map((s) => (
          <Chip key={s} active={track === s} onClick={() => setTrack(s)} label={SPORT_LABEL[s]}>
            <SportDot sport={s} />
            {SPORT_LABEL[s]}
          </Chip>
        ))}
      </div>

      <p className="text-lg font-semibold leading-snug">{loadHeadline(series, track)}</p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Fitness (CTL)" value={String(Math.round(t.ctl[last]))} sub={`${signed(ramp)} in 7 days`} />
        <Stat label="Fatigue (ATL)" value={String(Math.round(t.atl[last]))} sub={`${signed(t.atl[last] - t.atl[weekAgo])} in 7 days`} />
        <Stat label="Form (TSB)" value={signed(t.tsb[last])} sub={formBandLabel(t.tsb[last])} />
        <Stat label="Ramp rate" value={`${signed(ramp)}/wk`} sub={{ normal: "Normal (≤5)", fast: "Fast (5–8)", warning: "Too fast (>8)" }[rampBand(ramp)]} />
      </div>

      <Card title="Fitness, fatigue and form" note="Fitness is a 42-day average of daily load, fatigue a 7-day one. Form is yesterday's fitness minus fatigue. 100 load = one hour at threshold.">
        <Legend
          items={[
            { name: "Fitness", color: "var(--viz-positive)", kind: "line" },
            { name: "Fatigue", color: "var(--viz-bike)", kind: "line" },
            { name: "Daily load", color: "var(--muted-foreground)", kind: "bar" },
            { name: "Form", color: "var(--viz-negative)", kind: "bar" },
          ]}
        />
        <Readout
          title={formatDateShort(series.dates[pi])}
          values={[
            { label: "fitness", value: String(Math.round(t.ctl[pi])) },
            { label: "fatigue", value: String(Math.round(t.atl[pi])) },
            { label: `form · ${formBandLabel(t.tsb[pi]).toLowerCase()}`, value: signed(t.tsb[pi]) },
            { label: "load", value: String(Math.round(dayLoad)) },
          ]}
        />
        {pmc && (
          <EChart
            option={pmc}
            height={300}
            onIndex={setPmcIdx}
            ariaLabel={`Fitness ${Math.round(t.ctl[last])}, fatigue ${Math.round(t.atl[last])}, form ${signed(t.tsb[last])} on ${series.dates[last]}.`}
          />
        )}
      </Card>

      <Card title="Weekly load by sport" note="ACWR: this week against the three before. Above 1.3 the jump in load raises injury risk.">
        <Legend
          items={[
            ...SPORTS.filter((s) => weeks.some((w) => w.loads[s] > 0)).map((s) => ({ name: SPORT_LABEL[s], color: `var(--viz-${s})`, kind: "bar" as const, mark: SPORT_MARK[s] })),
            { name: "ACWR", color: "var(--muted-foreground)", kind: "dot" },
          ]}
        />
        {wk && (
          <Readout
            title={`Week of ${formatDateShort(wk.weekStart)}`}
            values={[
              { label: "total", value: String(Math.round(wk.total)) },
              ...SPORTS.filter((s) => wk.loads[s] > 0).map((s) => ({ label: SPORT_LABEL[s].toLowerCase(), value: String(Math.round(wk.loads[s])) })),
              { label: "ACWR", value: wk.acwr.toFixed(2) },
            ]}
          />
        )}
        {weekly && <EChart option={weekly} height={226} onIndex={setWeekIdx} ariaLabel={`Weekly load for ${weeks.length} weeks.`} />}
      </Card>

      <Card title="Intensity distribution" note="Time by heart rate: low under 85 % of LTHR, mid 85 to 100 %, high above. The outlined band is the Ironman build target: 75 to 85 % low.">
        <Legend
          items={[
            { name: "Low", color: "var(--viz-band-low)", kind: "bar" },
            { name: "Mid", color: "var(--viz-band-mid)", kind: "bar" },
            { name: "High", color: "var(--viz-band-high)", kind: "bar" },
          ]}
        />
        {dk && (
          <Readout
            title={`Week of ${formatDateShort(dk.weekStart)} · ${DISTRIBUTION_TEXT[dk.label]}`}
            values={[
              { label: "low", value: pct(dk, "low") },
              { label: "mid", value: pct(dk, "mid") },
              { label: "high", value: pct(dk, "high") },
            ]}
          />
        )}
        {dist && <EChart option={dist} height={150} onIndex={setDistIdx} ariaLabel={`Intensity distribution for ${weeks.length} weeks.`} />}
      </Card>

      <p className="text-[11px] text-muted-foreground px-1">
        {computedAt ? `Computed ${formatDateShort(computedAt.slice(0, 10))}, ${computedAt.slice(11, 16)} UTC.` : "Computing…"} Strength sessions logged here count with their RPE; a lift Garmin also recorded counts once.
      </p>
    </div>
  );
}
