"use client";

/**
 * The run results table (docs/plans/run-logger.md, section 5 "Run results",
 * R12, 4.7): one row per step after the run, a strides block as one row, with
 * the time the clock saved. On a treadmill each step's belt has a stepper
 * (0.1 km/h): a changed belt saves typed speed and distance over the step's
 * time, and never changes the events. Avg HR is optional; "More numbers" adds
 * max HR and cadence (and climbing outdoors). An outdoor run with no Garmin
 * distance asks for one optional total distance. Effort once per run. Done
 * saves through the set logging path (offline queue included); "Later"
 * leaves it.
 */

import { BackLink } from "@/components/ui/BackLink";
import { useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import type { RideMode } from "@/db/schema/rides";
import { badField, fieldLabel, fieldText, rideEffort, type ResultEdits, type ResultField, type ResultStep } from "@/lib/utils/ride-results";
import { beltOfLog, runResultPayloads, runTimeText, totalKmText, type RunResultRow } from "@/lib/utils/run-results";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const FIELD = "h-11 min-w-0 rounded-lg bg-background px-2 text-base tabular-nums aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-foreground";
const INPUT = `${FIELD} w-full text-right`;
const STEP_BTN = "h-11 w-11 shrink-0 rounded-lg bg-background text-xl font-semibold leading-none active:opacity-70 disabled:opacity-40";
/** The belt stepper moves 0.1 km/h a tap, from 0 to 25 km/h (as a belt event, 4.4). */
const BELT_MAX = 25;

export function RunResults({
  programId,
  exerciseId,
  steps,
  rows,
  mode,
  setNumbers,
  sessionId,
  garminWaiting,
  laterHref,
}: {
  programId: number;
  exerciseId: number;
  /** Every step of the plan, for the saves. */
  steps: ResultStep[];
  rows: RunResultRow[];
  mode: RideMode;
  setNumbers: Record<number, number>;
  sessionId: number;
  garminWaiting: boolean;
  /** Where "Later" goes. */
  laterHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { logWithRetry } = useWorkoutSetWriter();
  const treadmill = mode === "indoor";
  const more: ResultField[] = treadmill ? ["maxHr", "avgCadence"] : ["maxHr", "avgCadence", "climbM"];
  const [edits, setEdits] = useState<ResultEdits>({});
  const [belts, setBelts] = useState<Record<number, number>>({});
  // Outdoors with no Garmin distance: one optional total (section 5).
  const askTotal = !treadmill && !steps.some((s) => s.log?.sources?.distanceMeters === "garmin");
  const [total, setTotal] = useState<string | undefined>(undefined);
  const [showMore, setShowMore] = useState(false);
  const [effort, setEffort] = useState<number | null>(rideEffort(steps));
  const [saving, setSaving] = useState(false);

  const value = (s: ResultStep, f: ResultField) => edits[s.programSetId]?.[f] ?? fieldText(f, s.log?.[f] ?? null);
  const edit = (id: number, f: ResultField, text: string) => setEdits((all) => ({ ...all, [id]: { ...all[id], [f]: text } }));
  /** A step that can take numbers: run, not skipped. */
  const open = (s: ResultStep) => !!s.log && s.log.status !== "skipped" && (s.log.durationSeconds ?? 0) > 0;
  const beltOf = (r: RunResultRow) => (r.step ? (belts[r.step.programSetId] ?? beltOfLog(r.step.log)) : null);
  const moveBelt = (r: RunResultRow, by: number) => {
    const s = r.step!;
    const from = beltOf(r) ?? r.planBelt ?? 8;
    const next = Math.round(Math.min(BELT_MAX, Math.max(0, from + by)) * 10) / 10;
    setBelts((all) => {
      const rest = { ...all };
      delete rest[s.programSetId];
      // Back at the saved belt: nothing to save.
      return next === beltOfLog(s.log) ? rest : { ...rest, [s.programSetId]: next };
    });
  };
  const badTotal = total !== undefined && badField("distanceMeters", total);
  const bad = badTotal || steps.some((s) => [...(["avgHr"] as ResultField[]), ...more].some((f) => badField(f, edits[s.programSetId]?.[f])));

  async function done() {
    if (saving || bad) return;
    setSaving(true);
    const payloads = runResultPayloads(steps, edits, belts, total, effort, { sessionId, exerciseId, setNumbers });
    // In order, one at a time: a failed write goes to the offline queue and is sent later.
    for (const p of payloads) await logWithRetry(p);
    router.replace(pathname);
    router.refresh();
  }

  const cell = (s: ResultStep, f: ResultField) => (
    <input
      inputMode="numeric"
      value={value(s, f)}
      placeholder="–"
      disabled={!open(s)}
      onChange={(e) => edit(s.programSetId, f, e.target.value)}
      aria-label={`${fieldLabel(f)} step ${s.n}`}
      aria-invalid={badField(f, edits[s.programSetId]?.[f])}
      className={`${INPUT} disabled:bg-transparent disabled:placeholder:text-muted-foreground/50`}
      data-testid={`result-${f}-${s.n}`}
    />
  );

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="run-results">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
        <Link href={laterHref} className="text-primary text-sm font-medium min-h-11 px-1 inline-flex items-center active:opacity-70" data-testid="results-later">
          Later
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Run results</h1>
          <p className="mt-1 text-sm text-muted-foreground">{treadmill ? "Times and belts are saved. Fix a belt you did not tap." : "Times are saved. Numbers are optional."}</p>
        </div>

        {garminWaiting && (
          <div className="flex items-center rounded-xl bg-muted px-4 min-h-12 text-sm text-muted-foreground" data-testid="garmin-waiting">
            Waiting for your Garmin run. It fills the numbers.
          </div>
        )}

        <div className="rounded-2xl bg-muted" data-testid="results-table">
          <div className="grid grid-cols-[minmax(0,1fr)_68px] gap-2 px-3 pt-2.5 pb-1 text-xs text-muted-foreground" aria-hidden>
            <span>Step</span>
            <span className="text-right">Avg HR</span>
          </div>
          <ol className="divide-y divide-border">
            {rows.map((r) => {
              const s = r.step;
              if (!s) {
                return (
                  <li key={r.key} className="px-3 min-h-12 py-2 flex items-center" data-testid="result-row">
                    <p className="text-sm font-semibold">{r.title}</p>
                  </li>
                );
              }
              const belt = beltOf(r);
              return (
                <li key={r.key} className="px-3 py-2" data-testid="result-row">
                  <div className="grid grid-cols-[minmax(0,1fr)_68px] items-center gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{r.title}</p>
                      <p className="text-xs text-muted-foreground tabular-nums" data-testid={`result-time-${r.n}`}>
                        {runTimeText(s.log)}
                      </p>
                    </div>
                    {cell(s, "avgHr")}
                  </div>
                  {treadmill && open(s) && (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Belt{r.planBelt !== null && belt !== r.planBelt ? ` · plan ${r.planBelt.toFixed(1)}` : ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <button type="button" onClick={() => moveBelt(r, -0.1)} disabled={belt === 0} aria-label={`Belt down 0.1 km/h step ${r.n}`} className={STEP_BTN}>
                          −
                        </button>
                        <span className="w-[4.5rem] text-center text-base font-semibold tabular-nums" data-testid={`result-belt-${r.n}`}>
                          {belt !== null ? belt.toFixed(1) : "–"}
                          <small className="ml-0.5 text-xs font-normal text-muted-foreground">km/h</small>
                        </span>
                        <button type="button" onClick={() => moveBelt(r, 0.1)} disabled={belt === BELT_MAX} aria-label={`Belt up 0.1 km/h step ${r.n}`} className={STEP_BTN}>
                          +
                        </button>
                      </span>
                    </div>
                  )}
                  {showMore && open(s) && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {more.map((f) => (
                        <label key={f} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {fieldLabel(f)}
                          {cell(s, f)}
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <button
          type="button"
          onClick={() => setShowMore((m) => !m)}
          aria-expanded={showMore}
          className="min-h-11 self-start text-sm font-medium text-primary active:opacity-70"
          data-testid="more-numbers"
        >
          {showMore ? "Fewer numbers" : treadmill ? "More numbers · max HR, cadence" : "More numbers · max HR, cadence, climbing"}
        </button>

        {askTotal && (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm">
            <span className="text-muted-foreground whitespace-nowrap">Total distance km</span>
            <input
              inputMode="decimal"
              value={total ?? totalKmText(steps)}
              placeholder="–"
              onChange={(e) => setTotal(e.target.value)}
              aria-label="Total distance km"
              aria-invalid={badTotal}
              className={`${FIELD} w-24 shrink-0 text-right`}
              data-testid="result-total-km"
            />
          </label>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">How hard was the run</p>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Effort of the run">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={effort === n}
                onClick={() => setEffort(effort === n ? null : n)}
                className={`min-h-11 rounded-xl text-base font-semibold active:opacity-70 ${effort === n ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">1 is very easy, 10 is all out.</p>
        </div>
      </div>

      <div data-pinned-bar className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-1 border-t border-border bg-background">
        {bad && (
          <p role="alert" className="text-sm text-center text-muted-foreground">
            Check the marked numbers.
          </p>
        )}
        <button
          type="button"
          onClick={() => void done()}
          disabled={saving || bad}
          className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
          data-testid="results-done"
        >
          {saving ? "Saving" : "Done"}
        </button>
      </div>
    </div>
  );
}
