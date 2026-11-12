"use client";

import { ThresholdEditor, type SuggestionView } from "@/components/features/ThresholdEditor";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { THRESHOLD_KINDS, type ThresholdKind, type ThresholdSource } from "@/db/schema/athlete-profile";
import { deleteThresholdValue, restoreThresholdValue } from "@/lib/actions/athlete-profile";
import { callAction } from "@/lib/utils/stale-bundle";
import { THRESHOLD_LABEL, currentThresholds, formatThreshold, isStale, weeksSince } from "@/lib/utils/thresholds";
import type { Units } from "@/lib/utils/units";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ThresholdView = { id: number; kind: ThresholdKind; value: number; measuredOn: string; source: ThresholdSource };
export type DeletedThresholdView = ThresholdView & { deletedOn: string };

const SOURCE_TEXT: Record<ThresholdSource, string> = {
  manual: "Entered",
  test: "Field test",
  garmin: "Garmin estimate",
};

/**
 * The Thresholds screen (docs/plans/athlete-profile.md, 2.9), for every user:
 * one row per kind with the current value, then a sheet to enter a new value
 * or a field test, with the history.
 */
export function ThresholdsClient({
  rows,
  deleted,
  suggestions,
  units,
  today,
}: {
  rows: ThresholdView[];
  deleted: DeletedThresholdView[];
  suggestions: SuggestionView[];
  units: Units;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<ThresholdKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = currentThresholds(rows);

  async function remove(id: number) {
    setError(null);
    const r = await callAction(deleteThresholdValue({ id }));
    if (!r.success) {
      setError(r.error);
      return;
    }
    // Back to the list, where the current value and Recently deleted show the change.
    setOpen(null);
    router.refresh();
  }

  async function restore(id: number) {
    setError(null);
    const r = await callAction(restoreThresholdValue({ id }));
    if (!r.success) setError(r.error);
    router.refresh();
  }

  const history = open ? rows.filter((r) => r.kind === open) : [];

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
      <p className="text-sm text-muted-foreground">
        Your thresholds anchor training zones and targets. Enter a value you know, or do a field test. Only you and
        your own connected assistant see them. Friends never do.
      </p>
      <div className="space-y-2">
        {THRESHOLD_KINDS.map((kind) => {
          const c = current[kind];
          const s = suggestions.find((x) => x.kind === kind);
          return (
            <button
              key={kind}
              onClick={() => {
                setError(null);
                setOpen(kind);
              }}
              className="w-full text-left rounded-xl bg-card px-4 py-3 min-h-[44px] active:opacity-60"
              data-testid={`threshold-${kind}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{THRESHOLD_LABEL[kind]}</span>
                <span className="text-sm">{c ? formatThreshold(kind, c.value, units) : "Not set"}</span>
              </div>
              {c && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {SOURCE_TEXT[c.source]} · {c.measuredOn}
                  {isStale(c.measuredOn, today) && ` · Last tested ${weeksSince(c.measuredOn, today)} weeks ago. Retest after a recovery week.`}
                </p>
              )}
              {s && <p className="mt-1 text-xs text-primary">Garmin estimate: {formatThreshold(kind, s.value, units)}</p>}
            </button>
          );
        })}
      </div>

      {deleted.length > 0 && (
        <details className="space-y-2">
          <summary className="min-h-[44px] flex items-center text-sm font-medium text-muted-foreground">
            Recently deleted ({deleted.length})
          </summary>
          <p className="text-xs text-muted-foreground">Deleted values can be restored for 90 days.</p>
          {deleted.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-2" data-testid="threshold-deleted">
              <div className="min-w-0">
                <p className="text-sm">
                  {THRESHOLD_LABEL[d.kind]} {formatThreshold(d.kind, d.value, units)}
                </p>
                <p className="text-xs text-muted-foreground">Deleted {d.deletedOn}</p>
              </div>
              <button onClick={() => restore(d.id)} className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60">
                Restore
              </button>
            </div>
          ))}
        </details>
      )}
      {error && !open && <p className="text-sm text-destructive">{error}</p>}

      <BottomSheet open={open !== null} onClose={() => setOpen(null)} blur>
        {open && (
          <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto">
            <h2 className="text-lg font-semibold">{THRESHOLD_LABEL[open]}</h2>
            <ThresholdEditor
              key={open}
              kind={open}
              units={units}
              suggestion={suggestions.find((s) => s.kind === open) ?? null}
              onSaved={() => {
                setOpen(null);
                router.refresh();
              }}
            />
            {history.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-2" data-testid="threshold-history-row">
                    <div>
                      <p className="text-sm">{formatThreshold(h.kind, h.value, units)}</p>
                      <p className="text-xs text-muted-foreground">
                        {SOURCE_TEXT[h.source]} · {h.measuredOn}
                      </p>
                    </div>
                    <button
                      onClick={() => remove(h.id)}
                      aria-label={`Delete ${formatThreshold(h.kind, h.value, units)} from ${h.measuredOn}`}
                      className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-destructive active:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </section>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
