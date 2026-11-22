"use client";

/**
 * The match of a planned session (docs/plans/session-check.md, decisions 4
 * and 5): Program, how it was logged, the Garmin activity (tap to open it),
 * the fill line and "See every step". With nothing matched, "Not matched ·
 * 1 run that day" and Pick, a sheet of that day's activities of the sport;
 * a watch match offers Pick another. The words come from `matchBlockView`.
 */

import { BottomSheet } from "@/components/ui/BottomSheet";
import { pickSessionActivity } from "@/lib/actions/session-match";
import type { MatchBlockView } from "@/lib/utils/session-match";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ROW = "flex items-center gap-3 min-h-11 px-3 py-2 text-sm";
const LABEL = "w-16 shrink-0 text-muted-foreground";

export function SessionMatchBlock({ plannedSessionId, view }: { plannedSessionId: number; view: MatchBlockView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const g = view.garmin;

  const pick = async (activityId: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await callAction(pickSessionActivity({ plannedSessionId, activityId }));
    setBusy(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  if (!view.program && !view.logged && !g && !view.stepsHref) return null;

  return (
    <section className="rounded-2xl bg-muted divide-y divide-border" data-testid="session-match">
      {view.program && (
        <Link href={view.program.href} className={`${ROW} active:opacity-70`} data-testid="match-program">
          <span className={LABEL}>Program</span>
          <span className="min-w-0 flex-1 truncate">{view.program.text}</span>
          <span aria-hidden className="text-muted-foreground">
            ›
          </span>
        </Link>
      )}
      {view.logged && (
        <div className={ROW} data-testid="match-logged">
          <span className={LABEL}>Logged</span>
          <span className="min-w-0 flex-1 truncate">{view.logged}</span>
          <span aria-hidden className="text-muted-foreground">
            ✓
          </span>
        </div>
      )}
      {g?.kind === "matched" && (
        <div>
          <Link href={g.href} className={`${ROW} active:opacity-70`} data-testid="match-garmin">
            <span className={LABEL}>Garmin</span>
            <span className="min-w-0 flex-1 truncate">
              {g.name} <small className="text-muted-foreground tabular-nums">· {g.detail}</small>
            </span>
            <span aria-hidden className="text-muted-foreground">
              ›
            </span>
          </Link>
          {view.fill && (
            <p className="px-3 pb-2 text-xs text-muted-foreground" data-testid="match-fill">
              {view.fill}
            </p>
          )}
          {g.pickAnother && (
            <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-3 text-sm font-medium text-primary active:opacity-70">
              Pick another
            </button>
          )}
        </div>
      )}
      {g?.kind === "none" && (
        <div className={ROW} data-testid="match-garmin">
          <span className={LABEL}>Garmin</span>
          <span className="min-w-0 flex-1 truncate">{g.text}</span>
          {g.pick && (
            <button type="button" onClick={() => setOpen(true)} className="-my-2 -mr-3 min-h-11 px-3 font-semibold text-primary whitespace-nowrap active:opacity-70">
              Pick ›
            </button>
          )}
        </div>
      )}
      {view.stepsHref && (
        <Link href={view.stepsHref} className={`${ROW} font-medium text-primary active:opacity-70`} data-testid="match-steps">
          See every step ›
        </Link>
      )}
      {error && !open && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-3 max-h-[85dvh] overflow-y-auto">
          <h2 className="text-lg font-semibold">Pick the Garmin activity</h2>
          <ul className="flex flex-col gap-2" data-testid="match-candidates">
            {view.candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pick(c.id)}
                  className="w-full min-h-12 rounded-xl bg-muted px-4 py-2 text-left active:opacity-70 disabled:opacity-50"
                >
                  <span className="block text-sm font-semibold">{c.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">{c.detail}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button type="button" onClick={() => setOpen(false)} className="w-full min-h-12 rounded-xl text-base text-muted-foreground active:opacity-70">
            Cancel
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
