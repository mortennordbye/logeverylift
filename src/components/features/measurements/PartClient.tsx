"use client";

import { MeasureGuide, SectionLabel, TrendLine } from "@/components/features/measurements/measurement-ui";
import { deleteBodyMeasurement, saveBodyMeasurement } from "@/lib/actions/body-measurements";
import type { BodyPart } from "@/lib/utils/body-measurement-parts";
import { changeSince, formatCm, round1, seriesOf, type MeasurementRow } from "@/lib/utils/body-measurements";
import { formatDateShort, sanitizeDecimalInput } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** How long a first tap on Delete waits for the second. */
const CONFIRM_MS = 3000;

const SIDE_LETTER = { none: "", left: "L", right: "R" } as const;

/** "90 cm · −2.0 cm since 3 Oct", or the latest value alone. */
function headline(series: MeasurementRow[], today: string, prefix = ""): string | null {
  const last = series.at(-1);
  if (!last) return null;
  const c = changeSince(series, "first", today);
  const value = `${prefix}${formatCm(last.valueCm)} cm`;
  if (!c) return value;
  const change = c.delta === 0 ? "±0" : `${c.delta > 0 ? "+" : "−"}${Math.abs(c.delta).toFixed(1)}`;
  return `${value} · ${change} cm since ${formatDateShort(c.from)}`;
}

/** One body part: how to measure it, its chart (L and R for a sided part) and its history with delete. */
export function PartClient({ part, rows, today }: { part: BodyPart; rows: MeasurementRow[]; today: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<number | null>(null);
  /** The row whose Delete was tapped once and now says Confirm. */
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const series = part.sides ? [seriesOf(rows, part.site, "left"), seriesOf(rows, part.site, "right")] : [seriesOf(rows, part.site, "none")];
  const lines = part.sides
    ? [headline(series[0], today, "L "), headline(series[1], today, "R ")].filter(Boolean)
    : [headline(series[0], today)].filter(Boolean);
  const history = [...rows].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn) || a.side.localeCompare(b.side));
  const dates = rows.map((r) => r.measuredOn).sort();

  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  async function remove(id: number) {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    setDeleting(id);
    setError(null);
    const result = await callAction(deleteBodyMeasurement({ id }));
    setDeleting(null);
    if (!result.success) setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 flex flex-col gap-5">
      {lines.length > 0 && (
        <div className="px-1 text-sm text-muted-foreground" data-testid="part-headline">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}

      {part.kind === "length" && <NewLength part={part} today={today} latest={series[0].at(-1)?.valueCm ?? null} />}

      <div>
        <SectionLabel>How to measure</SectionLabel>
        <div className="rounded-2xl bg-card p-4">
          <MeasureGuide part={part} tape={part.tape} />
        </div>
      </div>

      <div>
        <SectionLabel>History</SectionLabel>
        {history.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No values yet</p>
        ) : (
          <div className="rounded-2xl bg-card overflow-hidden">
            {dates.length > 1 && (
              <div className="px-4 pt-4 pb-2 space-y-1">
                <TrendLine series={series} width={280} height={80} dots className="w-full h-20" />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{formatDateShort(dates[0])}</span>
                  {part.sides && <span>L full line · R dashed line</span>}
                  <span>{formatDateShort(dates[dates.length - 1])}</span>
                </div>
              </div>
            )}
            <div className="divide-y divide-border/50">
              {history.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 min-h-[52px]" data-testid="history-row">
                  <span className="flex-1 text-sm">{formatDateShort(r.measuredOn)}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {SIDE_LETTER[r.side] && `${SIDE_LETTER[r.side]} `}
                    {formatCm(r.valueCm)} cm
                  </span>
                  <button
                    onClick={() => remove(r.id)}
                    disabled={deleting !== null}
                    aria-label={`${armed === r.id ? "Confirm delete" : "Delete"} ${formatDateShort(r.measuredOn)}${r.side === "none" ? "" : ` ${r.side}`}`}
                    className={`min-h-[44px] px-2 text-sm active:opacity-60 disabled:opacity-40 ${armed === r.id ? "rounded-lg bg-destructive text-white font-semibold" : "text-destructive"}`}
                  >
                    {armed === r.id ? "Confirm" : "Delete"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="px-1 pt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div aria-hidden="true" className="h-4 shrink-0" />
    </div>
  );
}

/** A length is not in the log flow after the first log, so it is changed here. */
function NewLength({ part, today, latest }: { part: BodyPart; today: string; latest: number | null }) {
  const router = useRouter();
  const [text, setText] = useState(latest === null ? "" : formatCm(latest));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v) || v < 1 || v > 300) return setError("Type a value from 1 to 300 cm");
    setBusy(true);
    setError(null);
    const result = await callAction(saveBodyMeasurement({ site: part.site, side: "none", valueCm: round1(v), measuredOn: today }));
    setBusy(false);
    if (!result.success) return setError(result.error);
    router.refresh();
  }

  return (
    <form
      className="rounded-2xl bg-card p-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-center gap-3">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${part.name} in cm`}
          value={text}
          onChange={(e) => {
            setText(sanitizeDecimalInput(e.target.value));
            setError(null);
          }}
          className="flex-1 min-w-0 rounded-xl bg-muted px-4 py-3 text-sm tabular-nums outline-none focus:ring-2 ring-primary"
        />
        <span className="text-sm text-muted-foreground">cm</span>
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
