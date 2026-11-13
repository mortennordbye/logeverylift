"use client";

/**
 * Sick periods from the app (docs/plans/workouts-and-compliance.md, 6.7 and
 * 7): the sheet to add or change one, and the "I'm better" control that ends
 * an open one. Endurance features only (D18).
 */

import { BottomSheet } from "@/components/ui/BottomSheet";
import { manageIllness } from "@/lib/actions/workouts-compliance";
import { SEVERITY_TEXT, type IllnessSeverity } from "@/lib/utils/session-compliance";
import { addDaysStr } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { useState } from "react";

export type IllnessDraft = {
  id?: number;
  startedOn: string;
  endedOn: string | null;
  severity: IllnessSeverity | null;
  notes: string | null;
};

const SEVERITIES: IllnessSeverity[] = ["mild", "moderate", "severe"];
const SEVERITY_LABEL: Record<IllnessSeverity, string> = { mild: "Mild", moderate: "Moderate", severe: "Severe" };

/** `YYYY-MM-DD` as "Thu 14 Nov", by the calendar (no time zone). */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const field = "mt-1 w-full min-h-[44px] rounded-xl bg-muted px-4 text-base";
const chip = (on: boolean) => `min-h-[44px] rounded-xl px-4 py-2 text-left text-sm font-medium active:opacity-70 ${on ? "bg-primary text-primary-foreground" : "bg-muted"}`;

/** Add or change one sick period; delete at the bottom with a confirm. */
export function IllnessSheet({
  draft,
  today,
  onClose,
  onSaved,
}: {
  draft: IllnessDraft | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<IllnessDraft | null>(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDraft, setLastDraft] = useState(draft);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    setD(draft);
    setConfirmDelete(false);
    setError(null);
  }

  async function save() {
    if (!d) return;
    setSaving(true);
    setError(null);
    const fields = { startedOn: d.startedOn, endedOn: d.endedOn, severity: d.severity, notes: d.notes?.trim() ? d.notes.trim() : null };
    const r = await callAction(manageIllness(d.id ? { op: "update", id: d.id, ...fields } : { op: "add", ...fields }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!d?.id) return;
    setSaving(true);
    setError(null);
    const r = await callAction(manageIllness({ op: "delete", id: d.id }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  const stillSick = d?.endedOn == null;

  return (
    <BottomSheet open={draft !== null} onClose={onClose} blur>
      {d && (
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto" data-testid="illness-sheet">
          <h2 className="text-lg font-semibold">{d.id ? "Sick period" : "I was sick"}</h2>
          <label className="block">
            <span className="text-xs text-muted-foreground">First sick day</span>
            <input type="date" value={d.startedOn} max={today} onChange={(e) => setD({ ...d, startedOn: e.target.value })} className={field} />
          </label>
          <div className="space-y-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={stillSick}
              onClick={() => setD({ ...d, endedOn: stillSick ? (today < d.startedOn ? d.startedOn : today) : null })}
              className={`w-full ${chip(stillSick)}`}
            >
              Still sick
            </button>
            {!stillSick && (
              <label className="block">
                <span className="text-xs text-muted-foreground">Last sick day</span>
                <input
                  type="date"
                  value={d.endedOn ?? ""}
                  min={d.startedOn}
                  max={addDaysStr(today, 14)}
                  onChange={(e) => setD({ ...d, endedOn: e.target.value || null })}
                  className={field}
                />
              </label>
            )}
          </div>
          <div className="space-y-2" role="radiogroup" aria-label="How sick">
            <p className="text-xs text-muted-foreground">How sick (optional)</p>
            {SEVERITIES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={d.severity === s}
                onClick={() => setD({ ...d, severity: d.severity === s ? null : s })}
                className={`w-full ${chip(d.severity === s)}`}
              >
                <span className="block">{SEVERITY_LABEL[s]}</span>
                <span className={`block text-xs font-normal ${d.severity === s ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{SEVERITY_TEXT[s]}</span>
              </button>
            ))}
          </div>
          <textarea
            value={d.notes ?? ""}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
            maxLength={500}
            rows={2}
            aria-label="Notes"
            placeholder="Notes (optional)"
            className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !d.startedOn}
            className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
          >
            Save sick period
          </button>
          {d.id &&
            (confirmDelete ? (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="w-full rounded-xl bg-destructive py-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50 active:opacity-80"
              >
                Delete for sure
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="w-full min-h-[44px] text-sm font-medium text-destructive active:opacity-60">
                Delete sick period
              </button>
            ))}
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * "I'm better": ends an open sick period. The last sick day is yesterday, or
 * today when the user picks it (section 7). Yesterday is left out when the
 * period began today.
 */
export function EndIllness({ id, startedOn, today, onEnded }: { id: number; startedOn: string; today: string; onEnded: () => void }) {
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yesterday = addDaysStr(today, -1);

  async function end(endedOn: string) {
    setPending(true);
    setError(null);
    const r = await callAction(manageIllness({ op: "end", id, endedOn }));
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setChoosing(false);
    onEnded();
  }

  const button = "min-h-[44px] rounded-xl px-4 text-sm font-semibold active:opacity-70 disabled:opacity-50";
  return (
    <div className="space-y-2">
      {choosing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Last sick day:</span>
          {yesterday >= startedOn && (
            <button type="button" disabled={pending} onClick={() => end(yesterday)} className={`${button} bg-primary text-primary-foreground`}>
              Yesterday
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => end(today)} className={`${button} bg-muted`}>
            Today
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setChoosing(true)} className={`${button} bg-primary text-primary-foreground`}>
          I&apos;m better
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
