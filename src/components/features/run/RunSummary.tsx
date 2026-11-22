"use client";

/**
 * The summary of a run (docs/plans/run-logger.md, section 5 "Run done / Run
 * ended early" and "Summary", 4.9): time, distance with its source, pace
 * (with GAP when an incline changes it), avg HR, load marked "est." and the
 * effort; time in heart rate zones by step; plan against done per step in the
 * same units, with ↑ over a cap or above a range and ↓ under a range (4.2).
 * A run that ended early says which steps are saved and asks why (R15), and
 * offers "Run again". A brick run shows the ride, T2 and the run. With
 * nothing but times, "Plan only" offers Add numbers. With a Garmin fill
 * (step 7): drift, the plan against done chart, zones from the stream, time
 * on target per step, and the Garmin controls (Undo, Fill from Garmin, Pick).
 */

import { GarminFill } from "@/components/features/bike/GarminFill";
import { RideDoneChart, RideZoneBar } from "@/components/features/bike/RideProfileChart";
import { armRide, disarmRide } from "@/components/features/bike/useRide";
import { RunEndReason } from "@/components/features/run/RunEndReason";
import { RunTestLine } from "@/components/features/run/RunTestLine";
import type { RunTestView } from "@/lib/utils/run-test";
import { BackLink } from "@/components/ui/BackLink";
import type { EndReason, RideMode, RunSurface } from "@/db/schema/rides";
import type { RideGarminView } from "@/lib/ride-garmin";
import { startRide } from "@/lib/actions/rides";
import type { RunSummary as Summary } from "@/lib/utils/run-results";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export function RunSummary({
  programId,
  exerciseName,
  doneLine,
  summary,
  rideId,
  early,
  brickLine = null,
  doneHref,
  saveTheRun,
  runAgain = null,
  garmin,
  timeZone = null,
  thresholdTest = null,
  match = null,
}: {
  /** The planned session's match block (docs/plans/session-check.md, decision 4). */
  match?: React.ReactNode;
  programId: number;
  exerciseName: string;
  doneLine: string;
  summary: Summary;
  rideId: number;
  /** A run that ended early: the saved steps and the reason (R15). */
  early: { kept: string; endReason: EndReason | null } | null;
  /** "Brick · ride 60:00 · T2 1:12 · run 40:00". */
  brickLine?: string | null;
  doneHref: string;
  /** The workout is still open after a run that ended with the app closed: run mode saves it. */
  saveTheRun: boolean;
  /** A run that ended early: "Run again" starts a new run of this exercise on the same workout. */
  runAgain?: { sessionId: number; programExerciseId: number; mode: RideMode; surface: RunSurface | null } | null;
  garmin?: Pick<RideGarminView, "state" | "candidates">;
  timeZone?: string | null;
  /** A run threshold test (4.10): "New threshold pace 5:30 /km · LTHR 176 · Save". */
  thresholdTest?: RunTestView | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const again = async () => {
    if (!runAgain || busy) return;
    setBusy(true);
    setError(null);
    // Inside the tap: sound and the screen wake lock need a user gesture (iOS).
    armRide();
    const { surface, ...rest } = runAgain;
    const treadmill = runAgain.mode === "indoor";
    const r = await callAction(
      startRide({ ...rest, ...(!treadmill && surface && { surface }), ...(treadmill && { countIn: true }), clientId: crypto.randomUUID(), again: true }),
    );
    if (r.success) {
      router.replace(`${pathname}?ride=1`);
      return;
    }
    disarmRide();
    setBusy(false);
    setError(r.error);
  };
  const addHref = `${pathname}?results=1`;
  const s = summary;
  const cols = Math.min(3, s.tiles.length);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="run-summary-screen">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
        <Link href={addHref} className="text-primary text-sm font-medium min-h-11 px-1 inline-flex items-center active:opacity-70" data-testid="summary-edit">
          Edit
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{exerciseName}</p>
          <h1 className="text-3xl font-bold tracking-tight">{early ? "Run ended early" : "Run done"}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums" data-testid="summary-line">
            {doneLine}
          </p>
          {brickLine && (
            <p className="text-sm text-muted-foreground tabular-nums" data-testid="summary-brick">
              {brickLine}
            </p>
          )}
        </div>

        {early && <RunEndReason rideId={rideId} kept={early.kept} endReason={early.endReason} />}

        <div className="rounded-2xl bg-muted px-3 py-3">
          <div className="grid gap-y-3 gap-x-2 text-center" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="summary-tiles">
            {s.tiles.map((t) => (
              <div key={t.label} data-testid={`tile-${t.label}`}>
                <p className="text-[11px] text-muted-foreground">{t.label}</p>
                <p className="text-xl font-bold tabular-nums leading-tight whitespace-nowrap">
                  {t.value.replace(/ \/km$/, "")}
                  {t.value.endsWith(" /km") && <small className="ml-0.5 text-xs font-normal text-muted-foreground">/km</small>}
                  {t.est && <small className="ml-1 text-xs font-normal text-muted-foreground">est.</small>}
                </p>
                {t.sub && <p className="text-[11px] text-muted-foreground tabular-nums">{t.sub}</p>}
              </div>
            ))}
          </div>
          {s.distanceLine && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="summary-distance-source">
              {s.distanceLine}
            </p>
          )}
          {s.chart && (
            <div className="mt-3">
              <RideDoneChart chart={s.chart} lineName={s.treadmill ? "Belt" : "Pace"} />
            </div>
          )}
          <RideZoneBar zones={s.zones} label="Time in heart rate zones" testId="summary-hr-zones" />
        </div>

        {thresholdTest && <RunTestLine rideId={rideId} test={thresholdTest} />}

        {!s.planOnly && s.noLoadReason === "short" && (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground" data-testid="summary-no-load">
            No load · the run is too short to count
          </p>
        )}
        {(s.planOnly || s.noLoadReason === "numbers" || s.noLoadReason === "effort") && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm" data-testid="summary-plan-only">
            <span className="text-muted-foreground">{s.planOnly ? "Plan only · no run numbers" : s.noLoadReason === "effort" ? "No load without effort" : "No load without effort or distance"}</span>
            <Link href={addHref} className="min-h-11 px-3 inline-flex items-center font-semibold text-primary whitespace-nowrap active:opacity-70">
              Add numbers
            </Link>
          </div>
        )}

        <div>
          <div className="rounded-2xl bg-muted" data-testid="summary-steps">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 px-3 pt-2.5 pb-1 text-xs text-muted-foreground" aria-hidden>
              <span>Step</span>
              <span className="text-right">Plan</span>
              <span className="min-w-20 text-right">Done</span>
            </div>
            <ol className="divide-y divide-border">
              {s.rows.map((r) => (
                <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 min-h-11 py-2 text-sm" data-testid="summary-row">
                  {/* The round ("1 of 3") on its own line, so a narrow phone never cuts it off. */}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold" data-testid="row-name">
                      {r.title.split(" · ")[0]}
                    </span>
                    {r.title.includes(" · ") && (
                      <span className="block truncate text-xs text-muted-foreground" data-testid="row-round">
                        {r.title.split(" · ").slice(1).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums whitespace-nowrap">{r.plan ?? "–"}</span>
                  <span className={`min-w-20 text-right tabular-nums whitespace-nowrap ${r.quiet ? "text-muted-foreground" : "font-semibold"}`}>
                    {(() => {
                      const arrow = (m: "↑" | "↓" | null) =>
                        m && (
                          <span aria-label={m === "↑" ? "over target" : "under target"} className="ml-0.5">
                            {m}
                          </span>
                        );
                      // Each arrow follows the value it judges: the belt or pace first, the heart rate after it.
                      const hrAt = r.done.indexOf("HR ");
                      if (hrAt < 0)
                        return (
                          <>
                            {r.done}
                            {arrow(r.mark)}
                          </>
                        );
                      // "8.5 · HR 146": the belt, its arrow, then " · HR 146" and the heart rate's arrow.
                      const cut = Math.max(0, hrAt - 3);
                      return (
                        <>
                          {r.done.slice(0, cut)}
                          {cut > 0 && arrow(r.mark)}
                          {r.done.slice(cut)}
                          {arrow(r.hrMark)}
                        </>
                      );
                    })()}
                    {r.extra && (
                      <small className="block text-[11px] font-normal text-muted-foreground" data-testid="row-extra">
                        {r.extra}
                      </small>
                    )}
                    {r.onTarget !== null && (
                      <small className="block text-[11px] font-normal text-muted-foreground" data-testid="row-on-target">
                        {r.onTarget}% on target
                      </small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-1.5 px-1 text-xs text-muted-foreground" data-testid="summary-footnote">
            {s.footnote}
          </p>
        </div>

        {match}
        {garmin && <GarminFill rideId={rideId} garmin={garmin} timeZone={timeZone} noun="runs" />}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div data-pinned-bar className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-2 border-t border-border bg-background">
        {runAgain && (
          <button
            type="button"
            onClick={again}
            disabled={busy}
            className="min-h-12 rounded-2xl bg-muted px-4 text-base font-semibold inline-flex items-center justify-center active:opacity-70 disabled:opacity-50"
            data-testid="summary-run-again"
          >
            Run again
          </button>
        )}
        <Link
          href={saveTheRun ? `${pathname}?ride=1` : doneHref}
          className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80"
          data-testid="summary-done"
        >
          {saveTheRun ? "Save the run" : "Done"}
        </Link>
      </div>
    </div>
  );
}
