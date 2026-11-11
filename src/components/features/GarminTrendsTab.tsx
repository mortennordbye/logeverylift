"use client";

import { EChart } from "@/components/charts/EChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import { Card, Legend, Readout, Stat } from "@/components/features/garmin/GarminUi";
import { THRESHOLD_DAYS, VO2_WINDOW_DAYS, criticalFit, curve, dynamicsTrend, efPoints, thresholdHistory, vo2Series } from "@/lib/garmin/analytics/trends";
import { addDays } from "@/lib/garmin/dates";
import {
  THRESHOLDS_HEIGHT,
  curveOption,
  decouplingOption,
  durationTick,
  dynamicsOption,
  efOption,
  nearest,
  paceMin,
  paceTick,
  thresholdsOption,
  vo2Option,
  weightOption,
} from "@/lib/garmin/charts/trends";
import type { TrendsData } from "@/lib/garmin/queries";
import { formatDateShort } from "@/lib/utils/format";
import { Activity, Footprints, Gauge, HeartPulse, Scale, Timer, Wind, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Trends: am I getting faster? Best-effort curves, threshold estimates over
 * time, VO2 max (Garmin's and the app's own), efficiency and decoupling,
 * run dynamics at one speed, and weight with W/kg.
 */

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

function CurveCard({
  title,
  kind,
  data,
  icon,
}: {
  title: string;
  kind: "power" | "pace";
  data: TrendsData;
  icon: typeof Zap;
}) {
  const theme = useVizTheme();
  const [at, setAt] = useState<number | null>(null);
  const sport = kind === "power" ? "bike" : "run";
  const source = kind === "power" ? "power" : "speed";
  const acts = useMemo(() => data.acts.filter((a) => a.sport === sport), [data.acts, sport]);
  const lines = useMemo(() => {
    const d42 = curve(acts, source, addDays(data.today, -41), data.today);
    const d365 = curve(acts, source, addDays(data.today, -364), data.today);
    const all = curve(acts, source, "0000-01-01", data.today);
    return { d42, d365, all };
  }, [acts, source, data.today]);
  const fit = useMemo(() => criticalFit(curve(acts, source, addDays(data.today, -(THRESHOLD_DAYS - 1)), data.today)), [acts, source, data.today]);
  const option = useMemo(
    () =>
      theme
        ? curveOption(
            [
              { name: "All time", points: lines.all, color: theme.textMuted, width: 1 },
              { name: "365 days", points: lines.d365, color: theme.sport[sport], dashed: true },
              { name: "42 days", points: lines.d42, color: theme.sport[sport], width: 2.5 },
            ],
            kind,
            theme,
            kind === "power" && fit ? { cp: fit.cp, w: fit.w } : null,
          )
        : null,
    [theme, lines, kind, sport, fit],
  );
  if (!lines.all.length) return null;
  const x = at !== null ? lines.all.reduce((b, p) => (Math.abs(Math.log(p.x) - Math.log(at)) < Math.abs(Math.log(b.x) - Math.log(at)) ? p : b), lines.all[0]).x : (lines.all.find((p) => p.x === 1200)?.x ?? lines.all.at(-1)!.x);
  const fmt = (v: number | undefined) => (v === undefined ? "–" : kind === "power" ? `${Math.round(v)}` : paceTick(paceMin(v)));
  const unit = kind === "power" ? "W" : "/km";
  const at42 = lines.d42.find((p) => p.x === x);
  const atAll = lines.all.find((p) => p.x === x);
  return (
    <Card
      icon={icon}
      title={title}
      note={
        kind === "power"
          ? `Best mean power for each duration, from rides with a power meter. Faint: all time. Dashed: 365 days. Bold: 42 days.${fit ? ` Thin grey: the critical power model, CP ${Math.round(fit.cp)} W, W′ ${Math.round(fit.w / 1000)} kJ.` : ""}`
          : "Best mean pace for each duration, outdoor runs (treadmill pace is not measured). Faster is up."
      }
    >
      <Legend
        items={[
          { name: "42 days", color: `var(--viz-${sport})`, kind: "line" },
          { name: "365 days (dashed)", color: `var(--viz-${sport})`, kind: "line" },
          { name: "All time", color: "var(--muted-foreground)", kind: "line" },
        ]}
      />
      <Readout
        title={`Best ${durationTick(x)}`}
        values={[
          { label: `${unit} · 42 days`, value: fmt(at42?.value) },
          { label: `${unit} · all time${atAll ? `, ${formatDateShort(atAll.day)}` : ""}`, value: fmt(atAll?.value) },
        ]}
      />
      {option && <EChart option={option} height={200} onIndex={setAt} ariaLabel={`${title} for durations from ${durationTick(lines.all[0].x)} to ${durationTick(lines.all.at(-1)!.x)}.`} />}
      {atAll && (
        <Link href={`/more/garmin/activity/${atAll.id}`} className="block text-[11px] text-primary active:opacity-60">
          Open the session that set the all-time best
        </Link>
      )}
    </Card>
  );
}

export function GarminTrendsTab({ data }: { data: TrendsData }) {
  const theme = useVizTheme();
  const [thIdx, setThIdx] = useState<number | null>(null);
  const [vo2At, setVo2At] = useState<number | null>(null);
  const [efSport, setEfSport] = useState<"bike" | "run">("run");
  const [efAt, setEfAt] = useState<number | null>(null);
  const [dynAt, setDynAt] = useState<number | null>(null);
  const [wAt, setWAt] = useState<number | null>(null);

  const first = data.acts[0]?.day ?? data.today;
  const weeks = useMemo(() => thresholdHistory(data.acts, addDays(data.today, -364) > first ? addDays(data.today, -364) : first, data.today), [data.acts, data.today, first]);
  const vo2 = useMemo(() => vo2Series(data.acts), [data.acts]);
  const ef = useMemo(() => efPoints(data.acts), [data.acts]);
  const dyn = useMemo(() => dynamicsTrend(data.acts), [data.acts]);
  const wkg = useMemo(
    () =>
      data.weight.length
        ? weeks.flatMap((w) => {
            const kg = [...data.weight].reverse().find((x) => x.day <= addDays(w.weekStart, 6))?.kg;
            return w.ftp && kg ? [{ day: w.weekStart, value: Math.round((w.ftp / kg) * 100) / 100 }] : [];
          })
        : [],
    [weeks, data.weight],
  );
  const opts = useMemo(
    () =>
      theme
        ? {
            th: thresholdsOption(weeks, theme),
            vo2: vo2Option(data.garminVo2, vo2.runs, vo2.trend, theme),
            ef: efOption(ef, efSport, theme),
            dec: decouplingOption(ef, theme),
            dyn: dyn ? dynamicsOption(dyn.points, theme) : null,
            weight: data.weight.length ? weightOption(data.weight, wkg, theme) : null,
          }
        : null,
    [theme, weeks, data.garminVo2, data.weight, vo2, ef, efSport, dyn, wkg],
  );

  if (!data.acts.length) return <p className="text-sm text-muted-foreground text-center py-12">No activity metrics yet. They are computed in the background as Garmin data imports.</p>;

  const last = weeks.at(-1);
  const thAt = thIdx !== null ? weeks.reduce((b, w) => (Math.abs(Date.parse(w.weekStart) - thIdx) < Math.abs(Date.parse(b.weekStart) - thIdx) ? w : b), weeks[0]) : last;
  const appVo2 = vo2.trend.at(-1);
  const garminRun = data.garminVo2.filter((g) => g.sport === "run");
  const garminBike = data.garminVo2.filter((g) => g.sport === "bike");
  const garminVo2 = garminRun.at(-1) ?? garminBike.at(-1);
  const lthrGap = last?.lthrRun && last.watchLthr ? last.lthrRun - last.watchLthr : null;
  const headline = [
    last?.ftp ? `Bike FTP about ${last.ftp} W.` : "No hard 20 minute ride with power in 90 days, so no FTP estimate.",
    last?.cs ? `Run critical speed ${paceTick(paceMin(last.cs))}/km.` : "",
    appVo2 ? `VO2 max ${appVo2.value} (app, runs to ${formatDateShort(appVo2.day)}) against ${garminRun.at(-1)?.value ?? "–"} (Garmin running).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const vo2Point = nearest(vo2.trend, vo2At);
  const garminRunAt = vo2At !== null ? nearest(garminRun, vo2At) : garminRun.at(-1);
  const garminBikeAt = vo2At !== null ? nearest(garminBike, vo2At) : garminBike.at(-1);
  const efPoint = nearest(ef.filter((p) => p.sport === efSport), efAt);
  const dynPoint = dyn ? nearest(dyn.points, dynAt) : null;
  const wPoint = nearest(data.weight, wAt);

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold leading-snug">{headline}</p>

      <div className="grid grid-cols-2 gap-2">
        <Stat icon={Zap} label="FTP estimate" value={last?.ftp ? `${last.ftp} W` : "–"} sub={last?.cp ? `CP ${Math.round(last.cp)} W` : "95 % of best 20 min, 90 days"} />
        <Stat icon={Footprints} label="Critical speed" value={last?.cs ? `${paceTick(paceMin(last.cs))}/km` : "–"} sub="from 3 to 20 min bests" />
        <Stat icon={HeartPulse} label="LTHR, run" value={last?.lthrRun ? `${last.lthrRun} bpm` : "–"} sub={last?.watchLthr ? `watch uses ${Math.round(last.watchLthr)}${lthrGap !== null ? ` (${signed(lthrGap)})` : ""}` : null} />
        <Stat icon={Wind} label="VO2 max, app" value={appVo2 ? String(appVo2.value) : "–"} sub={garminVo2 ? `Garmin ${garminRun.length ? "running" : "cycling"} ${garminVo2.value}` : "from outdoor runs"} />
      </div>

      <CurveCard title="Power curve" kind="power" data={data} icon={Zap} />
      <CurveCard title="Run pace curve" kind="pace" data={data} icon={Timer} />

      {opts && thAt && (
        <Card
          icon={Gauge}
          title="Thresholds over time"
          note={`Each week from the ${THRESHOLD_DAYS} days before it. FTP is 95 % of the best 20 min power; CP and critical speed fit the 3, 5, 12 and 20 min bests and show only with 3 or more fresh efforts. LTHR is the mean heart rate of the last 20 min of your hardest 30, counted only at 85 % of max HR or more. A gap means no effort hard enough: test again.`}
        >
          <Legend
            items={[
              { name: "FTP", color: "var(--viz-bike)", kind: "line" },
              { name: "CP (dashed)", color: "var(--viz-bike)", kind: "line" },
              { name: "Critical speed", color: "var(--viz-run)", kind: "line" },
              { name: "LTHR run / bike", color: "var(--viz-run)", kind: "line" },
              { name: "LTHR on the watch (dashed)", color: "var(--muted-foreground)", kind: "line" },
            ]}
          />
          <Readout
            title={`Week of ${formatDateShort(thAt.weekStart)}`}
            values={[
              { label: "W FTP", value: thAt.ftp ? String(thAt.ftp) : "–" },
              { label: "/km CS", value: thAt.cs ? paceTick(paceMin(thAt.cs)) : "–" },
              { label: "bpm LTHR run", value: thAt.lthrRun ? String(thAt.lthrRun) : "–" },
              { label: "bike", value: thAt.lthrBike ? String(thAt.lthrBike) : "–" },
            ]}
          />
          <EChart option={opts.th} height={THRESHOLDS_HEIGHT} onIndex={setThIdx} ariaLabel="FTP, critical speed and LTHR estimates by week." />
        </Card>
      )}

      {opts && (vo2.runs.length > 0 || data.garminVo2.length > 0) && (
        <Card
          icon={Wind}
          title="VO2 max"
          note={`The app's estimate comes from each outdoor run: oxygen cost of your pace (ACSM running equation, with the grade) divided by the share of heart-rate reserve you used, per second after a 10 min warm-up, between 50 and 95 % of reserve. Dots are single runs; the line is the median of the last ${VO2_WINDOW_DAYS} days. Garmin's values are read from your watch files: it keeps one for running and one for cycling (from power). All are estimates; compare the app with Garmin running, and watch the trend more than the number.`}
        >
          <Legend
            items={[
              { name: "App VO2 max", color: "var(--viz-run)", kind: "line" },
              { name: "One run", color: "var(--viz-run)", kind: "dot" },
              { name: "Garmin running", color: "var(--foreground)", kind: "line" },
              { name: "Garmin cycling (dashed)", color: "var(--viz-bike)", kind: "line" },
            ]}
          />
          <Readout
            title={vo2Point ? formatDateShort(vo2Point.day) : "–"}
            values={[
              { label: "app", value: vo2Point ? String(vo2Point.value) : "–" },
              { label: "Garmin running", value: garminRunAt ? String(garminRunAt.value) : "–" },
              { label: "cycling", value: garminBikeAt ? String(garminBikeAt.value) : "–" },
            ]}
          />
          <EChart option={opts.vo2} height={190} onIndex={setVo2At} ariaLabel={`VO2 max: app ${appVo2?.value ?? "none"}, Garmin ${garminVo2?.value ?? "none"}.`} />
        </Card>
      )}

      {opts && ef.length > 0 && (
        <Card
          icon={Activity}
          title="Efficiency and decoupling"
          aside={
            <span data-no-swipe className="inline-flex rounded-full bg-background p-0.5" role="group" aria-label="Sport">
              {(["run", "bike"] as const).map((s) => (
                <button key={s} onClick={() => setEfSport(s)} aria-pressed={efSport === s} className={`h-8 px-3 rounded-full text-xs font-medium active:opacity-70 ${efSport === s ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                  {s === "run" ? "Run" : "Bike"}
                </button>
              ))}
            </span>
          }
          note="Steady sessions only. Efficiency is output per heartbeat (run: m/min per bpm, bike: normalized W per bpm): rising means the same heart rate buys more speed. Below: decoupling against session length. Under the 5 % line the base holds that long."
        >
          <Readout
            title={efPoint ? formatDateShort(efPoint.day) : "No steady session for this sport"}
            values={
              efPoint
                ? [
                    { label: "efficiency", value: efPoint.ef.toFixed(2) },
                    { label: "% decoupling", value: efPoint.decoupling !== null ? String(efPoint.decoupling) : "–" },
                    { label: "min", value: String(Math.round(efPoint.durationS / 60)) },
                  ]
                : []
            }
          />
          <EChart option={opts.ef} height={150} onIndex={setEfAt} ariaLabel={`Efficiency of ${ef.filter((p) => p.sport === efSport).length} steady sessions.`} />
          <p className="text-[11px] text-muted-foreground pt-1">Decoupling against session length, both sports</p>
          <EChart option={opts.dec} height={150} ariaLabel={`Decoupling against session length for ${ef.length} steady sessions.`} />
        </Card>
      )}

      {opts?.dyn && dyn && dynPoint && (
        <Card
          icon={Footprints}
          title={`Run dynamics at ${paceTick(paceMin(dyn.speed + 0.125))}/km`}
          note="Cadence and ground contact time at one speed band (the one you run most), so a change is form, not pace. Shorter contact and higher cadence at the same speed usually mean better running economy."
        >
          <Readout
            title={formatDateShort(dynPoint.day)}
            values={[
              { label: "spm", value: dynPoint.cadence !== null ? String(Math.round(dynPoint.cadence * 2)) : "–" },
              { label: "ms contact", value: dynPoint.gct !== null ? String(Math.round(dynPoint.gct)) : "–" },
              { label: "min at this speed", value: String(Math.round(dynPoint.seconds / 60)) },
            ]}
          />
          <EChart option={opts.dyn} height={186} onIndex={setDynAt} ariaLabel={`Run cadence and ground contact time for ${dyn.points.length} runs.`} />
        </Card>
      )}

      {opts?.weight && wPoint && (
        <Card icon={Scale} title="Weight and W/kg" note="Weigh-ins from Garmin. Under it, FTP per kg: is it rising because of power or because of weight?">
          <Readout
            title={formatDateShort(wPoint.day)}
            values={[
              { label: "kg", value: wPoint.kg.toFixed(1) },
              ...(wkg.length ? [{ label: "W/kg", value: String(nearest(wkg, Date.parse(`${wPoint.day}T00:00:00Z`))?.value ?? "–") }] : []),
            ]}
          />
          <EChart option={opts.weight} height={wkg.length > 1 ? 196 : 130} onIndex={setWAt} ariaLabel={`Weight from ${data.weight.length} weigh-ins.`} />
        </Card>
      )}
    </div>
  );
}
