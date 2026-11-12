"use client";

import { insightHref } from "@/lib/garmin/analytics/insights";

import { Contributors, SEVERITY_COLOR, SEVERITY_ICON, SportBadge } from "@/components/features/garmin/GarminUi";
import { RACE_LABEL, type BodySignal } from "@/lib/garmin/analytics/overview";
import { READINESS_BAND_LABEL } from "@/lib/garmin/analytics/readiness";
import { durationLabel } from "@/lib/garmin/charts/activity";
import { formBandLabel } from "@/lib/garmin/charts/load";
import { SPORT_LABEL } from "@/lib/garmin/charts/theme";
import type { BodyKey, OverviewData, VolumeData } from "@/lib/garmin/queries";
import { byGap } from "@/lib/garmin/analytics/demands";
import { DemandsList, WeekAgainstPlan, demandsTitle } from "@/components/features/garmin/Volume";
import { phaseLabel } from "@/lib/utils/periodization";
import { formatDateShort } from "@/lib/utils/format";
import { Activity, BatteryMedium, CalendarRange, ChevronRight, Flag, Gauge, Heart, HeartPulse, Moon, Mountain, Scale, TrendingUp, Wind, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * The Garmin Overview tab: the answer for the day first, then six body
 * signals against your own normal, then the build and the last session.
 * Every block opens the tab that holds its detail.
 */

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;
const tab = (t: string) => `/more/garmin?tab=${t}`;

function Block({ href, children, label }: { href: string; children: React.ReactNode; label: string }) {
  return (
    <Link href={href} replace={href.startsWith("/more/garmin?")} scroll={false} aria-label={label} className="block rounded-2xl bg-muted p-4 active:opacity-70">
      {children}
    </Link>
  );
}

function Heading({ icon: Icon, title, aside }: { icon: typeof Gauge; title: string; aside?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-background">
          <Icon className="h-3.5 w-3.5 text-foreground" aria-hidden />
        </span>
        {title}
      </h2>
      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
        {aside}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </div>
  );
}

function RaceStrip({ data }: { data: OverviewData }) {
  const r = data.race;
  if (!r) {
    return (
      <Block href="/cycles" label="Training cycles">
        <div className="flex items-center gap-3">
          <Flag className="h-5 w-5 text-muted-foreground flex-none" aria-hidden />
          <p className="text-sm flex-1">No active training cycle. Start one and set its race date to count down to race day.</p>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </Block>
    );
  }
  const phase = r.phase ? `${phaseLabel(r.phase)}${r.isDeload ? " (recovery week)" : ""}` : "Not started";
  return (
    <Block href={r.raceSet ? "/more/garmin/race" : `/cycles/${data.cycleId}/edit#race`} label={r.raceSet ? "Race page" : "Set the race date"}>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-background">
          <span className="text-lg font-semibold leading-none tabular-nums">{Math.max(0, r.daysToRace)}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">days</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {r.raceSet ? `${r.distance ? RACE_LABEL[r.distance] : "Race"} on ${formatDateShort(r.raceDay)}` : `${r.cycleName} ends ${formatDateShort(r.raceDay)}`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {phase}
            {r.week ? ` · week ${r.week}` : ""}
            {r.raceSet ? "" : " · tap to set the race date"}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
    </Block>
  );
}

function ReadinessBlock({ data }: { data: OverviewData }) {
  const [open, setOpen] = useState(false);
  const r = data.readiness;
  const top = data.insights[0];
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-3" aria-label="Readiness">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readiness · {formatDateShort(data.date)}</p>
          {r ? (
            <div className="flex items-end gap-3 pt-1">
              <span className="text-5xl font-semibold leading-none tabular-nums">{r.score}</span>
              <span className="pb-1 text-base font-semibold">{READINESS_BAND_LABEL[r.band]}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground pt-1">Not enough signals yet. Readiness needs 3 of HRV, resting HR, sleep, sleep debt, form and how you feel.</p>
          )}
        </div>
        <WeekDots strip={data.strip} />
      </div>
      {top && (
        <Link href={insightHref(top)} replace scroll={false} className="flex gap-2.5 rounded-xl bg-background p-3 active:opacity-70">
          {(() => {
            const Icon = SEVERITY_ICON[top.severity];
            return <Icon className="w-4 h-4 flex-none mt-0.5" style={{ color: SEVERITY_COLOR[top.severity] }} aria-label={top.severity} />;
          })()}
          <span className="text-sm leading-snug">{top.text}</span>
        </Link>
      )}
      {r && (
        <>
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="h-11 -my-2 text-sm text-primary active:opacity-60">
            {open ? "Hide what makes the score" : `What makes the score (${r.signals} of 6 signals)`}
          </button>
          {open && <Contributors readiness={r} />}
        </>
      )}
    </section>
  );
}

/** Readiness for the last 7 days as dots on a 0 to 100 scale; an empty ring is a day with no score. */
function WeekDots({ strip }: { strip: OverviewData["strip"] }) {
  const w = 112;
  const h = 40;
  const x = (i: number) => 6 + (i * (w - 12)) / (strip.length - 1);
  const y = (v: number) => h - 4 - (v / 100) * (h - 8);
  const pts = strip.map((d, i) => (d.readiness !== null ? `${x(i)},${y(d.readiness)}` : null));
  const label = strip.map((d) => `${d.date.slice(5)} ${d.readiness ?? "none"}`).join(", ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Readiness, last 7 days: ${label}`} className="flex-none">
      <line x1={0} x2={w} y1={y(50)} y2={y(50)} stroke="var(--border)" strokeDasharray="2 3" />
      <polyline points={pts.filter(Boolean).join(" ")} fill="none" stroke="var(--viz-positive)" strokeWidth={1.5} />
      {strip.map((d, i) =>
        d.readiness !== null ? (
          <circle key={d.date} cx={x(i)} cy={y(d.readiness)} r={i === strip.length - 1 ? 4 : 2.5} fill="var(--viz-positive)" />
        ) : (
          <circle key={d.date} cx={x(i)} cy={h / 2} r={2.5} fill="none" stroke="var(--muted-foreground)" />
        ),
      )}
    </svg>
  );
}

type BodyConfig = { label: string; unit: string; format: (v: number) => string; href: string; higherIsGood: boolean | null; icon: LucideIcon; color: string };

const BODY: Record<BodyKey, BodyConfig> = {
  sleep: { label: "Sleep", unit: "h", format: (v) => v.toFixed(1), href: tab("recovery"), higherIsGood: true, icon: Moon, color: "var(--viz-swim)" },
  hrv: { label: "HRV", unit: "ms", format: (v) => String(Math.round(v)), href: tab("recovery"), higherIsGood: true, icon: HeartPulse, color: "var(--viz-run)" },
  restingHr: { label: "Resting HR", unit: "bpm", format: (v) => String(Math.round(v)), href: tab("recovery"), higherIsGood: false, icon: Heart, color: "var(--viz-negative)" },
  vo2max: { label: "VO2 max", unit: "", format: (v) => v.toFixed(1), href: tab("trends"), higherIsGood: true, icon: Wind, color: "var(--viz-bike)" },
  bodyBattery: { label: "Body battery", unit: "", format: (v) => String(Math.round(v)), href: tab("day"), higherIsGood: true, icon: BatteryMedium, color: "var(--viz-strength)" },
  weight: { label: "Weight", unit: "kg", format: (v) => v.toFixed(1), href: tab("trends"), higherIsGood: null, icon: Scale, color: "var(--viz-other)" },
};

function stateText(s: BodySignal, good: boolean | null) {
  if (s.value === null) return "No recent value";
  if (!s.normal) return "Learning your normal";
  if (s.state === "within") return "In your normal";
  const word = s.state === "below" ? "Below" : "Above";
  if (good === null) return `${word} your normal`;
  return `${word} normal`;
}

function stateColor(s: BodySignal, good: boolean | null) {
  if (s.state === null || s.state === "within" || good === null) return "var(--muted-foreground)";
  const isGood = (s.state === "above") === good;
  return isGood ? "var(--viz-good)" : "var(--viz-warning)";
}

/** The tile's line over its window, with your normal as a band. */
function Spark({ s, color }: { s: BodySignal; color: string }) {
  const w = 100;
  const h = 28;
  if (s.points.length < 2) return <div style={{ height: h }} />;
  const values = s.points.map((p) => p.value);
  const lo = Math.min(...values, ...(s.normal ? [s.normal[0]] : []));
  const hi = Math.max(...values, ...(s.normal ? [s.normal[1]] : []));
  const span = hi - lo || 1;
  const t0 = Date.parse(s.points[0].date);
  const t1 = Date.parse(s.points.at(-1)!.date);
  const x = (d: string) => (t1 === t0 ? w : ((Date.parse(d) - t0) / (t1 - t0)) * w);
  const y = (v: number) => h - 2 - ((v - lo) / span) * (h - 4);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
      {s.normal && <rect x={0} width={w} y={y(s.normal[1])} height={Math.max(1, y(s.normal[0]) - y(s.normal[1]))} fill={color} opacity={0.18} />}
      <polyline points={s.points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BodyTile({ k, s, vo2Sport }: { k: BodyKey; s: BodySignal; vo2Sport: "run" | "bike" }) {
  const c = BODY[k];
  const Icon = c.icon;
  return (
    <Link href={c.href} replace scroll={false} className="rounded-xl bg-background p-2.5 active:opacity-70 flex flex-col gap-1 min-h-[104px]">
      <div className="flex items-start gap-1.5">
        <span aria-hidden className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${c.color} 20%, transparent)`, color: c.color }}>
          <Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <p className="text-[11px] text-muted-foreground leading-tight pt-0.5">
          {c.label}
          {k === "vo2max" && <span className="block text-[9px]">Garmin, {vo2Sport === "run" ? "running" : "cycling"}</span>}
        </p>
      </div>
      <p className="text-lg font-semibold leading-tight tabular-nums">
        {s.value !== null ? c.format(s.value) : "–"}
        {s.value !== null && c.unit && <span className="text-[11px] font-normal text-muted-foreground"> {c.unit}</span>}
      </p>
      <Spark s={s} color={c.color} />
      <p className="text-[10px] leading-tight" style={{ color: stateColor(s, c.higherIsGood) }}>
        {stateText(s, c.higherIsGood)}
      </p>
    </Link>
  );
}

function FitnessBlock({ data }: { data: OverviewData }) {
  const p = data.pmc;
  const n = p.dates.length;
  if (!n) return null;
  const w = 300;
  const h = 64;
  const max = Math.max(...p.ctl, ...p.atl, 1);
  const x = (i: number) => (n === 1 ? w : (i / (n - 1)) * w);
  const y = (v: number) => h - 2 - (v / max) * (h - 6);
  const line = (vs: number[]) => vs.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = n - 1;
  const ramp = p.ctl[last] - p.ctl[Math.max(0, last - 7)];
  return (
    <Block href={tab("training")} label="Fitness, fatigue and form">
      <Heading icon={TrendingUp} title="Fitness, fatigue, form" aside={p.calibrating ? "Calibrating" : "6 weeks"} />
      <div className="flex gap-4 text-xs text-muted-foreground tabular-nums">
        <span>
          <b className="text-base text-foreground">{Math.round(p.ctl[last])}</b> fitness
        </span>
        <span>
          <b className="text-base text-foreground">{Math.round(p.atl[last])}</b> fatigue
        </span>
        <span>
          <b className="text-base text-foreground">{signed(p.tsb[last])}</b> form · {formBandLabel(p.tsb[last]).toLowerCase()}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full mt-2" style={{ height: h }} role="img" aria-label={`Fitness ${Math.round(p.ctl[last])}, ${signed(ramp)} in 7 days.`}>
        <polyline points={line(p.atl)} fill="none" stroke="var(--viz-bike)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <polyline points={line(p.ctl)} fill="none" stroke="var(--viz-positive)" strokeWidth={2.25} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-[11px] text-muted-foreground">
        <span className="inline-block h-0.5 w-3 align-middle mr-1" style={{ background: "var(--viz-positive)" }} />
        Fitness, {signed(ramp)} in 7 days
        <span className="inline-block h-0.5 w-3 align-middle mx-1 ml-3" style={{ background: "var(--viz-bike)" }} />
        Fatigue
      </p>
    </Block>
  );
}

function LastSession({ data }: { data: OverviewData }) {
  const a = data.last;
  if (!a) return null;
  const hr = a.hrPreview.filter((v): v is number => v !== null);
  const dec = a.decoupling?.valid ? `Decoupling ${Math.round(a.decoupling.pct * 10) / 10} %` : null;
  const lo = Math.min(...hr);
  const hi = Math.max(...hr);
  const path = a.hrPreview.map((v, i) => (v === null ? null : `${(i / Math.max(1, a.hrPreview.length - 1)) * 100},${26 - ((v - lo) / (hi - lo || 1)) * 24}`)).filter(Boolean);
  return (
    <Block href={`/more/garmin/activity/${a.id}`} label={`Last session: ${a.name}`}>
      <Heading icon={Activity} title="Last session" aside={formatDateShort(new Date(a.start).toISOString().slice(0, 10))} />
      <p className="text-sm font-semibold flex items-center gap-2">
        <SportBadge sport={a.sport} />
        <span className="truncate">{a.name}</span>
      </p>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {SPORT_LABEL[a.sport]} · {durationLabel(a.durationS)}
        {a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(1)} km` : ""}
        {a.load !== null ? ` · load ${Math.round(a.load)}` : ""}
        {a.avgHr ? ` · ${Math.round(a.avgHr)} bpm avg` : ""}
        {dec ? ` · ${dec}` : ""}
      </p>
      {path.length > 1 && (
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full mt-2" style={{ height: 28 }} aria-hidden>
          <polyline points={path.join(" ")} fill="none" stroke="var(--viz-critical)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </Block>
  );
}

function WeekBlock({ volume }: { volume: VolumeData }) {
  const week = volume.weeks.at(-1);
  if (!week) return null;
  return (
    <Block href={tab("training")} label="This week against the plan">
      <Heading icon={CalendarRange} title="This week" aside={volume.planned ? "done / plan" : "no plan on the cycle"} />
      <WeekAgainstPlan week={week} planned={volume.planned} />
    </Block>
  );
}

function DemandsBlock({ volume }: { volume: VolumeData }) {
  return (
    <Block href={tab("training")} label="Race demands">
      <Heading icon={Mountain} title={demandsTitle(volume)} aside="largest gap first" />
      <DemandsList rows={byGap(volume.checklist).slice(0, 3)} compact />
    </Block>
  );
}

export function GarminOverviewTab({ data, volume }: { data: OverviewData; volume: VolumeData }) {
  return (
    <div className="space-y-4">
      <RaceStrip data={data} />
      <ReadinessBlock data={data} />
      <section aria-label="Body signals" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Body · against your normal</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(BODY) as BodyKey[]).map((k) => (
            <BodyTile key={k} k={k} s={data.body[k]} vo2Sport={data.vo2Sport} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground px-1">
          The band is your normal: mean ± 1 SD of the 28 days before (HRV: its own baseline band). VO2 max is Garmin&apos;s value from your watch files; Trends shows the app&apos;s own estimate next to it.
        </p>
      </section>
      <FitnessBlock data={data} />
      <WeekBlock volume={volume} />
      <DemandsBlock volume={volume} />
      <LastSession data={data} />
    </div>
  );
}
