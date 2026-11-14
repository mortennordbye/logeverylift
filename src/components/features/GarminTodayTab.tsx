"use client";

import { insightHref } from "@/lib/garmin/analytics/insights";

import { EChart } from "@/components/charts/EChart";
import { Card, Contributors, Readout, SEVERITY_COLOR, SEVERITY_ICON, SPORT_ICON } from "@/components/features/garmin/GarminUi";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import type { Severity } from "@/lib/garmin/analytics/insights";
import { CONTRIBUTOR_LABEL, READINESS_BAND_LABEL } from "@/lib/garmin/analytics/readiness";
import { SPORT_LABEL, type VizTheme } from "@/lib/garmin/charts/theme";
import { addDays } from "@/lib/garmin/dates";
import { bodyBatteryOption } from "@/lib/garmin/charts/body";
import { garminPhrase } from "@/lib/garmin/analytics/overview";
import type { TodayData } from "@/lib/garmin/queries";
import { formatDateShort } from "@/lib/utils/format";
import { AlertTriangle, BatteryMedium, BatteryCharging, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Flame, Footprints, Gauge, HeartPulse, Info, ShieldAlert, Sun, Timer, Waves, Wind, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { dateLabel } from "@/lib/utils/date-label";


function alpha(rgba: string, a: number) {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : rgba;
}

function clock(ms: number) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function hm(seconds: number | null) {
  if (seconds === null) return "–";
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}



/** A thin segmented bar: one whole split into parts, with a legend that names them. */
function Segmented({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)} %`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <span className="text-foreground tabular-nums">{Math.round((p.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DayPicker({ data }: { data: TodayData }) {
  const prev = addDays(data.date, -1);
  const next = addDays(data.date, 1);
  const canPrev = !data.firstDate || prev >= data.firstDate;
  const canNext = !!data.lastDate && next <= data.lastDate;
  const btn = "h-11 w-11 flex items-center justify-center rounded-xl bg-muted active:opacity-60";
  return (
    <div className="flex items-center justify-between gap-2">
      {canPrev ? (
        <Link href={`/more/garmin?tab=day&date=${prev}`} replace scroll={false} aria-label="Previous day" className={btn}>
          <ChevronLeft className="w-5 h-5" />
        </Link>
      ) : (
        <span className={`${btn} opacity-30`} />
      )}
      <div className="text-center">
        <p className="text-sm font-semibold">{dateLabel(data.date, "EEEE d MMMM")}</p>
        {data.lastDate && data.date !== data.lastDate && (
          <Link href="/more/garmin?tab=day" replace scroll={false} className="text-[11px] text-primary">
            Latest day
          </Link>
        )}
      </div>
      {canNext ? (
        <Link href={`/more/garmin?tab=day&date=${next}`} replace scroll={false} aria-label="Next day" className={btn}>
          <ChevronRight className="w-5 h-5" />
        </Link>
      ) : (
        <span className={`${btn} opacity-30`} />
      )}
    </div>
  );
}

export function ReadinessCard({ data }: { data: Pick<TodayData, "metrics"> }) {
  const r = data.metrics?.readiness;
  if (!r) {
    return (
      <Card icon={Gauge} title="Readiness">
        <p className="text-sm text-muted-foreground">Not enough signals for this day yet. Readiness needs at least 3 of HRV, resting HR, sleep, sleep debt, form and how you feel.</p>
      </Card>
    );
  }
  return (
    <Card icon={Gauge} title="Readiness" aside={`${r.signals} of 6 signals${r.capped ? " · capped" : ""}`}>
      <div className="flex items-end gap-3">
        <span className="text-6xl font-semibold leading-none">{r.score}</span>
        <span className="pb-1.5 text-base font-semibold">{READINESS_BAND_LABEL[r.band]}</span>
      </div>
      <Contributors readiness={r} />
    </Card>
  );
}

function Insights({ data }: { data: TodayData }) {
  const [all, setAll] = useState(false);
  if (!data.insights.length) return null;
  const shown = all ? data.insights : data.insights.slice(0, 3);
  return (
    <div className="space-y-2">
      {shown.map((i) => {
        const Icon = SEVERITY_ICON[i.severity];
        return (
          <Link key={i.id} href={insightHref(i)} className="flex gap-3 rounded-2xl bg-muted p-3.5 active:opacity-70">
            <Icon className="w-5 h-5 flex-none mt-0.5" style={{ color: SEVERITY_COLOR[i.severity] }} aria-label={i.severity} />
            <p className="text-sm leading-snug">{i.text}</p>
          </Link>
        );
      })}
      {data.insights.length > 3 && (
        <button onClick={() => setAll(!all)} className="h-11 w-full text-sm text-primary active:opacity-60">
          {all ? "Show fewer" : `${data.insights.length - 3} more`}
        </button>
      )}
    </div>
  );
}

function Timeline({ data, theme }: { data: TodayData; theme: VizTheme }) {
  const [idx, setIdx] = useState<number | null>(null);
  const ranges = useMemo(
    () => [
      ...(data.sleep ? [{ from: data.sleep.start, to: data.sleep.end, color: alpha(theme.positive, 0.14) }] : []),
      ...data.activities.map((a) => ({ from: a.start, to: a.end, color: alpha(theme.sport[a.sport], 0.22) })),
      ...data.activities.map((a) => ({ from: a.start, to: a.end, color: theme.sport[a.sport], lane: "bottom" as const })),
    ],
    [data, theme],
  );
  const series = useMemo(() => [{ label: "Heart rate", values: data.hr.bpm, color: theme.text, width: 1.25 }], [data, theme]);
  if (data.hr.t.length < 10) return <Card icon={HeartPulse} title="Heart rate · day and night"><p className="text-sm text-muted-foreground">No all-day heart rate for this day.</p></Card>;

  const i = idx ?? data.hr.bpm.findLastIndex((v) => v !== null);
  const t = data.hr.t[i];
  const during = data.activities.find((a) => t >= a.start && t <= a.end);
  const asleep = data.sleep && t >= data.sleep.start && t <= data.sleep.end;
  const bpms = data.hr.bpm.filter((v): v is number => v !== null);

  return (
    <Card icon={HeartPulse} title="Heart rate · evening before to midnight" note="Shaded: sleep. Coloured lane and wash: activities. Line: resting heart rate.">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-3.5 bg-foreground" />Heart rate</span>
        {data.sleep && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: alpha(theme.positive, 0.4) }} />Sleep</span>}
        {[...new Set(data.activities.map((a) => a.sport))].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: theme.sport[s] }} />{(() => { const Icon = SPORT_ICON[s]; return <Icon className="h-3 w-3 text-foreground" aria-hidden />; })()}{SPORT_LABEL[s]}</span>
        ))}
      </div>
      <Readout
        title={`${clock(t)}${asleep ? " · asleep" : ""}${during ? ` · ${during.name}` : ""}`}
        values={[
          { label: "bpm", value: data.hr.bpm[i] !== null ? String(data.hr.bpm[i]) : "–" },
          { label: "resting", value: data.restingHr ? String(data.restingHr) : "–" },
          { label: "day max", value: String(Math.max(...bpms)) },
        ]}
      />
      <TimeSeriesChart
        x={data.hr.t}
        series={series}
        ranges={ranges}
        lines={data.restingHr ? [{ y: data.restingHr, color: alpha(theme.textMuted, 0.8) }] : []}
        xRange={data.window}
        height={210}
        axisColor={theme.textMuted}
        gridColor={theme.grid}
        onIndex={setIdx}
        ariaLabel={`Heart rate from ${clock(data.window[0])} the evening before to midnight. Resting ${data.restingHr ?? "unknown"} bpm, max ${Math.max(...bpms)} bpm.`}
      />
      {data.spo2.t.length > 2 && (
        <>
          <p className="text-[11px] text-muted-foreground pt-1">Blood oxygen (SpO2), hourly average, %</p>
          <TimeSeriesChart
            x={data.spo2.t}
            series={[{ label: "SpO2", values: data.spo2.value, color: theme.sport.swim, width: 1.5, points: true }]}
            ranges={data.sleep ? [{ from: data.sleep.start, to: data.sleep.end, color: alpha(theme.positive, 0.14) }] : []}
            xRange={data.window}
            yRange={[85, 100]}
            height={90}
            axisColor={theme.textMuted}
            gridColor={theme.grid}
            ariaLabel={`Hourly SpO2 between ${Math.min(...data.spo2.value)} and ${Math.max(...data.spo2.value)} %.`}
          />
        </>
      )}
    </Card>
  );
}

function OvernightHrv({ data, theme }: { data: TodayData; theme: VizTheme }) {
  const [idx, setIdx] = useState<number | null>(null);
  const series = useMemo(() => [{ label: "HRV", values: data.hrvNight.ms, color: theme.positive, width: 1.5, points: true }], [data, theme]);
  if (data.hrvNight.t.length < 6) return null;
  const h = data.metrics?.hrv;
  const half = Math.floor(data.hrvNight.ms.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = mean(data.hrvNight.ms.slice(0, half));
  const second = mean(data.hrvNight.ms.slice(half));
  const i = idx ?? data.hrvNight.t.length - 1;
  const rising = second > first * 1.05;
  return (
    <Card
      icon={Waves} title="HRV through the night"
      aside={h?.state && h.state !== "calibrating" ? `Week: ${h.state}` : undefined}
      note={`Each dot is a 5-minute reading. ${rising ? "HRV rose through the night: recovery went well." : second < first * 0.95 ? "HRV fell in the second half: a late session, meal or alcohol often does this." : "HRV was flat through the night."}`}
    >
      <Readout
        title={clock(data.hrvNight.t[i])}
        values={[
          { label: "ms now", value: String(data.hrvNight.ms[i]) },
          { label: "first half", value: String(Math.round(first)) },
          { label: "second half", value: String(Math.round(second)) },
          ...(h?.bandLow && h.bandHigh ? [{ label: "normal", value: `${Math.round(h.bandLow)}–${Math.round(h.bandHigh)}` }] : []),
        ]}
      />
      <TimeSeriesChart
        x={data.hrvNight.t}
        series={series}
        band={h?.bandLow && h.bandHigh ? { from: h.bandLow, to: h.bandHigh, color: alpha(theme.textMuted, 0.18) } : undefined}
        height={150}
        axisColor={theme.textMuted}
        gridColor={theme.grid}
        onIndex={setIdx}
        ariaLabel={`Overnight HRV, first half mean ${Math.round(first)} ms, second half ${Math.round(second)} ms.`}
      />
    </Card>
  );
}

function WeekStrip({ data, theme }: { data: TodayData; theme: VizTheme }) {
  const [idx, setIdx] = useState<number | null>(null);
  const option = useMemo(() => {
    const ax = { axisLine: { lineStyle: { color: theme.grid } }, axisTick: { show: false }, axisLabel: { color: theme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: theme.grid } } };
    const labels = data.strip.map((d) => dateLabel(d.date, "EEE"));
    return {
      animationDuration: 300,
      tooltip: { trigger: "axis", showContent: false, axisPointer: { type: "line", lineStyle: { color: theme.textMuted } } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { top: 8, height: 60, left: 30, right: 8 },
        { top: 86, height: 44, left: 30, right: 8 },
      ],
      xAxis: [
        { type: "category", data: labels, gridIndex: 0, ...ax, axisLabel: { show: false } },
        { type: "category", data: labels, gridIndex: 1, ...ax },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, min: 0, max: 100, splitNumber: 2, ...ax },
        { type: "value", gridIndex: 1, min: 0, splitNumber: 1, ...ax },
      ],
      series: [
        {
          name: "Readiness",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: data.strip.map((d) => d.readiness),
          connectNulls: false,
          symbolSize: 9,
          lineStyle: { width: 1.5, color: theme.positive },
          itemStyle: { color: theme.positive, borderColor: theme.surface, borderWidth: 2 },
        },
        { name: "Load", type: "bar", xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 18, data: data.strip.map((d) => d.load), itemStyle: { color: theme.textMuted, borderRadius: [3, 3, 0, 0] } },
      ],
    };
  }, [data, theme]);
  const d = data.strip[idx ?? 6];
  return (
    <Card icon={CalendarDays} title="Last 7 days">
      <Readout title={formatDateShort(d.date)} values={[{ label: "readiness", value: d.readiness !== null ? String(d.readiness) : "–" }, { label: "load", value: String(d.load) }]} />
      <EChart option={option} height={146} onIndex={setIdx} ariaLabel={`Readiness and load for the 7 days to ${data.date}.`} />
    </Card>
  );
}

function DayNumbers({ data, theme }: { data: TodayData; theme: VizTheme }) {
  const s = data.summary;
  const tiles = [
    { icon: Footprints, label: "Steps", value: s.steps !== null ? s.steps.toLocaleString("en-GB") : "–" },
    { icon: Flame, label: "Active kcal", value: s.activeKcal !== null ? String(Math.round(s.activeKcal)) : "–" },
    { icon: Timer, label: "Intensity min", value: s.intensityMin !== null ? String(s.intensityMin) : "–" },
    { icon: BatteryCharging, label: "Body battery at wake", value: s.bbAtWake !== null ? String(s.bbAtWake) : "–" },
    { icon: Zap, label: "Charged / drained", value: s.bbCharged !== null ? `+${s.bbCharged} / −${s.bbDrained ?? 0}` : "–" },
    { icon: Wind, label: "Breathing (awake)", value: s.respiration !== null ? `${Math.round(s.respiration)}/min` : "–" },
  ];
  return (
    <Card icon={Sun} title="The day">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-background p-2.5">
            <t.icon className="h-4 w-4 text-muted-foreground mb-1" aria-hidden />
            <p className="text-[10px] text-muted-foreground leading-tight">{t.label}</p>
            <p className="text-base font-semibold">{t.value}</p>
          </div>
        ))}
      </div>
      {s.stress && (
        <div className="pt-2 space-y-1">
          <p className="text-[11px] text-muted-foreground">Stress{s.stressAvg !== null ? ` · average ${s.stressAvg}` : ""}</p>
          <Segmented
            parts={[
              { label: "Rest", value: s.stress.rest, color: theme.band.low },
              { label: "Low", value: s.stress.low, color: theme.band.mid },
              { label: "Medium", value: s.stress.medium, color: theme.status.warning },
              { label: "High", value: s.stress.high, color: theme.status.critical },
            ]}
          />
        </div>
      )}
      {data.sleep && (
        <div className="pt-2 space-y-1">
          <p className="text-[11px] text-muted-foreground">
            Sleep {clock(data.sleep.start)}–{clock(data.sleep.end)} · {hm(data.sleep.seconds)}
            {data.sleep.needS ? ` of ${hm(data.sleep.needS)} needed` : ""}
            {data.sleep.score !== null ? ` · score ${data.sleep.score}` : ""}
          </p>
          <Segmented
            parts={[
              { label: "Deep", value: data.sleep.deep ?? 0, color: theme.band.low },
              { label: "Light", value: data.sleep.light ?? 0, color: theme.band.mid },
              { label: "REM", value: data.sleep.rem ?? 0, color: theme.sport.other },
              { label: "Awake", value: data.sleep.awake ?? 0, color: theme.textMuted },
            ]}
          />
        </div>
      )}
    </Card>
  );
}

const BB_EVENT: Record<string, string> = { SLEEP: "Sleep", ACTIVITY: "Activity", NAP: "Nap", RECOVERY: "Rest", STRESS: "Stress" };

/** Garmin's body battery for the day: its key levels and what moved them. */
function BodyBattery({ data, theme }: { data: TodayData; theme: VizTheme }) {
  const bb = data.bodyBattery;
  const [at, setAt] = useState<number | null>(null);
  const color = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue("--viz-strength").trim() || theme.text, [theme]);
  const option = useMemo(() => (bb ? bodyBatteryOption(bb.points, data.window, color, theme) : null), [bb, data.window, color, theme]);
  if (!bb || !option) return null;
  const point = at === null ? bb.points.at(-1)! : bb.points.reduce((a, b) => (Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a));
  return (
    <Card icon={BatteryMedium} title="Body battery" note="Garmin sends a few key levels a day, not a full curve; the line joins them. Below: what charged or drained it.">
      <Readout title={`${clock(point.t)}${at === null ? " · drag the chart to read a point" : ""}`} values={[{ label: "of 100", value: String(point.level) }]} />
      <EChart option={option} height={150} onIndex={setAt} ariaLabel={`Body battery from ${bb.points[0].level} to ${bb.points.at(-1)!.level} over the day.`} />
      {bb.events.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {bb.events.map((e) => (
            <li key={`${e.type}-${e.start}`} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block">
                  {BB_EVENT[e.type] ?? garminPhrase(e.type)?.text ?? e.type} <span className="text-muted-foreground tabular-nums">· {clock(e.start)} · {hm(e.minutes * 60)}</span>
                </span>
                {e.feedback && <span className="block text-[11px] text-muted-foreground">{garminPhrase(e.feedback)?.text}</span>}
              </span>
              <span className="font-semibold tabular-nums" style={{ color: e.impact >= 0 ? "var(--viz-good)" : "var(--viz-serious)" }}>
                {e.impact > 0 ? "+" : ""}
                {e.impact}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** On the newest day the full readiness card lives on Overview; this links to it. */
function ReadinessLink({ data }: { data: TodayData }) {
  const r = data.metrics?.readiness;
  return (
    <Link href="/more/garmin?tab=overview" replace scroll={false} className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-3.5 active:opacity-70">
      <span className="flex items-center gap-2 text-sm">
        <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
        {r ? (
          <>
            Readiness <b className="tabular-nums">{r.score}</b> · {READINESS_BAND_LABEL[r.band]}
          </>
        ) : (
          "Readiness: not enough signals yet"
        )}
      </span>
      <span className="flex items-center text-xs text-primary">
        Overview <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}

export function GarminTodayTab({ data, isLatest }: { data: TodayData; isLatest: boolean }) {
  const theme = useVizTheme();
  return (
    <div className="space-y-4">
      <DayPicker data={data} />
      {isLatest ? <ReadinessLink data={data} /> : <ReadinessCard data={data} />}
      <Insights data={data} />
      {theme && <Timeline data={data} theme={theme} />}
      {theme && <BodyBattery data={data} theme={theme} />}
      {theme && <OvernightHrv data={data} theme={theme} />}
      {theme && <WeekStrip data={data} theme={theme} />}
      {theme && <DayNumbers data={data} theme={theme} />}
    </div>
  );
}
