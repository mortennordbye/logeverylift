"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { addCoachMemoryEntry, deleteCoachMemoryEntry, updateCoachMemoryEntry } from "@/lib/actions/coach-memory";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

const KINDS = ["preference", "limit", "observation", "decision"] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  preference: "Preferences",
  limit: "Limits in your life",
  observation: "Observations",
  decision: "Decisions",
};
const KIND_ONE: Record<Kind, string> = {
  preference: "Preference",
  limit: "Life limit",
  observation: "Observation",
  decision: "Decision",
};

export type MemoryRow = { id: number; kind: Kind; text: string; date: string; active: boolean; by: string };

type Draft = { id: number | null; kind: Kind; text: string; active: boolean };

/**
 * The coach memory screen: entries by kind, add and edit in a sheet, switch
 * an entry off, delete at the bottom of the sheet with a confirm.
 */
export function CoachMemoryClient({ entries }: { entries: MemoryRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = entries.filter((e) => e.active);
  const inactive = entries.filter((e) => !e.active);

  function open(d: Draft) {
    setError(null);
    setConfirmDelete(false);
    setDraft(d);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const result = draft.id
      ? await callAction(updateCoachMemoryEntry({ id: draft.id, kind: draft.kind, text: draft.text, active: draft.active }))
      : await callAction(addCoachMemoryEntry({ kind: draft.kind, text: draft.text }));
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    setSaving(true);
    const result = await callAction(deleteCoachMemoryEntry({ id: draft.id }));
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  const row = (e: MemoryRow) => (
    <button
      key={e.id}
      onClick={() => open({ id: e.id, kind: e.kind, text: e.text, active: e.active })}
      className="w-full text-left rounded-xl bg-card px-4 py-3 min-h-[44px] active:opacity-60"
      data-testid="memory-entry"
    >
      <p className="text-sm whitespace-pre-wrap">{e.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {e.date} · {e.by === "You" ? "Added by you" : e.by}
      </p>
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-5">
      <p className="text-sm text-muted-foreground">
        What your connected assistant keeps between conversations: your preferences, limits, what it noticed and what
        you agreed. Only your own assistant reads it. Friends never see it.
      </p>
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="memory-empty">
          Nothing yet. Your assistant adds entries as you talk, or add one yourself.
        </p>
      )}
      {KINDS.map((k) => {
        const rows = active.filter((e) => e.kind === k);
        if (rows.length === 0) return null;
        return (
          <section key={k} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[k]}</h2>
            {rows.map(row)}
          </section>
        );
      })}
      {inactive.length > 0 && (
        <details className="space-y-2">
          <summary className="min-h-[44px] flex items-center text-sm font-medium text-muted-foreground">
            Not in use ({inactive.length})
          </summary>
          <div className="space-y-2 pt-2">{inactive.map(row)}</div>
        </details>
      )}

      {/* Pinned above the bottom navigation (4rem, as pb-nav-safe). */}
      <div
        className="fixed inset-x-0 px-4 pb-4 pt-2 bg-background/95"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          onClick={() => open({ id: null, kind: "preference", text: "", active: true })}
          className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground active:opacity-80"
        >
          Add an entry
        </button>
      </div>

      <BottomSheet open={draft !== null} onClose={() => setDraft(null)} blur>
        {draft && (
          <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4">
            <h2 className="text-lg font-semibold">{draft.id ? "Edit entry" : "New entry"}</h2>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind">
              {KINDS.map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={draft.kind === k}
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={`min-h-[44px] rounded-xl text-sm font-medium active:opacity-70 ${
                    draft.kind === k ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {KIND_ONE[k]}
                </button>
              ))}
            </div>
            <textarea
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              maxLength={1000}
              rows={4}
              aria-label="Entry"
              placeholder="For example: long rides on Saturday, never before 8"
              className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
            />
            {draft.id && (
              <button
                role="switch"
                aria-checked={draft.active}
                onClick={() => setDraft({ ...draft, active: !draft.active })}
                className="w-full min-h-[44px] flex items-center justify-between rounded-xl bg-muted px-4 text-sm active:opacity-70"
              >
                In use
                <span className="font-medium">{draft.active ? "On" : "Off"}</span>
              </button>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={save}
              disabled={saving || !draft.text.trim()}
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              Save
            </button>
            {draft.id &&
              (confirmDelete ? (
                <button
                  onClick={remove}
                  disabled={saving}
                  className="w-full rounded-xl bg-destructive py-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50 active:opacity-80"
                >
                  Delete for sure
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full min-h-[44px] text-sm font-medium text-destructive active:opacity-60"
                >
                  Delete entry
                </button>
              ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
