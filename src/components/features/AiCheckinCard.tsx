"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { answerCheckin } from "@/lib/actions/ai-checkin";
import { CHECKIN_ISSUES, CHECKIN_NOTE_MAX, type CheckinIssue } from "@/lib/utils/ai-checkin";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The one-week check-in for a plan built in AI Setup. "Not really" asks what's
 * wrong and opens AI Setup with a revised plan.
 */
export function AiCheckinCard({ id, cycleName }: { id: number; cycleName: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [issues, setIssues] = useState<CheckinIssue[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = issues.some((i) => i === "dislike_exercises" || i === "other") && !note.trim();

  async function answer(status: "fits" | "dismissed") {
    setSaving(true);
    const result = await answerCheckin({ id, status });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setHidden(true);
  }

  async function submitDoesNotFit() {
    setSaving(true);
    setError(null);
    const result = await answerCheckin({ id, status: "does_not_fit", issues, note });
    if (!result.success) {
      setSaving(false);
      setError(result.error);
      return;
    }
    router.push(`/more/ai-setup?revise=${id}`);
  }

  if (hidden) return null;

  return (
    <>
      <div className="rounded-2xl bg-primary/10 p-4 shrink-0 flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold">You&apos;ve had a week on {cycleName}.</p>
          <p className="text-sm text-muted-foreground">Does the plan fit you?</p>
        </div>
        {error && !sheetOpen && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => answer("fits")}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-80 disabled:opacity-50"
          >
            Yes, it fits
          </button>
          <button
            type="button"
            onClick={() => { setError(null); setSheetOpen(true); }}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-xl bg-muted text-foreground text-sm font-semibold active:opacity-80 disabled:opacity-50"
          >
            Not really
          </button>
        </div>
        <button
          type="button"
          onClick={() => answer("dismissed")}
          disabled={saving}
          className="self-center min-h-[44px] px-3 text-xs text-muted-foreground active:opacity-70"
        >
          Not now
        </button>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => !saving && setSheetOpen(false)} blur>
        <div className="bg-background rounded-t-2xl flex flex-col" style={{ maxHeight: "85dvh" }}>
          <div className="flex items-center justify-between px-4 pt-5 pb-3 shrink-0">
            <h2 className="text-lg font-semibold">What doesn&apos;t fit?</h2>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              disabled={saving}
              className="text-primary text-sm font-medium min-h-[44px] px-1"
            >
              Cancel
            </button>
          </div>
          <div className="overflow-y-auto flex flex-col gap-4 px-4 pb-10">
            <p className="text-sm text-muted-foreground">
              Pick everything that applies. We&apos;ll build a revised plan you can review before anything changes.
            </p>
            <div role="group" aria-label="What doesn't fit" className="flex flex-wrap gap-2">
              {CHECKIN_ISSUES.map((issue) => {
                const on = issues.includes(issue.id);
                return (
                  <button
                    key={issue.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setIssues(on ? issues.filter((i) => i !== issue.id) : [...issues, issue.id])}
                    className={`min-h-[44px] rounded-full px-4 text-sm font-medium active:opacity-70 ${
                      on ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {issue.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-1">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, CHECKIN_NOTE_MAX))}
                maxLength={CHECKIN_NOTE_MAX}
                rows={3}
                placeholder={
                  issues.includes("dislike_exercises")
                    ? "Which exercises? e.g. no lunges or dips"
                    : "Tell us more (optional)"
                }
                className="w-full rounded-xl bg-muted px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{note.length}/{CHECKIN_NOTE_MAX}</p>
            </div>
            {needsNote && (
              <p className="text-xs text-muted-foreground">Add a note so the AI knows what to change.</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="button"
              onClick={submitDoesNotFit}
              disabled={saving || issues.length === 0 || needsNote}
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              {saving ? "Saving…" : "See a revised plan"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
