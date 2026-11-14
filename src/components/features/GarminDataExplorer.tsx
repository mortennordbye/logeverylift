"use client";

import {
  getGarminActivityRaw,
  getGarminDay,
  type GarminExplorerActivity,
  type GarminExplorerDay,
  type GarminExplorerKind,
} from "@/lib/actions/garmin";
import { formatDateShort } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { dateLabel } from "@/lib/utils/date-label";

/**
 * The Data tab: everything stored from Garmin for one day, as Garmin sent it,
 * plus import status and the sync log. Reads only the database.
 */

const POLL_MS = 15_000;

function localToday() {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in the device's time zone
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function kb(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">{title}</h2>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] leading-snug bg-background rounded-xl p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Status({ s }: { s: GarminExplorerDay["status"] }) {
  const importing = !s.historyDone || s.activitiesPending > 0;
  return (
    <Card title="Import" aside={importing ? "running" : "complete"}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">History back to</dt>
        <dd className="text-right">{s.historyCursor ? formatDateShort(s.historyCursor) : "not started"}</dd>
        <dt className="text-muted-foreground">Stops at</dt>
        <dd className="text-right">{s.historyFloor ? formatDateShort(s.historyFloor) : "start of your data"}</dd>
        <dt className="text-muted-foreground">Days stored</dt>
        <dd className="text-right">
          {s.daysStored}
          {s.oldestDay ? ` · since ${formatDateShort(s.oldestDay)}` : ""}
        </dd>
        <dt className="text-muted-foreground">Activities</dt>
        <dd className="text-right">
          {s.activities} · {s.activitiesWithFiles} with files
          {s.activitiesPending ? ` · ${s.activitiesPending} waiting` : ""}
          {s.activitiesFailed ? ` · ${s.activitiesFailed} failed` : ""}
        </dd>
        <dt className="text-muted-foreground">Stored</dt>
        <dd className="text-right">{kb(s.storedBytes)}</dd>
      </dl>
      {s.pausedUntil && (
        <p className="text-xs text-destructive">Garmin asked us to slow down. Import continues at {dateLabel(new Date(s.pausedUntil), "HH:mm")}.</p>
      )}
    </Card>
  );
}

function KindRow({ k }: { k: GarminExplorerKind }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full min-h-[44px] py-2 flex items-center justify-between gap-3 text-left active:opacity-60">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{k.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {k.kind} · {k.fields} fields · {kb(k.bytes)}
          </p>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground flex-none transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <Json value={k.data} />}
    </li>
  );
}

function ActivityRow({ a }: { a: GarminExplorerActivity }) {
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  async function toggle() {
    if (raw) return setRaw(null);
    setLoading(true);
    const r = await callAction(getGarminActivityRaw({ id: a.id }));
    setLoading(false);
    setRaw(r.success ? r.data : { error: r.error });
  }
  const streams = a.streamPoints ? Object.entries(a.streamPoints).filter(([k]) => k !== "t") : [];
  return (
    <li>
      <button onClick={toggle} aria-expanded={Boolean(raw)} className="w-full min-h-[44px] py-2 flex items-center justify-between gap-3 text-left active:opacity-60">
        <div className="min-w-0">
          <p className="text-sm font-medium capitalize truncate">
            {a.type.replaceAll("_", " ")} · {a.startTimeLocal.slice(11, 16)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {a.filesError
              ? `files failed: ${a.filesError}`
              : a.fileBytes === null
                ? "files waiting"
                : `FIT ${kb(a.fileBytes)} · ${a.streamPoints?.t ?? 0} points · ${streams.map(([k]) => k).join(", ") || "no streams"}${a.sets ? ` · ${a.sets} sets` : ""}${a.laps ? ` · ${a.laps} laps` : ""}`}
          </p>
        </div>
        {loading ? <RefreshCw className="w-4 h-4 animate-spin flex-none" /> : <ChevronRight className={`w-4 h-4 text-muted-foreground flex-none transition-transform ${raw ? "rotate-90" : ""}`} />}
      </button>
      {raw !== null && <Json value={raw} />}
    </li>
  );
}

export function GarminDataExplorer() {
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<GarminExplorerDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    const r = await callAction(getGarminDay({ date: d }));
    if (r.success) {
      setDay(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    // The date is the device's, so it is set after mount (the server may be in another time zone).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(localToday());
  }, []);

  useEffect(() => {
    // Fetch on date change; state is set after the action answers, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (date) void load(date);
  }, [date, load]);

  // While the background import runs, refresh the status so progress is visible.
  const importing = day ? !day.status.historyDone || day.status.activitiesPending > 0 : false;
  useEffect(() => {
    if (!importing || !date) return;
    const id = setInterval(() => void load(date), POLL_MS);
    return () => clearInterval(id);
  }, [importing, date, load]);

  if (!date || !day) {
    return (
      <p role="status" className="text-sm text-muted-foreground text-center py-12">
        {error ?? "Loading stored Garmin data…"}
      </p>
    );
  }

  return (
    <>
      <Status s={day.status} />

      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day" className="h-11 w-11 flex items-center justify-center rounded-xl bg-muted active:opacity-60">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <input
          type="date"
          aria-label="Day"
          value={date}
          max={localToday()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-11 flex-1 rounded-xl bg-muted px-3 text-sm text-center"
        />
        <button
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={date >= localToday()}
          aria-label="Next day"
          className="h-11 w-11 flex items-center justify-center rounded-xl bg-muted active:opacity-60 disabled:opacity-30"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <Card title={`Day data · ${formatDateShort(date)}`} aside={`${day.kinds.length} kinds`}>
        {day.kinds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing stored for this day yet.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {day.kinds.map((k) => (
              <KindRow key={k.kind} k={k} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Activities" aside={String(day.activities.length)}>
        {day.activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activities this day.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {day.activities.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Sync log" aside={`last ${day.runs.length}`}>
        <ul className="space-y-1.5">
          {day.runs.map((r, i) => (
            <li key={`${r.startedAt}-${i}`} className="text-xs flex justify-between gap-3">
              <span className="text-muted-foreground">
                {dateLabel(new Date(r.startedAt), "HH:mm")} · {r.trigger} · {formatDateShort(r.rangeStart)}–{formatDateShort(r.rangeEnd)}
              </span>
              <span className={r.status === "error" ? "text-destructive text-right" : "text-right"}>
                {r.status === "running"
                  ? "running"
                  : `${Object.entries(r.counts ?? {}).reduce((s, [k, v]) => (k === "failedCalls" ? s : s + v), 0)} rows${r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(0)}s` : ""}${r.error ? ` · ${r.error}` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
