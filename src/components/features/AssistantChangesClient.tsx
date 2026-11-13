"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { undoPlanChangeSet } from "@/lib/actions/plan-revisions";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ChangeSetCard = {
  changeSetId: string;
  clientName: string;
  /** When the change set started, formatted in the user's zone. */
  when: string;
  reasons: string[];
  /** Training limits the assistant went past on purpose, with its reason. */
  overrides: string[];
  objects: { type: "program" | "cycle" | "memory" | "athlete" | "threshold" | "injury" | "season" | "planned_session" | "workout" | "illness" | "race_plan"; id: number; name: string; changes: string[] }[];
};

const HREF: Record<ChangeSetCard["objects"][number]["type"], (id: number) => string> = {
  program: (id) => `/programs/${id}/history`,
  cycle: (id) => `/cycles/${id}/history`,
  memory: () => "/more/coach-memory",
  athlete: () => "/more/athlete",
  threshold: () => "/more/thresholds",
  injury: () => "/more/athlete",
  season: (id) => `/seasons/${id}/history`,
  planned_session: () => "/more/calendar",
  workout: () => "/more/workouts",
  illness: () => "/more/athlete",
  race_plan: () => "/more/nutrition",
};

/**
 * The AI changes feed (docs/plans/revisions.md, 2.9): one card per assistant
 * change set, with "Undo these changes".
 */
export function AssistantChangesClient({ sets }: { sets: ChangeSetCard[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<ChangeSetCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function undo() {
    if (!confirming) return;
    setSaving(true);
    setError(null);
    const result = await callAction(undoPlanChangeSet({ changeSetId: confirming.changeSetId }));
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setConfirming(null);
    setNotice("Undone. The undo is in each plan's history, so you can restore the changes again.");
    router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
      <p className="text-sm text-muted-foreground">
        Changes your assistants made to your programs, cycles, coach memory and athlete profile, grouped by conversation. Logged
        workouts never change.
      </p>
      {notice && (
        <p className="text-sm" role="status">
          {notice}
        </p>
      )}
      {sets.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="assistant-changes-empty">
          No assistant changes yet.
        </p>
      ) : (
        sets.map((s) => (
          <div key={s.changeSetId} className="rounded-xl bg-card px-4 py-3 space-y-2" data-testid="change-set">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{s.clientName}</p>
                <p className="text-xs text-muted-foreground">{s.when}</p>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setConfirming(s);
                }}
                className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60"
              >
                Undo
              </button>
            </div>
            {s.reasons.map((r, i) => (
              <p key={i} className="text-sm italic text-muted-foreground">
                “{r}”
              </p>
            ))}
            {s.overrides.map((line, i) => (
              <p key={i} className="text-sm text-amber-700 dark:text-amber-400" data-testid="limit-override">
                {line}
              </p>
            ))}
            {s.objects.map((o) => (
              <div key={`${o.type}:${o.id}`} className="text-sm">
                <Link
                  href={HREF[o.type](o.id)}
                  className="font-medium text-primary active:opacity-60"
                >
                  {o.name}
                </Link>
                <ul className="mt-0.5 space-y-0.5">
                  {o.changes.slice(0, 6).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                  {o.changes.length > 6 && <li className="text-muted-foreground">and {o.changes.length - 6} more</li>}
                </ul>
              </div>
            ))}
          </div>
        ))
      )}

      <BottomSheet open={confirming !== null} onClose={() => setConfirming(null)} blur>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4">
          <h2 className="text-lg font-semibold">Undo these changes?</h2>
          <p className="text-sm text-muted-foreground">
            Each plan {confirming?.clientName ?? "the assistant"} changed goes back to how it was before. Changes made
            to the same plans after this are undone too. Logged workouts do not change.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={undo}
            disabled={saving}
            className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
          >
            Undo
          </button>
          <button
            onClick={() => setConfirming(null)}
            disabled={saving}
            className="w-full rounded-xl bg-muted py-4 text-sm font-semibold disabled:opacity-50 active:opacity-80"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
