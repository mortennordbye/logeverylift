"use client";

/**
 * The Garmin controls of a ride's or a run's summary
 * (docs/plans/bike-ride-logger.md 4.8, docs/plans/run-logger.md 4.8): "Steps
 * filled from Garmin" with Undo (it asks first); after an Undo with one
 * Garmin activity, "Fill from Garmin" fills it again; two or more matching
 * Garmin activities offer Pick, each with its start and time (a run's with
 * its distance too).
 */

import { pickRideGarminActivity, undoRideGarminFill } from "@/lib/actions/ride-garmin";
import type { RideGarminView } from "@/lib/ride-garmin";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

const COUNT_WORD = ["", "One", "Two", "Three", "Four", "Five"];

/** "17:02 · 65 min" for a Garmin ride to pick; a run adds its distance, "17:02 · 40 min · 7.8 km". */
function candidateText(c: RideGarminView["candidates"][number], timeZone: string | null) {
  const at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone && { timeZone }) }).format(new Date(c.startMs));
  return [at, `${Math.round(c.seconds / 60)} min`, ...(c.meters ? [`${(c.meters / 1000).toFixed(1)} km`] : [])].join(" · ");
}

export function GarminFill({
  rideId,
  garmin,
  timeZone,
  noun,
}: {
  rideId: number;
  garmin: Pick<RideGarminView, "state" | "candidates">;
  timeZone: string | null;
  /** "rides" or "runs": "Two Garmin runs match". */
  noun: "rides" | "runs";
}) {
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

  return (
    <>
        {garmin?.state === "filled" && (
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
        {garmin?.state === "refill" && garmin.candidates[0] && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border pl-4 pr-2 min-h-12 text-sm" data-testid="summary-garmin-refill">
            <span className="text-muted-foreground">Garmin numbers removed</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => pickRideGarminActivity({ rideId, garminActivityId: garmin.candidates[0].garminActivityId, ...(garmin.candidates[0].segment !== undefined && { segment: garmin.candidates[0].segment }) }))}
              className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70 disabled:opacity-50"
            >
              Fill from Garmin
            </button>
          </div>
        )}
        {garmin?.state === "pick" && (
          <div className="rounded-xl border border-dashed border-border text-sm" data-testid="summary-garmin-pick">
            <div className="flex items-center justify-between gap-2 pl-4 pr-2 min-h-12">
              <span className="text-muted-foreground">{COUNT_WORD[garmin.candidates.length] ?? garmin.candidates.length} Garmin {noun} match</span>
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
                  <li key={`${c.garminActivityId}-${c.segment ?? 0}`}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => pickRideGarminActivity({ rideId, garminActivityId: c.garminActivityId, ...(c.segment !== undefined && { segment: c.segment }) }))}
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
    </>
  );
}
