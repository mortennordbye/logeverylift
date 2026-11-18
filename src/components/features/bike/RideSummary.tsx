"use client";

/**
 * The summary of a finished ride (docs/plans/bike-ride-logger.md, section 5
 * "Summary" and "Empty states", 4.6 and 4.8): time, avg W, NP, IF, load and
 * kJ tiles (NP and IF only from a Garmin stream), plan against done from the
 * stream, time in power zones (heart rate zones when there is no power), the
 * plan against what was done per step with ↓ under the target and the time on
 * target, heart rate drift, and the effort. Estimates say "est.". With nothing
 * but times, "Plan only" offers Add numbers. An ended-early ride says so and
 * counts only the ridden steps. A Garmin fill offers Undo (it asks first);
 * after an Undo with one Garmin ride, "Fill from Garmin" fills it again; two
 * matching Garmin rides offer Pick. An FTP test ride shows "New FTP 186 W · Save"
 * (4.9), which adds the threshold row.
 */

import { RideDoneChart, RideZoneBar } from "@/components/features/bike/RideProfileChart";
import { BackLink } from "@/components/ui/BackLink";
import { pickRideGarminActivity, undoRideGarminFill } from "@/lib/actions/ride-garmin";
import { saveRideFtp } from "@/lib/actions/ride-ftp";
import { startRide } from "@/lib/actions/rides";
import { armRide, disarmRide } from "@/components/features/bike/useRide";
import type { RideMode } from "@/db/schema/rides";
import type { FtpTestView } from "@/lib/utils/ftp-tests";
import type { RideGarminView } from "@/lib/ride-garmin";
import type { RideSummary as Summary } from "@/lib/utils/ride-results";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const COUNT_WORD = ["", "One", "Two", "Three", "Four", "Five"];

/** "17:02 · 65 min" for a Garmin ride to pick. */
function candidateText(c: RideGarminView["candidates"][number], timeZone: string | null) {
  const at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone && { timeZone }) }).format(new Date(c.startMs));
  return `${at} · ${Math.round(c.seconds / 60)} min`;
}

export function RideSummary({
  programId,
  exerciseName,
  doneLine,
  summary,
  doneHref,
  saveTheRide,
  rideId,
  garmin,
  timeZone = null,
  ftpTest = null,
  rideAgain = null,
}: {
  programId: number;
  exerciseName: string;
  doneLine: string;
  summary: Summary;
  doneHref: string;
  /** A one-exercise workout still open after a ride that ended with the app closed: ride mode saves it. */
  saveTheRide: boolean;
  rideId?: number;
  garmin?: Pick<RideGarminView, "state" | "candidates">;
  timeZone?: string | null;
  ftpTest?: FtpTestView | null;
  /** A ride that ended early: "Ride again" starts a new ride of this exercise on the same workout. */
  rideAgain?: { sessionId: number; programExerciseId: number; mode: RideMode } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (call: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const r = await callAction(call());
    setBusy(false);
    if (!r.success) {
      setError("error" in r && r.error ? r.error : "Failed");
      return;
    }
    setPicking(false);
    setConfirmUndo(false);
    router.refresh();
  };
  const again = async () => {
    if (!rideAgain || busy) return;
    setBusy(true);
    setError(null);
    // Inside the tap: sound and the screen wake lock need a user gesture (iOS).
    armRide();
    const r = await callAction(startRide({ ...rideAgain, clientId: crypto.randomUUID(), again: true }));
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
          {s.chart && (
            <div className="mt-3">
              <RideDoneChart chart={s.chart} />
            </div>
          )}
          {s.zones.length > 0 ? (
            <RideZoneBar zones={s.zones} label="Time in power zones" testId="summary-zones" />
          ) : (
            <RideZoneBar zones={s.hrZones} label="Time in heart rate zones" testId="summary-hr-zones" />
          )}
          {s.drift && (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums" data-testid="summary-drift">
              Heart rate drift {s.drift.pct.toFixed(1)}%{s.drift.steady ? " · steady" : ""}
            </p>
          )}
        </div>

        {rideId !== undefined && ftpTest?.result && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm" data-testid="summary-ftp">
            <span className="font-semibold tabular-nums">
              New FTP {ftpTest.result.ftp} W{ftpTest.result.estimated && <small className="ml-1 text-xs font-normal text-muted-foreground">est.</small>}
            </span>
            {ftpTest.saved ? (
              <span className="min-h-11 px-3 inline-flex items-center text-muted-foreground">Saved</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => saveRideFtp({ rideId }))}
                className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70 disabled:opacity-50"
              >
                Save
              </button>
            )}
          </div>
        )}

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

        {rideId !== undefined && garmin?.state === "filled" && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border pl-4 pr-2 min-h-12 text-sm" data-testid="summary-garmin">
            {confirmUndo ? (
              <>
                <span className="text-muted-foreground">Remove the Garmin numbers?</span>
                <span className="flex">
                  <button type="button" onClick={() => setConfirmUndo(false)} className="min-h-11 px-3 text-muted-foreground whitespace-nowrap active:opacity-70">
                    Keep
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => undoRideGarminFill({ rideId }))}
                    className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">Steps filled from Garmin</span>
                <button type="button" onClick={() => setConfirmUndo(true)} className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70">
                  Undo
                </button>
              </>
            )}
          </div>
        )}
        {rideId !== undefined && garmin?.state === "refill" && garmin.candidates[0] && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border pl-4 pr-2 min-h-12 text-sm" data-testid="summary-garmin-refill">
            <span className="text-muted-foreground">Garmin numbers removed</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => pickRideGarminActivity({ rideId, garminActivityId: garmin.candidates[0].garminActivityId }))}
              className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70 disabled:opacity-50"
            >
              Fill from Garmin
            </button>
          </div>
        )}
        {rideId !== undefined && garmin?.state === "pick" && (
          <div className="rounded-xl border border-dashed border-border text-sm" data-testid="summary-garmin-pick">
            <div className="flex items-center justify-between gap-2 pl-4 pr-2 min-h-12">
              <span className="text-muted-foreground">{COUNT_WORD[garmin.candidates.length] ?? garmin.candidates.length} Garmin rides match</span>
              <button
                type="button"
                aria-expanded={picking}
                onClick={() => setPicking((p) => !p)}
                className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70"
              >
                Pick
              </button>
            </div>
            {picking && (
              <ul className="divide-y divide-border border-t border-border">
                {garmin.candidates.map((c) => (
                  <li key={c.garminActivityId}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => pickRideGarminActivity({ rideId, garminActivityId: c.garminActivityId }))}
                      className="w-full min-h-11 px-4 text-left tabular-nums active:bg-background disabled:opacity-50"
                    >
                      {candidateText(c, timeZone)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-2 border-t border-border bg-background">
        {rideAgain && (
          <button
            type="button"
            onClick={again}
            disabled={busy}
            className="min-h-12 rounded-2xl bg-muted px-4 text-base font-semibold inline-flex items-center justify-center active:opacity-70 disabled:opacity-50"
            data-testid="summary-ride-again"
          >
            Ride again
          </button>
        )}
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
