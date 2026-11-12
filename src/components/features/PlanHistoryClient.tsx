"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { applyRejectedChange, restorePlanRevision } from "@/lib/actions/plan-revisions";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** One row of a program's or cycle's history, as the page passes it. */
export type HistoryRow = {
  id: number;
  action: "create" | "update" | "delete" | "restore" | "baseline" | "conflict";
  writer: "user" | "assistant" | "progression" | "sync" | "apply";
  clientName: string | null;
  reason: string | null;
  /** When, already formatted in the user's zone (shortDateTime). */
  when: string;
  changes: string[];
  /** A training limit the assistant went past on purpose, with its reason (docs/plans/ai-coach.md, 2.4). */
  override?: string | null;
};

const AUTOMATIC = new Set<HistoryRow["writer"]>(["progression", "sync", "apply"]);

function who(r: HistoryRow): string {
  if (r.action === "baseline") return "Before history started";
  switch (r.writer) {
    case "user":
      return "You";
    case "assistant":
      return r.clientName ?? "An assistant";
    case "progression":
      return "Progression";
    case "sync":
      return "Weekly sync";
    case "apply":
      return "Garmin suggestion";
  }
}

/** Runs of automatic rows fold into one line, so the user's and the assistant's changes stand out. */
type Item = { kind: "row"; row: HistoryRow; current: boolean } | { kind: "auto"; rows: HistoryRow[] };

function group(rows: HistoryRow[]): Item[] {
  const out: Item[] = [];
  rows.forEach((row, i) => {
    const current = i === 0;
    if (AUTOMATIC.has(row.writer) && !current) {
      const last = out[out.length - 1];
      if (last?.kind === "auto") last.rows.push(row);
      else out.push({ kind: "auto", rows: [row] });
    } else {
      out.push({ kind: "row", row, current });
    }
  });
  return out;
}

/**
 * The history list (docs/plans/revisions.md, 2.9): newest first, Restore on
 * every row but the newest, "Apply my value" on a change that was not applied.
 */
export function PlanHistoryClient({ kind, rows }: { kind: "program" | "cycle"; rows: HistoryRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<HistoryRow | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function restore() {
    if (!confirming) return;
    setSaving(true);
    setError(null);
    const result = await callAction(restorePlanRevision({ revisionId: confirming.id }));
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setConfirming(null);
    setNotice(result.data.skipped.length ? `Restored. ${result.data.skipped.join(". ")}.` : "Restored.");
    router.refresh();
  }

  async function applyMine(row: HistoryRow) {
    setError(null);
    const result = await callAction(applyRejectedChange({ revisionId: row.id }));
    if (!result.success) {
      setNotice(result.error);
      return;
    }
    setNotice("Your value is now in the plan.");
    router.refresh();
  }

  const renderRow = (row: HistoryRow, current: boolean) => (
    <div key={row.id} className="px-4 py-3 space-y-1" data-testid="history-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {who(row)}
            {row.action === "restore" && <span className="text-muted-foreground font-normal"> · restored</span>}
            {row.action === "conflict" && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-600">Not applied</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{row.when}</p>
        </div>
        {row.action === "conflict" ? (
          <button
            onClick={() => applyMine(row)}
            className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60"
          >
            Apply my value
          </button>
        ) : (
          !current && (
            <button
              onClick={() => {
                setError(null);
                setConfirming(row);
              }}
              className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60"
            >
              Restore
            </button>
          )
        )}
      </div>
      {row.reason && row.writer === "assistant" && <p className="text-sm italic text-muted-foreground">“{row.reason}”</p>}
      {row.override && (
        <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="limit-override">
          {row.override}
        </p>
      )}
      <ul className="text-sm space-y-0.5">
        {row.changes.slice(0, 8).map((c, i) => (
          <li key={i}>{c}</li>
        ))}
        {row.changes.length > 8 && <li className="text-muted-foreground">and {row.changes.length - 8} more</li>}
      </ul>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8">
      <p className="text-sm text-muted-foreground mb-4">
        Every change to this {kind}, by you, an assistant or the app. Restore brings the whole {kind} back to
        how it was then. Logged workouts never change.
      </p>
      {notice && (
        <p className="text-sm mb-3" role="status">
          {notice}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <div className="rounded-xl bg-card divide-y divide-border">
          {group(rows).map((item) =>
            item.kind === "row" ? (
              renderRow(item.row, item.current)
            ) : open.has(item.rows[0].id) ? (
              <div key={item.rows[0].id} className="divide-y divide-border">
                {item.rows.map((r) => renderRow(r, false))}
              </div>
            ) : (
              <button
                key={item.rows[0].id}
                onClick={() => setOpen((s) => new Set(s).add(item.rows[0].id))}
                className="w-full text-left px-4 py-3 min-h-[44px] text-sm text-muted-foreground active:opacity-60"
              >
                {item.rows.length === 1 ? "1 automatic change" : `${item.rows.length} automatic changes`}
              </button>
            ),
          )}
        </div>
      )}

      <BottomSheet open={confirming !== null} onClose={() => setConfirming(null)} blur>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4">
          <h2 className="text-lg font-semibold">Restore this version?</h2>
          <p className="text-sm text-muted-foreground">
            The {kind} goes back to how it was on {confirming?.when ?? ""}. Logged workouts do
            not change. Weekly targets from the cycle, and weights or reps progression set since then, keep their
            current values, and the weekly sync runs again. You can undo the restore from this list.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={restore}
            disabled={saving}
            className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
          >
            Restore
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
