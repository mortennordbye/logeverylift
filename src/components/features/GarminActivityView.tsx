"use client";

import { RouteMap } from "@/components/charts/RouteMap";
import { Card } from "@/components/features/garmin/GarminUi";
import { TimeSeriesChart, elapsedLabel } from "@/components/charts/TimeSeriesChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import { SPORT_LABEL, SPORT_MARK, type VizTheme } from "@/lib/garmin/charts/theme";
import {
  durationLabel,
  lapRows,
  lapSpans,
  selectionStats,
  paceLabel,
  pointZones,
  setRows,
  statTiles,
  streamPanels,
  verdict,
  zoneSeconds,
} from "@/lib/garmin/charts/activity";
import type { ActivityDetail } from "@/lib/garmin/queries";
import { ChartLine, ChevronLeft, MousePointerSquareDashed, X, Dumbbell, Flag, Flame, Gauge, HeartPulse, Map as MapIcon, Mountain, Route as RouteIcon, Scale, Timer, TrendingUp, Zap, type LucideIcon } from "lucide-react";

const STAT_ICON: Record<string, LucideIcon> = {
  Duration: Timer,
  Distance: RouteIcon,
  Pace: Gauge,
  Speed: Gauge,
  "Heart rate": HeartPulse,
  Power: Zap,
  Climb: Mountain,
  Load: Dumbbell,
  "Training effect": TrendingUp,
  Calories: Flame,
};
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSwipe } from "./garmin/use-swipe";
import { useMemo, useState } from "react";


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

type Span = [number, number];

/** Stats for the selected span: time, distance, HR, power or pace, climb. */
function SelectionSummary({ d, span, onClear }: { d: ActivityDetail; span: Span; onClear: () => void }) {
  const s = selectionStats(d, span[0], span[1]);
  const items = s
    ? [
        { label: "time", value: durationLabel(s.durationS) },
        ...(s.distanceM ? [{ label: "km", value: (s.distanceM / 1000).toFixed(2) }] : []),
        ...(s.avgHr ? [{ label: "bpm", value: String(Math.round(s.avgHr)) }] : []),
        ...(s.avgPower ? [{ label: "W", value: String(Math.round(s.avgPower)) }] : []),
        ...(s.avgSpeed && d.sport === "run" ? [{ label: "/km", value: paceLabel(s.avgSpeed) }] : []),
        ...(s.avgSpeed && d.sport !== "run" ? [{ label: "km/h", value: (s.avgSpeed * 3.6).toFixed(1) }] : []),
        ...(s.climbM ? [{ label: "m climb", value: String(Math.round(s.climbM)) }] : []),
      ]
    : [];
  return (
    <div className="flex items-start gap-2 rounded-xl bg-background p-2.5" aria-live="polite">
      <div className="flex-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
        <span className="w-full text-[11px] text-muted-foreground">
          Selected {elapsedLabel(Math.round(span[0]))} to {elapsedLabel(Math.round(span[1]))}
        </span>
        {items.length ? (
          items.map((i) => (
            <span key={i.label} className="text-xs text-muted-foreground">
              <span className="text-base font-semibold text-foreground">{i.value}</span> {i.label}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Too short to measure</span>
        )}
      </div>
      <button onClick={onClear} aria-label="Clear the selection" className="h-11 w-11 -m-1.5 flex items-center justify-center rounded-full active:opacity-60">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Streams({
  d,
  theme,
  onCursor,
  span,
  setSpan,
}: {
  d: ActivityDetail;
  theme: VizTheme;
  onCursor: (i: number | null) => void;
  span: Span | null;
  setSpan: (s: Span | null) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const ranges = useMemo(() => (span ? [{ from: span[0] * 1000, to: span[1] * 1000, color: "rgba(128,128,128,0.22)" }] : []), [span]);
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
    <Card
      icon={ChartLine}
      title="Streams"
      aside={
        <button
          onClick={() => setSelecting(!selecting)}
          aria-pressed={selecting}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium active:opacity-70 ${selecting ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}
        >
          <MousePointerSquareDashed className="h-3.5 w-3.5" aria-hidden />
          Select range
        </button>
      }
      note={selecting ? "Drag across a chart to select a span. Tap Select range again to go back to the crosshair." : "Drag across any chart: all charts and the map dot follow. Pace runs faster upwards. Tap a lap to select it."}
    >
      {span && <SelectionSummary d={d} span={span} onClear={() => setSpan(null)} />}
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
            ranges={ranges}
            selecting={selecting}
            onSelect={(from, to) => setSpan([from / 1000, to / 1000])}
            ariaLabel={`${p.label} over the session.`}
          />
        </div>
      ))}
    </Card>
  );
}

export function GarminActivityView({ d }: { d: ActivityDetail }) {
  const theme = useVizTheme();
  const router = useRouter();
  // Swipe right anywhere outside a chart or the map: back to the list.
  const swipe = useSwipe({ onRight: () => (window.history.length > 1 ? router.back() : router.replace("/more/garmin?tab=activities")) });
  const [cursor, setCursor] = useState<number | null>(null);
  const [span, setSpan] = useState<Span | null>(null);
  const zones = useMemo(() => zoneSeconds(d), [d]);
  const pz = useMemo(() => pointZones(d), [d]);
  const routeColors = useMemo(() => (theme ? pz.map((z) => (z === null ? theme.textMuted : theme.zones[z])) : []), [pz, theme]);
  const laps = lapRows(d);
  const startGmt = typeof d.summary.startTimeGMT === "string" ? Date.parse(`${d.summary.startTimeGMT.replace(" ", "T")}Z`) : null;
  const sets = setRows(d, startGmt);
  const spans = lapSpans(d, startGmt);
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
      <main {...swipe.handlers} style={swipe.style} className="flex-1 overflow-y-auto px-4 pb-nav-safe-lg space-y-4">
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
          {statTiles(d).map((t) => {
            const Icon = STAT_ICON[t.label] ?? Gauge;
            return (
            <div key={t.label} className="rounded-xl bg-muted p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t.label}
              </p>
              <p className="text-base font-semibold leading-tight">{t.value}</p>
            </div>
            );
          })}
        </div>

        {theme && hasRoute && (
          <Card icon={MapIcon} title="Route" aside="coloured by HR zone">
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

        {theme && <Streams d={d} theme={theme} onCursor={setCursor} span={span} setSpan={setSpan} />}

        {theme && zones.hr.some((s) => s > 0) && (
          <Card icon={HeartPulse} title="Heart-rate zones" note="Garmin's five zones from your watch settings.">
            <ZoneBars seconds={zones.hr} colors={theme.zones} label={(i) => `Z${i + 1}`} />
          </Card>
        )}
        {theme && zones.power.some((s) => s > 0) && (
          <Card icon={Zap} title="Power zones">
            <ZoneBars seconds={zones.power} colors={[...theme.zones, theme.zones[4], theme.zones[4]]} label={(i) => `Z${i + 1}`} />
          </Card>
        )}

        {dec && (
          <Card
            icon={Scale} title="Aerobic decoupling"
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
          <Card icon={Flag} title={`Laps · ${laps.length}`} aside={spans.some(Boolean) ? "tap a lap to select it" : undefined}>
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
                {laps.map((l, i) => {
                  const lapSpan = spans[i];
                  const active = !!span && !!lapSpan && span[0] === lapSpan[0] && span[1] === lapSpan[1];
                  return (
                  <tr
                    key={l.n}
                    onClick={lapSpan ? () => setSpan(active ? null : lapSpan) : undefined}
                    aria-selected={active}
                    className={`border-t border-border/50 ${lapSpan ? "cursor-pointer active:opacity-60" : ""} ${active ? "bg-background" : ""}`}
                  >
                    <td className="py-2.5 text-muted-foreground">{l.n}</td>
                    <td>{durationLabel(l.durationS)}</td>
                    <td>{l.distanceM ? `${(l.distanceM / 1000).toFixed(2)}` : "–"}</td>
                    <td>{l.avgHr ?? "–"}</td>
                    <td className="text-right">{d.sport === "run" ? paceLabel(l.avgSpeed) : d.sport === "bike" ? (l.avgPower ? `${Math.round(l.avgPower)} W` : l.avgSpeed ? `${(l.avgSpeed * 3.6).toFixed(1)} km/h` : "–") : l.avgSpeed ? `${(l.avgSpeed * 3.6).toFixed(1)}` : "–"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {sets.length > 0 && (
          <Card
            icon={Dumbbell} title={`Sets on the watch · ${sets.length}`}
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
