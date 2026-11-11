"use client";

import { getGarminMetrics, type GarminSyncRunView, type GarminTabData } from "@/lib/actions/garmin";
import type { GarminDayView } from "@/lib/garmin/metrics";
import { formatDateShort, formatDistanceKm, formatDuration } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const CHART_DAYS = 28;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-3">{children}</h2>;
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>{title}</SectionLabel>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function hm(seconds: number | null) {
  if (seconds === null) return "–";
  return formatDuration(Math.round(seconds / 60));
}

function avg(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return formatDateShort(iso.slice(0, 10));
}

/** One bar per day; a null value leaves a gap. Segments stack bottom up. */
function DayBars({
  days,
  segments,
  label,
}: {
  days: GarminDayView[];
  segments: { value: (d: GarminDayView) => number | null; className: (d: GarminDayView) => string }[];
  label: string;
}) {
  const totals = days.map((d) => segments.reduce((s, seg) => s + (seg.value(d) ?? 0), 0));
  const max = Math.max(...totals, 1);
  return (
    <div>
      <div className="flex items-end gap-[2px] h-16" role="img" aria-label={label}>
        {days.map((d, i) => (
          <div key={d.date} className="flex-1 h-full flex flex-col-reverse" title={formatDateShort(d.date)}>
            {totals[i] > 0 &&
              segments.map((seg, j) => {
                const v = seg.value(d) ?? 0;
                return v > 0 ? (
                  <div key={j} className={`w-full ${seg.className(d)} first:rounded-b-sm last:rounded-t-sm`} style={{ height: `${(v / max) * 100}%` }} />
                ) : null;
              })}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>{days[0] && formatDateShort(days[0].date)}</span>
        <span>{days.at(-1) && formatDateShort(days.at(-1)!.date)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-xl bg-background p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

const HRV_STATUS: Record<string, string> = {
  BALANCED: "Balanced",
  UNBALANCED: "Unbalanced",
  LOW: "Low",
  POOR: "Poor",
};

function latest<T>(days: GarminDayView[], pick: (d: GarminDayView) => T | null): { date: string; value: T } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = pick(days[i]);
    if (v !== null) return { date: days[i].date, value: v };
  }
  return null;
}

function Readiness({ days }: { days: GarminDayView[] }) {
  const hrv = latest(days, (d) => d.hrvLastNight);
  const hrvDay = hrv && days.find((d) => d.date === hrv.date);
  const sleep = latest(days, (d) => d.sleepSeconds);
  const sleepDay = sleep && days.find((d) => d.date === sleep.date);
  const rhr = latest(days, (d) => d.restingHr);
  const bb = latest(days, (d) => d.bodyBatteryMax);
  return (
    <Card title="Latest" aside={hrv ? formatDateShort(hrv.date) : null}>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="HRV last night"
          value={hrv ? `${hrv.value} ms` : "–"}
          sub={hrvDay?.hrvStatus ? `${HRV_STATUS[hrvDay.hrvStatus] ?? hrvDay.hrvStatus} · base ${hrvDay.hrvBaselineLow ?? "?"}–${hrvDay.hrvBaselineHigh ?? "?"}` : null}
        />
        <Stat label="Sleep" value={hm(sleep?.value ?? null)} sub={sleepDay?.sleepScore != null ? `Score ${sleepDay.sleepScore}` : null} />
        <Stat label="Resting HR" value={rhr ? `${rhr.value} bpm` : "–"} sub={rhr ? formatDateShort(rhr.date) : null} />
        <Stat label="Body battery peak" value={bb ? String(bb.value) : "–"} sub={bb ? formatDateShort(bb.date) : null} />
      </div>
    </Card>
  );
}

function ActivityList({ activities }: { activities: GarminTabData["metrics"]["activities"] }) {
  if (activities.length === 0) return <p className="text-sm text-muted-foreground">No activities in this period.</p>;
  return (
    <ul className="divide-y divide-border/50">
      {activities.map((a) => (
        <li key={a.id} className="py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium capitalize truncate">{a.type.replaceAll("_", " ")}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateShort(a.startTimeLocal.slice(0, 10))} · {hm(a.durationSeconds)}
              {a.distanceMeters ? ` · ${formatDistanceKm(a.distanceMeters)}` : ""}
              {a.avgHr ? ` · ${Math.round(a.avgHr)} bpm` : ""}
            </p>
          </div>
          {a.trainingLoad !== null && (
            <div className="text-right flex-none">
              <p className="text-sm font-semibold">{Math.round(a.trainingLoad)}</p>
              <p className="text-[10px] text-muted-foreground">load</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function SyncHistory({ runs }: { runs: GarminSyncRunView[] }) {
  if (runs.length === 0) return null;
  return (
    <details className="rounded-2xl bg-muted p-4">
      <summary className="text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer min-h-[44px] flex items-center">
        Sync history
      </summary>
      <ul className="mt-2 space-y-1.5">
        {runs.map((r) => (
          <li key={r.startedAt} className="text-xs flex justify-between gap-3">
            <span className="text-muted-foreground">
              {new Date(r.startedAt).toLocaleString()} · {formatDateShort(r.rangeStart)}–{formatDateShort(r.rangeEnd)}
            </span>
            <span className={r.status === "error" ? "text-destructive" : ""}>
              {r.status === "ok" && r.counts
                ? `${r.counts.activities ?? 0} act · ${r.counts.daily ?? 0} days${r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}`
                : (r.error ?? r.status)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function GarminMetricsTab() {
  const [data, setData] = useState<GarminTabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(refresh: boolean) {
    setLoading(true);
    setError(null);
    const result = await callAction(getGarminMetrics({ refresh }));
    if (result.success) setData(result.data);
    else setError(result.error);
    setLoading(false);
  }

  useEffect(() => {
    // Fetch once on open: the action may call Garmin, so it isn't done at page render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, []);

  if (!data) {
    return (
      <p role="status" className="text-sm text-muted-foreground text-center py-12">
        {error ?? "Loading Garmin data…"}
      </p>
    );
  }

  const { metrics } = data;
  const chartDays = metrics.days.slice(-CHART_DAYS);
  const hasData = metrics.days.some((d) => d.hrvLastNight !== null || d.sleepSeconds !== null || d.restingHr !== null) || metrics.activities.length > 0;

  if (!data.connected && !hasData) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-muted-foreground">Connect Garmin to see HRV, sleep, body battery and activities here.</p>
        <Link href="/settings" className="inline-flex h-11 items-center px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-70">
          Connect in Settings
        </Link>
      </div>
    );
  }

  const hrvAvg = avg(chartDays.map((d) => d.hrvLastNight));
  const sleepAvg = avg(chartDays.map((d) => d.sleepSeconds));
  const rhrAvg = avg(chartDays.map((d) => d.restingHr));
  const bbAvg = avg(chartDays.map((d) => d.bodyBatteryMax));

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {data.connected ? (data.lastSyncedAt ? `Synced ${ago(data.lastSyncedAt)}` : "Not synced yet") : "Disconnected · showing stored data"}
        </p>
        {data.connected && (
          <button
            onClick={() => load(true)}
            disabled={loading}
            aria-label="Refresh from Garmin"
            className="h-11 w-11 -mr-2 flex items-center justify-center text-primary active:opacity-70 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {(data.syncError || error) && (
        <p role="alert" className="text-xs text-destructive rounded-xl bg-destructive/10 p-3">
          {data.syncError === "key_rejected"
            ? "Garmin no longer accepts your key. It may have expired. Make a new one and connect again in Settings."
            : `Could not sync from Garmin (${data.syncError ?? error}). Showing stored data.`}
        </p>
      )}

      <Readiness days={metrics.days} />

      <Card title={`HRV · ${CHART_DAYS} days`} aside={hrvAvg !== null ? `avg ${Math.round(hrvAvg)} ms` : null}>
        <DayBars
          label="Nightly HRV"
          days={chartDays}
          segments={[
            {
              value: (d) => d.hrvLastNight,
              className: (d) =>
                d.hrvBaselineLow !== null && d.hrvLastNight !== null && d.hrvLastNight < d.hrvBaselineLow ? "bg-amber-500/80" : "bg-primary/80",
            },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">Amber: below your balanced baseline.</p>
      </Card>

      <Card title={`Sleep · ${CHART_DAYS} days`} aside={sleepAvg !== null ? `avg ${hm(sleepAvg)}` : null}>
        <DayBars
          label="Nightly sleep by stage"
          days={chartDays}
          segments={[
            { value: (d) => d.deepSeconds, className: () => "bg-primary" },
            { value: (d) => d.remSeconds, className: () => "bg-primary/60" },
            { value: (d) => d.lightSeconds, className: () => "bg-primary/30" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">Deep, REM, light (bottom to top).</p>
      </Card>

      <Card title={`Resting HR · ${CHART_DAYS} days`} aside={rhrAvg !== null ? `avg ${Math.round(rhrAvg)} bpm` : null}>
        <DayBars label="Resting heart rate" days={chartDays} segments={[{ value: (d) => d.restingHr, className: () => "bg-primary/80" }]} />
      </Card>

      <Card title={`Body battery peak · ${CHART_DAYS} days`} aside={bbAvg !== null ? `avg ${Math.round(bbAvg)}` : null}>
        <DayBars label="Daily body battery peak" days={chartDays} segments={[{ value: (d) => d.bodyBatteryMax, className: () => "bg-primary/80" }]} />
      </Card>

      <Card title="Training load · weekly">
        <div className="flex items-end gap-1 h-20" role="img" aria-label="Weekly training load">
          {metrics.weeklyLoad.map((w) => {
            const max = Math.max(...metrics.weeklyLoad.map((x) => x.load), 1);
            return (
              <div key={w.weekStart} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                <span className="text-[9px] text-muted-foreground">{w.load || ""}</span>
                <div className="w-full bg-primary/80 rounded-t-sm" style={{ height: `${(w.load / max) * 60}%` }} />
                <span className="text-[9px] text-muted-foreground leading-none">{formatDateShort(w.weekStart)}</span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {formatDuration(metrics.weeklyLoad.at(-1)?.minutes ?? 0)} this week · {metrics.weeklyLoad.at(-1)?.count ?? 0} activities
        </p>
      </Card>

      <Card title="Activities" aside={`${metrics.activities.length} in 8 weeks`}>
        <ActivityList activities={metrics.activities} />
      </Card>

      <SyncHistory runs={data.runs} />
    </>
  );
}
