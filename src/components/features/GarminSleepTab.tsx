"use client";

import { EChart } from "@/components/charts/EChart";
import { Card, Legend, Readout } from "@/components/features/garmin/GarminUi";
import { useVizTheme } from "@/components/charts/viz-theme";
import {
  clockLabel,
  durationOption,
  durationRows,
  RECOVERY_STACK_HEIGHT,
  hrvOption,
  recoveryStackOption,
  restingHrOption,
  stageRows,
  stagesOption,
  stressOption,
  timingOption,
  timingRows,
} from "@/lib/garmin/charts/sleep";
import type { SleepTabData } from "@/lib/garmin/queries";
import { formatDateShort } from "@/lib/utils/format";
import { Activity, BedDouble, Brain, CalendarClock, Clock, Heart, Hourglass, Layers, Waves } from "lucide-react";
import { useMemo, useState } from "react";




const hm = (h: number | null) => (h === null ? "–" : `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`);

export function GarminSleepTab({ data }: { data: SleepTabData }) {
  const theme = useVizTheme();
  const [ti, setTi] = useState<number | null>(null);
  const [di, setDi] = useState<number | null>(null);
  const [si, setSi] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [ri, setRi] = useState<number | null>(null);
  const [xi, setXi] = useState<number | null>(null);
  const [ki, setKi] = useState<number | null>(null);

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
            stack: recoveryStackOption(data, theme),
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
          { icon: BedDouble, label: "Regularity", value: regularity != null ? String(Math.round(regularity)) : "–" },
          { icon: Clock, label: "Bedtime spread", value: latest?.timing.onsetSpread != null ? `±${Math.round(latest.timing.onsetSpread)}m` : "–" },
          { icon: CalendarClock, label: "Weekend shift", value: latest?.timing.socialJetlag != null ? `${Math.round(latest.timing.socialJetlag)}m` : "–" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl bg-muted p-3">
            <tile.icon className="h-4 w-4 text-muted-foreground mb-1" aria-hidden />
            <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            <p className="text-xl font-semibold">{tile.value}</p>
          </div>
        ))}
      </div>

      {opts && data.days.length > 0 && (
        <Card icon={Activity} title="Load and recovery · 90 days" note="Cause on top, the body's answer below, on one date axis. After a hard block, watch how many days HRV and resting HR take to come back inside their normal.">
          <Legend
            items={[
              { name: "Load", color: "var(--muted-foreground)", kind: "bar" },
              { name: "HRV 7-day, band = normal", color: "var(--viz-positive)", kind: "line" },
              { name: "Resting HR 7-day", color: "var(--viz-negative)", kind: "line" },
              { name: "Sleep debt", color: "var(--viz-other)", kind: "bar" },
            ]}
          />
          {(() => {
            const k = data.days[ki ?? data.days.length - 1];
            return (
              <Readout
                title={formatDateShort(k.date)}
                values={[
                  { label: "load", value: String(Math.round(k.load)) },
                  { label: "ms HRV", value: k.hrv.mean7 !== null ? String(Math.round(k.hrv.mean7)) : "–" },
                  { label: "bpm resting", value: k.restingHr.mean7 !== null ? String(Math.round(k.restingHr.mean7)) : "–" },
                  { label: "h debt", value: k.sleepDebtS !== null ? (k.sleepDebtS / 3600).toFixed(1) : "–" },
                ]}
              />
            );
          })()}
          <EChart option={opts.stack} height={RECOVERY_STACK_HEIGHT} onIndex={setKi} ariaLabel={`Daily load, HRV, resting heart rate and sleep debt for ${data.days.length} days.`} />
        </Card>
      )}

      {opts && t && (
        <Card icon={Clock} title="When you sleep · 28 nights" note="Bars run from falling asleep to waking. Lines: your median bedtime and wake time. Regular timing is one of the strongest sleep habits for recovery.">
          <Readout title={formatDateShort(t.date)} values={[{ label: "asleep", value: clockLabel(t.onset) }, { label: "awake", value: clockLabel(t.wake) }]} />
          <EChart option={opts.timing} height={210} onIndex={setTi} ariaLabel={`Sleep windows for ${timing.length} nights.`} />
        </Card>
      )}

      {opts && d && (
        <Card icon={Hourglass} title="Sleep against need" note="Bar: time asleep (orange when short of need). Tick: Garmin's need for that night. Below: debt over 14 nights, recent nights weighing more.">
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
        <Card icon={Layers} title="Sleep stages" note="Shares of each night. Garmin gives totals only, so there is no stage timeline to draw.">
          <Legend items={[{ name: "Deep", color: "var(--viz-band-low)", kind: "bar" }, { name: "Light", color: "var(--viz-band-mid)", kind: "bar" }, { name: "REM", color: "var(--viz-other)", kind: "bar" }, { name: "Awake", color: "var(--muted-foreground)", kind: "bar" }]} />
          <Readout title={formatDateShort(s.date)} values={[{ label: "deep", value: pct(s.deep) }, { label: "light", value: pct(s.light) }, { label: "REM", value: pct(s.rem) }, { label: "awake", value: pct(s.awake) }]} />
          <EChart option={opts.stages} height={140} onIndex={setSi} ariaLabel="Sleep stage shares per night." />
        </Card>
      )}

      {opts && h && (
        <Card icon={Waves} title="HRV · 90 days" aside={h.hrv.bandSource === "ours" ? "Band: your 60-day range" : h.hrv.bandSource === "garmin" ? "Band: Garmin's range" : undefined} note="Dots: each night. Line: 7-day mean. Grey: your normal range. Below: night-to-night variation (CV); a rising CV often comes before a drop.">
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
        <Card icon={Heart} title="Resting heart rate · 90 days" note="A 7-day mean 5 bpm or more over the 60-day baseline is a warning sign of fatigue or illness.">
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
        <Card icon={Brain} title="Stress through the day · 28 days" note="Garmin's stress score from heart rate variability while you are still. Rest includes sleep.">
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
