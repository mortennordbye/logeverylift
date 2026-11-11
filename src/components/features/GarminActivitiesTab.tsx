"use client";

import { EChart } from "@/components/charts/EChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import { SPORTS, type Sport } from "@/lib/garmin/analytics/sport";
import { SPORT_LABEL, SPORT_MARK } from "@/lib/garmin/charts/theme";
import type { ActivitiesData, ActivityListRow } from "@/lib/garmin/queries";
import { formatDateShort, formatDistanceKm } from "@/lib/utils/format";
import { CalendarDays, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const CELL = 14;

function hm(seconds: number | null) {
  if (!seconds) return "–";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function SportBadge({ sport }: { sport: Sport }) {
  return (
    <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: `var(--viz-${sport})` }} aria-label={SPORT_LABEL[sport]}>
      {SPORT_MARK[sport]}
    </span>
  );
}

/** A 60 × 20 heart-rate sparkline from the 40 stored preview points. */
function Sparkline({ values }: { values: (number | null)[] }) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 4) return <span className="w-[60px]" />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const pts = values
    .map((y, i) => (y === null ? null : `${(i / (values.length - 1)) * 60},${20 - ((y - min) / Math.max(1, max - min)) * 18 - 1}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg width="60" height="20" viewBox="0 0 60 20" aria-hidden className="flex-none">
      <polyline points={pts} fill="none" stroke="var(--viz-negative)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ a }: { a: ActivityListRow }) {
  const date = new Date(a.start);
  return (
    <li>
      <Link href={`/more/garmin/activity/${a.id}`} className="flex items-center gap-3 py-2.5 min-h-[56px] active:opacity-60">
        <SportBadge sport={a.sport} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{a.name}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {formatDateShort(date.toISOString().slice(0, 10))} {date.toISOString().slice(11, 16)} · {hm(a.durationS)}
            {a.distanceM ? ` · ${formatDistanceKm(a.distanceM)}` : ""}
            {a.avgHr ? ` · ${Math.round(a.avgHr)} bpm` : ""}
          </p>
        </div>
        <Sparkline values={a.hrPreview} />
        <div className="w-9 text-right">
          <p className="text-sm font-semibold tabular-nums">{a.load !== null ? Math.round(a.load) : "–"}</p>
          <p className="text-[9px] text-muted-foreground">load</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
      </Link>
    </li>
  );
}

export function GarminActivitiesTab({ data }: { data: ActivitiesData }) {
  const theme = useVizTheme();
  const [sport, setSport] = useState<Sport | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const weeks = Math.ceil(data.calendar.length / 7) + 1;
  const width = Math.max(320, weeks * CELL + 40);
  const first = data.calendar[0]?.date;
  const last = data.calendar.at(-1)?.date;

  const option = useMemo(() => {
    if (!theme || !first || !last) return null;
    return {
      animation: false,
      tooltip: { show: false },
      visualMap: {
        show: false,
        type: "piecewise",
        dimension: 1,
        pieces: [
          { lte: 0, color: theme.grid },
          { gt: 0, lte: 25, color: theme.zones[0] },
          { gt: 25, lte: 50, color: theme.zones[1] },
          { gt: 50, lte: 80, color: theme.zones[2] },
          { gt: 80, lte: 120, color: theme.zones[3] },
          { gt: 120, color: theme.zones[4] },
        ],
      },
      calendar: {
        range: [first, last],
        orient: "horizontal",
        cellSize: [CELL, CELL],
        left: 30,
        right: 8,
        top: 18,
        splitLine: { show: false },
        itemStyle: { color: "transparent", borderColor: theme.surface, borderWidth: 2 },
        dayLabel: { firstDay: 1, nameMap: ["", "M", "", "W", "", "F", ""], color: theme.textMuted, fontSize: 9 },
        monthLabel: { color: theme.textMuted, fontSize: 10, nameMap: "en" },
        yearLabel: { show: false },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: data.calendar.map((d) => [d.date, d.load]), itemStyle: { borderRadius: 3 } }],
    };
  }, [theme, data.calendar, first, last]);

  // Start at the newest weeks; older history is a swipe to the left.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [option]);

  const sports = SPORTS.filter((s) => data.list.some((a) => a.sport === s));
  const list = data.list.filter((a) => (!sport || a.sport === sport) && (!day || new Date(a.start).toISOString().slice(0, 10) === day));
  const selected = day ? data.calendar.find((d) => d.date === day) : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-muted p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-background">
              <CalendarDays className="h-3.5 w-3.5 text-foreground" aria-hidden />
            </span>
            Training load by day
          </h2>
          <span className="text-[11px] text-muted-foreground">swipe calendar for older</span>
        </div>
        <div ref={scroller} data-no-swipe className="overflow-x-auto -mx-1 no-scrollbar">
          <div style={{ width }}>{option && <EChart option={option} height={7 * CELL + 30} onItemClick={(v) => Array.isArray(v) && setDay(String(v[0]))} ariaLabel={`Daily training load from ${first} to ${last}.`} />}</div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          Less
          {theme && [theme.grid, ...theme.zones].map((c) => <span key={c} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />)}
          More
        </div>
      </section>

      <div data-no-swipe className="flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar" role="toolbar" aria-label="Filter by sport">
        <button onClick={() => setSport(null)} aria-pressed={!sport} className={`h-9 px-3 rounded-full text-sm font-medium flex-none active:opacity-70 ${!sport ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>
          All
        </button>
        {sports.map((s) => (
          <button key={s} onClick={() => setSport(sport === s ? null : s)} aria-pressed={sport === s} className={`h-9 px-3 rounded-full text-sm font-medium flex-none flex items-center gap-1.5 active:opacity-70 ${sport === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: `var(--viz-${s})` }}>
              {SPORT_MARK[s]}
            </span>
            {SPORT_LABEL[s]}
          </button>
        ))}
      </div>

      {day && (
        <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
          <span>
            {formatDateShort(day)} · load {selected?.load ?? 0}
          </span>
          <button onClick={() => setDay(null)} aria-label="Clear day" className="h-9 w-9 flex items-center justify-center active:opacity-60">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <section className="rounded-2xl bg-muted px-4 py-1">
        {list.length ? (
          <ul className="divide-y divide-border/50">
            {list.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No activities{day ? " that day" : ""}.</p>
        )}
      </section>
    </div>
  );
}
