"use client";

/**
 * Step alerts on this device (docs/plans/bike-ride-logger.md, 4.7 and section
 * 5 "Empty states"): the hook reads the device's state, and the row on the
 * bike screen says when alerts are off and why, with "Turn on" where a tap
 * can fix it. Nothing shows while alerts are on.
 */

import { detectStepAlerts, turnOnStepAlerts, type StepAlertsState } from "@/lib/push-client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export function useStepAlerts(publicKey: string | null) {
  const [state, setState] = useState<StepAlertsState>(publicKey ? "checking" : "server_off");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    let gone = false;
    void detectStepAlerts(publicKey).then((s) => {
      if (!gone) setState(s);
    });
    return () => {
      gone = true;
    };
  }, [publicKey]);

  const turnOn = useCallback(async () => {
    if (!publicKey || busy) return;
    setBusy(true);
    setError(null);
    const r = await turnOnStepAlerts(publicKey);
    setState(r.state);
    setError(r.error ?? null);
    setBusy(false);
  }, [publicKey, busy]);

  return { state, busy, error, turnOn };
}

const WHY: Partial<Record<StepAlertsState, string>> = {
  unsupported: "This browser cannot show them",
  blocked: "Notifications are blocked in your phone's settings",
};

/** "Step alerts are off", with the reason or the fix. Shown before the start only. */
export function StepAlertsRow({
  state,
  busy,
  error,
  onTurnOn,
  hint,
}: {
  state: StepAlertsState;
  busy: boolean;
  error: string | null;
  onTurnOn: () => void;
  /** What to do without alerts, after "Step alerts are off" (an outdoor run, docs/plans/run-logger.md 4.6). */
  hint?: string;
}) {
  if (state === "on" || state === "checking") return null;
  if (state === "home_screen") {
    // The whole row is the link, so the tap target is the row.
    return (
      <Link href="/more/install" className="flex flex-col justify-center rounded-xl bg-muted px-4 min-h-12 py-1 text-sm active:opacity-70" data-testid="step-alerts">
        <span className="text-muted-foreground">Step alerts are off</span>
        <span className="text-xs font-medium text-primary">Add the app to your home screen first</span>
      </Link>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-4 pr-2 min-h-12 py-1 text-sm" data-testid="step-alerts">
      <div className="min-w-0">
        <p className="text-muted-foreground">Step alerts are off{hint ? ` · ${hint}` : ""}</p>
        {WHY[state] && <p className="text-xs text-muted-foreground">{WHY[state]}</p>}
        {error && (
          <p role="alert" className="text-xs text-muted-foreground">
            {error}
          </p>
        )}
      </div>
      {state === "off" && (
        <button type="button" onClick={onTurnOn} disabled={busy} className="min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70 disabled:opacity-50">
          Turn on
        </button>
      )}
    </div>
  );
}
