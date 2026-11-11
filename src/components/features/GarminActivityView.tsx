"use client";

import { RouteMap } from "@/components/charts/RouteMap";
import { TimeSeriesChart, elapsedLabel } from "@/components/charts/TimeSeriesChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import { SPORT_LABEL, SPORT_MARK, type VizTheme } from "@/lib/garmin/charts/theme";
import {
  durationLabel,
  lapRows,
  paceLabel,
  pointZones,
  setRows,
  statTiles,
  streamPanels,
  verdict,
  zoneSeconds,
} from "@/lib/garmin/charts/activity";
import type { ActivityDetail } from "@/lib/garmin/queries";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
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

function ZoneBars({ seconds, colors, label }: { seconds: number[]; colors: string[]; label: (i: number) => string }) {
  const total = seconds.reduce((a, b) => a + b, 0);
  const max = Math.max(...seconds, 1);
  if (total <= 0) return null;
  return (
    <ul className="space-y-1.5">
      {seconds.map((s, i) => (
        <li key={i} className="flex items-center gap-2 text-xs tabular-nums">
          <span className="w-7 text-muted-foreground">{label(i)}</span>
          <span className="relative h-3 flex-1 rounded-full bg-background">
            <span className="absolute left-0 top-0 h-3 rounded-full" style={{ width: `${(s / max) * 100}%`, background: colors[i % colors.length] }} />
          </span>
          <span className="w-12 text-right">{durationLabel(s)}</span>
          <span className="w-9 text-right text-muted-foreground">{Math.round((s / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

function Streams({ d, theme, onCursor }: { d: ActivityDetail; theme: VizTheme; onCursor: (i: number | null) => void }) {
  const [idx, setIdx] = useState<number | null>(null);
  const panels = useMemo(() => streamPanels(d), [d]);
  const x = useMemo(() => (d.streams.t ?? []).map((t) => (t ?? 0) * 1000), [d]);
  const colors: Record<string, string> = { hr: theme.negative, pace: theme.sport.run, speed: theme.sport.bike, power: theme.status.warning, cadence: theme.sport.other, altitude: theme.textMuted };
  const series = useMemo(
    () => Object.fromEntries(panels.map((p) => [p.key, [{ label: p.label, values: p.values, color: colors[p.key], width: 1.25, fill: p.key === "altitude" ? "rgba(128,128,128,0.15)" : undefined }]])),
    // colours come from the theme, which is stable per render of this view
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panels, theme],
  );
  if (!panels.length || x.length < 10) return null;
  const i = idx ?? null;
  const fmt = (key: string, v: number | null) => (v === null ? "–" : key === "pace" ? paceLabel(1000 / (v * 60)) : key === "speed" ? v.toFixed(1) : String(Math.round(v)));
  const setBoth = (n: number | null) => {
    setIdx(n);
    onCursor(n);
  };

  return (
    <Card title="Streams" note="Drag across any chart: all charts and the map dot follow. Pace runs faster upwards.">
      <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap min-h-[34px] tabular-nums" aria-live="polite">
        <span className="text-[11px] text-muted-foreground w-full">{i !== null ? elapsedLabel(Math.round(x[i] / 1000)) : "Drag a chart"}</span>
        {i !== null &&
          panels.map((p) => (
            <span key={p.key} className="text-xs text-muted-foreground">
              <span className="text-base font-semibold text-foreground">{fmt(p.key, p.values[i])}</span> {p.unit}
            </span>
          ))}
      </div>
      {panels.map((p, n) => (
        <div key={p.key}>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: colors[p.key] }} />
            {p.label} ({p.unit})
          </p>
          <TimeSeriesChart
            x={x}
            series={series[p.key]}
            height={n === panels.length - 1 ? 110 : 92}
            axisColor={theme.textMuted}
            gridColor={theme.grid}
            syncKey={`activity-${d.id}`}
            xFormat="elapsed"
            showXAxis={n === panels.length - 1}
            invertY={p.invert}
            yRange={p.range ?? undefined}
            onIndex={setBoth}
            ariaLabel={`${p.label} over the session.`}
          />
        </div>
      ))}
    </Card>
  );
}

export function GarminActivityView({ d }: { d: ActivityDetail }) {
  const theme = useVizTheme();
  const [cursor, setCursor] = useState<number | null>(null);
  const zones = useMemo(() => zoneSeconds(d), [d]);
  const pz = useMemo(() => pointZones(d), [d]);
  const routeColors = useMemo(() => (theme ? pz.map((z) => (z === null ? theme.textMuted : theme.zones[z])) : []), [pz, theme]);
  const laps = lapRows(d);
  const startGmt = typeof d.summary.startTimeGMT === "string" ? Date.parse(`${d.summary.startTimeGMT.replace(" ", "T")}Z`) : null;
  const sets = setRows(d, startGmt);
  const dec = d.metrics?.decoupling;
  const hasRoute = (d.streams.lat ?? []).some((v) => v !== null && v !== 0);
  const date = new Date(d.start);

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/garmin?tab=activities" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Activities</span>
        </Link>
      </div>
      <main className="flex-1 overflow-y-auto px-4 pb-nav-safe-lg space-y-4">
        <header className="space-y-1 pt-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: `var(--viz-${d.sport})` }}>
              {SPORT_MARK[d.sport]}
            </span>
            {SPORT_LABEL[d.sport]} · {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} {date.toISOString().slice(11, 16)}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{d.name}</h1>
          <p className="text-base leading-snug">{verdict(d)}</p>
        </header>

        <div className="grid grid-cols-2 gap-2">
          {statTiles(d).map((t) => (
            <div key={t.label} className="rounded-xl bg-muted p-3">
              <p className="text-[11px] text-muted-foreground">{t.label}</p>
              <p className="text-base font-semibold leading-tight">{t.value}</p>
            </div>
          ))}
        </div>

        {theme && hasRoute && (
          <Card title="Route" aside="coloured by HR zone">
            <RouteMap lat={d.streams.lat!} lng={d.streams.lng!} colors={routeColors} cursor={cursor} height={260} />
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              Z1
              {theme.zones.map((c) => (
                <span key={c} className="inline-block h-2.5 w-5 rounded-sm" style={{ background: c }} />
              ))}
              Z5
            </div>
          </Card>
        )}

        {theme && <Streams d={d} theme={theme} onCursor={setCursor} />}

        {theme && zones.hr.some((s) => s > 0) && (
          <Card title="Heart-rate zones" note="Garmin's five zones from your watch settings.">
            <ZoneBars seconds={zones.hr} colors={theme.zones} label={(i) => `Z${i + 1}`} />
          </Card>
        )}
        {theme && zones.power.some((s) => s > 0) && (
          <Card title="Power zones">
            <ZoneBars seconds={zones.power} colors={[...theme.zones, theme.zones[4], theme.zones[4]]} label={(i) => `Z${i + 1}`} />
          </Card>
        )}

        {dec && (
          <Card
            title="Aerobic decoupling"
            note="Efficiency (output per heartbeat) in the first half against the second, after a 10 min warm-up. Under 5 % means your aerobic base holds for this long."
          >
            {dec.valid ? (
              <div className="space-y-2">
                <p className="text-3xl font-semibold">{dec.pct.toFixed(1)} %</p>
                {[
                  { label: "First half", v: dec.efFirst },
                  { label: "Second half", v: dec.efSecond },
                ].map((r) => (
                  <div key={r.label} className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="w-20 text-muted-foreground">{r.label}</span>
                    <span className="relative h-3 flex-1 rounded-full bg-background">
                      <span className="absolute left-0 top-0 h-3 rounded-full" style={{ width: `${(r.v / Math.max(dec.efFirst, dec.efSecond)) * 100}%`, background: "var(--viz-positive)" }} />
                    </span>
                    <span className="w-12 text-right">{r.v.toFixed(2)}</span>
                  </div>
                ))}
                {dec.temperature !== null && <p className="text-[11px] text-muted-foreground">Mean temperature {Math.round(dec.temperature)} °C. Heat raises decoupling.</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No number for this session: {dec.reason.toLowerCase()}.{dec.ef ? ` Efficiency ${dec.ef.toFixed(2)}.` : ""}
              </p>
            )}
          </Card>
        )}

        {laps.length > 1 && (
          <Card title={`Laps · ${laps.length}`}>
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 font-normal">#</th>
                  <th className="font-normal">Time</th>
                  <th className="font-normal">Dist</th>
                  <th className="font-normal">HR</th>
                  <th className="font-normal text-right">{d.sport === "run" ? "Pace" : d.sport === "bike" ? "Power" : "Speed"}</th>
                </tr>
              </thead>
              <tbody>
                {laps.map((l) => (
                  <tr key={l.n} className="border-t border-border/50">
                    <td className="py-1.5 text-muted-foreground">{l.n}</td>
                    <td>{durationLabel(l.durationS)}</td>
                    <td>{l.distanceM ? `${(l.distanceM / 1000).toFixed(2)}` : "–"}</td>
                    <td>{l.avgHr ?? "–"}</td>
                    <td className="text-right">{d.sport === "run" ? paceLabel(l.avgSpeed) : d.sport === "bike" ? (l.avgPower ? `${Math.round(l.avgPower)} W` : l.avgSpeed ? `${(l.avgSpeed * 3.6).toFixed(1)} km/h` : "–") : l.avgSpeed ? `${(l.avgSpeed * 3.6).toFixed(1)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {sets.length > 0 && (
          <Card
            title={`Sets on the watch · ${sets.length}`}
            aside={d.matchedSessionId ? undefined : "no LogEveryLift session matched"}
            note="Reps and weight as the watch recorded them. The LogEveryLift session is the record of what you lifted."
          >
            {d.matchedSessionId && (
              <Link href={`/history/${d.matchedSessionId}`} className="flex h-11 items-center justify-center rounded-xl bg-background text-sm font-semibold active:opacity-70">
                Open the LogEveryLift session
              </Link>
            )}
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 font-normal">#</th>
                  <th className="font-normal">At</th>
                  <th className="font-normal">Reps</th>
                  <th className="font-normal">Weight</th>
                  <th className="font-normal">Work</th>
                  <th className="font-normal text-right">Rest</th>
                </tr>
              </thead>
              <tbody>
                {sets.map((s) => (
                  <tr key={s.n} className="border-t border-border/50">
                    <td className="py-1.5 text-muted-foreground">{s.n}</td>
                    <td>{s.startS !== null ? elapsedLabel(Math.max(0, Math.round(s.startS))) : "–"}</td>
                    <td>{s.reps ?? "–"}</td>
                    <td>{s.weightKg ? `${Math.round(s.weightKg * 10) / 10} kg` : "–"}</td>
                    <td>{durationLabel(s.durationS)}</td>
                    <td className="text-right">{durationLabel(s.restAfterS)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </main>
    </div>
  );
}
