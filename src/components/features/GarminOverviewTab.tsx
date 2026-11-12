"use client";

import { insightHref } from "@/lib/garmin/analytics/insights";

import { Contributors, SEVERITY_COLOR, SEVERITY_ICON, SportBadge } from "@/components/features/garmin/GarminUi";
import { RACE_LABEL } from "@/lib/garmin/analytics/overview";
import { READINESS_BAND_LABEL } from "@/lib/garmin/analytics/readiness";
import { durationLabel } from "@/lib/garmin/charts/activity";
import { formBandLabel } from "@/lib/garmin/charts/load";
import { SPORT_LABEL } from "@/lib/garmin/charts/theme";
import type { OverviewData, VolumeData } from "@/lib/garmin/queries";
import { byGap } from "@/lib/garmin/analytics/demands";
import { BodyOverview } from "@/components/features/garmin/BodySignals";
import { DemandsList, WeekAgainstPlan, demandsTitle } from "@/components/features/garmin/Volume";
import { phaseLabel } from "@/lib/utils/periodization";
import { formatDateShort } from "@/lib/utils/format";
import { Activity, CalendarRange, ChevronRight, Flag, Flame, Gauge, Mountain, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * The Garmin Overview tab: the answer for the day first, then nine body
 * signals rated on published scales (garmin/BodySignals.tsx), then the build and the last session.
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

/** Intensity minutes this week (moderate + 2 × vigorous) against the goal set in Garmin, a bar per day. */
function IntensityBlock({ data }: { data: OverviewData }) {
  const w = data.intensity;
  const goal = w.goal;
  const max = Math.max(1, ...w.days.map((d) => d.moderate + 2 * d.vigorous));
  return (
    <Block href={tab("day")} label="Intensity minutes this week">
      <Heading icon={Flame} title="Intensity minutes" aside={goal ? `goal ${goal}` : "this week"} />
      <p className="text-sm tabular-nums">
        <b className="text-2xl font-semibold">{w.minutes}</b>
        {goal ? <span className="text-muted-foreground"> / {goal} min · {w.minutes >= goal ? "goal met" : `${goal - w.minutes} to go`}</span> : <span className="text-muted-foreground"> min</span>}
      </p>
      {goal && (
        <div className="mt-2 h-2 rounded-full bg-background overflow-hidden" role="img" aria-label={`${w.minutes} of ${goal} intensity minutes`}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (w.minutes / goal) * 100)}%`, background: w.minutes >= goal ? "var(--viz-good)" : "var(--viz-bike)" }} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-7 gap-1.5 items-end" aria-hidden>
        {w.days.map((d, i) => (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <div className="flex h-10 w-full flex-col justify-end overflow-hidden rounded-sm bg-background">
              <div style={{ height: `${((2 * d.vigorous) / max) * 100}%`, background: "var(--viz-bike)" }} />
              <div style={{ height: `${(d.moderate / max) * 100}%`, background: "var(--viz-strength)" }} />
            </div>
            <span className="text-[9px] text-muted-foreground">{"MTWTFSS"[i]}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-sm align-middle mr-1" style={{ background: "var(--viz-strength)" }} />
        Moderate
        <span className="inline-block h-2 w-2 rounded-sm align-middle mx-1 ml-3" style={{ background: "var(--viz-bike)" }} />
        Vigorous, counts twice
      </p>
    </Block>
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
      <BodyOverview data={data} />
      <FitnessBlock data={data} />
      <WeekBlock volume={volume} />
      <IntensityBlock data={data} />
      <DemandsBlock volume={volume} />
      <LastSession data={data} />
    </div>
  );
}
