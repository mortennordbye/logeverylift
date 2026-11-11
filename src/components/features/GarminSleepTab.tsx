"use client";

import { EChart } from "@/components/charts/EChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import {
  clockLabel,
  durationOption,
  durationRows,
  hrvOption,
  restingHrOption,
  stageRows,
  stagesOption,
  stressOption,
  timingOption,
  timingRows,
} from "@/lib/garmin/charts/sleep";
import type { SleepTabData } from "@/lib/garmin/queries";
import { formatDateShort } from "@/lib/utils/format";
import { useMemo, useState } from "react";

function Card({ title, aside, children, note }: { title: string; aside?: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {aside && <span className="text-[11px] text-muted-foreground">{aside}</span>}
      </div>
      {children}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

function Legend({ items }: { items: { name: string; color: string; kind: "line" | "bar" | "dot" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className={i.kind === "line" ? "inline-block h-0.5 w-3.5 rounded-full" : i.kind === "dot" ? "inline-block h-2 w-2 rounded-full" : "inline-block h-2.5 w-2.5 rounded-sm"} style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

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

const hm = (h: number | null) => (h === null ? "–" : `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`);

export function GarminSleepTab({ data }: { data: SleepTabData }) {
  const theme = useVizTheme();
  const [ti, setTi] = useState<number | null>(null);
  const [di, setDi] = useState<number | null>(null);
  const [si, setSi] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [ri, setRi] = useState<number | null>(null);
  const [xi, setXi] = useState<number | null>(null);

  const timing = useMemo(() => timingRows(data), [data]);
  const durations = useMemo(() => durationRows(data), [data]);
  const stages = useMemo(() => stageRows(data), [data]);
  const opts = useMemo(
    () =>
      theme
        ? {
            timing: timingOption(timing, theme),
            duration: durationOption(durations, theme),
            stages: stagesOption(data, theme),
            hrv: hrvOption(data, theme),
            rhr: restingHrOption(data, theme),
            stress: stressOption(data, theme),
          }
        : null,
    [data, theme, timing, durations],
  );

  if (!data.nights.length) return <p className="text-sm text-muted-foreground text-center py-12">No sleep data yet.</p>;

  const latest = data.days.at(-1);
  const debtH = latest?.sleepDebtS != null ? latest.sleepDebtS / 3600 : null;
  const t = timing[ti ?? timing.length - 1];
  const d = durations[di ?? durations.length - 1];
  const s = stages[si ?? stages.length - 1];
  const h = data.days[hi ?? data.days.length - 1];
  const r = data.days[ri ?? data.days.length - 1];
  const stressRows = data.stress.slice(-28);
  const x = stressRows[xi ?? stressRows.length - 1];
  const pct = (v: number | null) => {
    const total = (s?.deep ?? 0) + (s?.light ?? 0) + (s?.rem ?? 0) + (s?.awake ?? 0);
    return total > 0 ? `${Math.round(((v ?? 0) / total) * 100)}%` : "–";
  };
  const regularity = latest?.regularity;

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold leading-snug">
        {regularity != null ? `Sleep regularity ${Math.round(regularity)} of 100. ` : ""}
        {debtH !== null ? (debtH < 0.5 ? "No sleep debt." : `${debtH.toFixed(1)} h of sleep debt over two weeks.`) : ""}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Regularity", value: regularity != null ? String(Math.round(regularity)) : "–" },
          { label: "Bedtime spread", value: latest?.timing.onsetSpread != null ? `±${Math.round(latest.timing.onsetSpread)}m` : "–" },
          { label: "Weekend shift", value: latest?.timing.socialJetlag != null ? `${Math.round(latest.timing.socialJetlag)}m` : "–" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl bg-muted p-3">
            <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            <p className="text-xl font-semibold">{tile.value}</p>
          </div>
        ))}
      </div>

      {opts && t && (
        <Card title="When you sleep · 28 nights" note="Bars run from falling asleep to waking. Lines: your median bedtime and wake time. Regular timing is one of the strongest sleep habits for recovery.">
          <Readout title={formatDateShort(t.date)} values={[{ label: "asleep", value: clockLabel(t.onset) }, { label: "awake", value: clockLabel(t.wake) }]} />
          <EChart option={opts.timing} height={210} onIndex={setTi} ariaLabel={`Sleep windows for ${timing.length} nights.`} />
        </Card>
      )}

      {opts && d && (
        <Card title="Sleep against need" note="Bar: time asleep (orange when short of need). Tick: Garmin's need for that night. Below: debt over 14 nights, recent nights weighing more.">
          <Legend items={[{ name: "Slept", color: "var(--viz-positive)", kind: "bar" }, { name: "Short", color: "var(--viz-bike)", kind: "bar" }, { name: "Need", color: "var(--foreground)", kind: "line" }, { name: "Debt", color: "var(--viz-bike)", kind: "line" }]} />
          <Readout
            title={formatDateShort(d.date)}
            values={[
              { label: "slept", value: hm(d.hours) },
              { label: "need", value: hm(d.needH) },
              { label: "debt", value: d.debtH !== null ? `${d.debtH}h` : "–" },
              ...(d.score !== null ? [{ label: "score", value: String(d.score) }] : []),
            ]}
          />
          <EChart option={opts.duration} height={208} onIndex={setDi} ariaLabel="Sleep duration against need, and sleep debt." />
        </Card>
      )}

      {opts && s && (
        <Card title="Sleep stages" note="Shares of each night. Garmin gives totals only, so there is no stage timeline to draw.">
          <Legend items={[{ name: "Deep", color: "var(--viz-band-low)", kind: "bar" }, { name: "Light", color: "var(--viz-band-mid)", kind: "bar" }, { name: "REM", color: "var(--viz-other)", kind: "bar" }, { name: "Awake", color: "var(--muted-foreground)", kind: "bar" }]} />
          <Readout title={formatDateShort(s.date)} values={[{ label: "deep", value: pct(s.deep) }, { label: "light", value: pct(s.light) }, { label: "REM", value: pct(s.rem) }, { label: "awake", value: pct(s.awake) }]} />
          <EChart option={opts.stages} height={140} onIndex={setSi} ariaLabel="Sleep stage shares per night." />
        </Card>
      )}

      {opts && h && (
        <Card title="HRV · 90 days" aside={h.hrv.bandSource === "ours" ? "Band: your 60-day range" : h.hrv.bandSource === "garmin" ? "Band: Garmin's range" : undefined} note="Dots: each night. Line: 7-day mean. Grey: your normal range. Below: night-to-night variation (CV); a rising CV often comes before a drop.">
          <Legend items={[{ name: "Night", color: "var(--viz-positive)", kind: "dot" }, { name: "7-day mean", color: "var(--viz-positive)", kind: "line" }, { name: "Normal range", color: "var(--muted-foreground)", kind: "bar" }, { name: "CV", color: "var(--muted-foreground)", kind: "line" }]} />
          <Readout
            title={`${formatDateShort(h.date)} · ${h.hrv.state}`}
            values={[
              { label: "ms", value: h.hrv.ms !== null ? String(Math.round(h.hrv.ms)) : "–" },
              { label: "7-day", value: h.hrv.mean7 !== null ? String(Math.round(h.hrv.mean7)) : "–" },
              { label: "range", value: h.hrv.bandLow !== null && h.hrv.bandHigh !== null ? `${Math.round(h.hrv.bandLow)}–${Math.round(h.hrv.bandHigh)}` : "–" },
              { label: "CV", value: h.hrv.cv7 !== null ? `${h.hrv.cv7.toFixed(1)}%` : "–" },
            ]}
          />
          <EChart option={opts.hrv} height={226} onIndex={setHi} ariaLabel="Nightly HRV with 7-day mean and normal range for 90 days." />
        </Card>
      )}

      {opts && r && (
        <Card title="Resting heart rate · 90 days" note="A 7-day mean 5 bpm or more over the 60-day baseline is a warning sign of fatigue or illness.">
          <Legend items={[{ name: "Day", color: "var(--viz-negative)", kind: "dot" }, { name: "7-day mean", color: "var(--viz-negative)", kind: "line" }, { name: "Baseline", color: "var(--muted-foreground)", kind: "line" }]} />
          <Readout
            title={`${formatDateShort(r.date)}${r.restingHr.flag ? " · raised" : ""}`}
            values={[
              { label: "bpm", value: r.restingHr.bpm !== null ? String(r.restingHr.bpm) : "–" },
              { label: "7-day", value: r.restingHr.mean7 !== null ? r.restingHr.mean7.toFixed(1) : "–" },
              { label: "baseline", value: r.restingHr.baseline !== null ? r.restingHr.baseline.toFixed(1) : "–" },
            ]}
          />
          <EChart option={opts.rhr} height={150} onIndex={setRi} ariaLabel="Resting heart rate with 7-day mean and baseline for 90 days." />
        </Card>
      )}

      {opts && x && (
        <Card title="Stress through the day · 28 days" note="Garmin's stress score from heart rate variability while you are still. Rest includes sleep.">
          <Legend items={[{ name: "Rest", color: "var(--viz-band-low)", kind: "bar" }, { name: "Low", color: "var(--viz-band-mid)", kind: "bar" }, { name: "Medium", color: "var(--viz-warning)", kind: "bar" }, { name: "High", color: "var(--viz-critical)", kind: "bar" }]} />
          <Readout
            title={formatDateShort(x.date)}
            values={[
              { label: "rest", value: `${(x.rest / 3600).toFixed(1)}h` },
              { label: "low", value: `${(x.low / 3600).toFixed(1)}h` },
              { label: "medium", value: `${(x.medium / 3600).toFixed(1)}h` },
              { label: "high", value: `${(x.high / 3600).toFixed(1)}h` },
            ]}
          />
          <EChart option={opts.stress} height={140} onIndex={setXi} ariaLabel="Daily time per stress level for 28 days." />
        </Card>
      )}
    </div>
  );
}
