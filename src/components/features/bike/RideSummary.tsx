"use client";

/**
 * The summary of a finished ride (docs/plans/bike-ride-logger.md, section 5
 * "Summary" and "Empty states", 4.6): time, avg W, load and kJ tiles (NP and
 * IF only from a Garmin stream, step 7), time in power zones by step average,
 * the plan against what was done per step with ↓ under the target, and the
 * effort. Estimates say "est.". With nothing but times, "Plan only" offers
 * Add numbers. An ended-early ride says so and counts only the ridden steps.
 */

import { RideZoneBar } from "@/components/features/bike/RideProfileChart";
import { BackLink } from "@/components/ui/BackLink";
import type { RideSummary as Summary } from "@/lib/utils/ride-results";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function RideSummary({
  programId,
  exerciseName,
  doneLine,
  summary,
  doneHref,
  saveTheRide,
}: {
  programId: number;
  exerciseName: string;
  doneLine: string;
  summary: Summary;
  doneHref: string;
  /** A one-exercise workout still open after a ride that ended with the app closed: ride mode saves it. */
  saveTheRide: boolean;
}) {
  const pathname = usePathname();
  const addHref = `${pathname}?results=1`;
  const s = summary;
  const cols = Math.min(3, s.tiles.length);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="ride-summary-screen">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
        <Link href={addHref} className="text-primary text-sm font-medium min-h-11 px-1 inline-flex items-center active:opacity-70" data-testid="summary-edit">
          Edit
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{exerciseName}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums" data-testid="summary-line">
            {doneLine}
          </p>
        </div>

        <div className="rounded-2xl bg-muted px-3 py-3">
          <div className="grid gap-y-3 gap-x-2 text-center" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="summary-tiles">
            {s.tiles.map((t) => (
              <div key={t.label} data-testid={`tile-${t.label}`}>
                <p className="text-[11px] text-muted-foreground">{t.label}</p>
                <p className="text-xl font-bold tabular-nums leading-tight">
                  {t.value}
                  {t.est && <small className="ml-1 text-xs font-normal text-muted-foreground">est.</small>}
                </p>
              </div>
            ))}
          </div>
          <RideZoneBar zones={s.zones} label="Time in power zones" testId="summary-zones" />
        </div>

        {(s.planOnly || s.noLoad) && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm" data-testid="summary-plan-only">
            <span className="text-muted-foreground">{s.planOnly ? "Plan only · no ride numbers" : "No load without effort or watts"}</span>
            <Link href={addHref} className="min-h-11 px-3 inline-flex items-center font-semibold text-primary whitespace-nowrap active:opacity-70">
              Add numbers
            </Link>
          </div>
        )}

        <div className="rounded-2xl bg-muted" data-testid="summary-steps">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 px-3 pt-2.5 pb-1 text-xs text-muted-foreground" aria-hidden>
            <span>Step</span>
            <span className="text-right">Plan</span>
            <span className="w-20 text-right">Done</span>
          </div>
          <ol className="divide-y divide-border">
            {s.rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 min-h-11 py-2 text-sm" data-testid="summary-row">
                <span className="truncate font-semibold">{r.title}</span>
                <span className="text-right text-muted-foreground tabular-nums whitespace-nowrap">{r.plan ?? "–"}</span>
                <span className={`w-20 text-right tabular-nums whitespace-nowrap ${r.done === "Skipped" || r.done === "Not ridden" ? "text-muted-foreground" : "font-semibold"}`}>
                  {r.done}
                  {r.under && (
                    <span aria-label="under target" className="ml-0.5">
                      ↓
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-1 border-t border-border bg-background">
        <Link
          href={saveTheRide ? `${pathname}?ride=1` : doneHref}
          className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80"
          data-testid="summary-done"
        >
          {saveTheRide ? "Save the ride" : "Done"}
        </Link>
      </div>
    </div>
  );
}
