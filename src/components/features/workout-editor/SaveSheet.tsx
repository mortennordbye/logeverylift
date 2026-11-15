"use client";

import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { previewEditedWorkout, saveEditedWorkout, type SavePreview, type SavedWorkout } from "@/lib/actions/workout-editor";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import type { Workout } from "@/lib/utils/workout-steps";
import { useEffect, useState } from "react";

/** Where the editor was opened from: what Save can write. */
export type EditorContext =
  | { kind: "session"; sessionId: number; libraryId: number | null; date: string }
  | { kind: "library"; workoutId: number }
  | { kind: "new"; plan: { cycleId: number; date: string } | null };

export type SaveOutcome = SavedWorkout & { message: string };

type Choice = { key: string; title: string; sub: string; input: Parameters<typeof saveEditedWorkout>[0]; message: string; warnings: string[] | null; keepOwn?: { id: number; date: string }[] };

function Warnings({ lines }: { lines: string[] | null }) {
  if (lines === null) return <span className="text-[13px] text-muted-foreground">Checking the training limits...</span>;
  if (!lines.length) return null;
  return (
    <span className="flex flex-col gap-1" data-testid="limit-warnings">
      {lines.map((l) => (
        <span key={l} className="text-[13px] text-amber-700 dark:text-amber-300">
          Training limit: {l}
        </span>
      ))}
    </span>
  );
}

/**
 * The save sheet (docs/plans/bike-sessions.md, 5.3): this session, this and
 * later sessions, or a new library workout. The training limits run in warn
 * mode before Save, and a library save lists the sessions that keep their
 * own version.
 */
export function SaveSheet({
  context,
  workout,
  onSaved,
  onFieldErrors,
  onCancel,
}: {
  context: EditorContext;
  workout: Workout;
  onSaved: (o: SaveOutcome) => void;
  onFieldErrors: (errors: Record<string, string[]>) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<SavePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = context.kind === "session" ? context.sessionId : undefined;
  const libraryId = context.kind === "session" ? (context.libraryId ?? undefined) : context.kind === "library" ? context.workoutId : undefined;

  useEffect(() => {
    if (sessionId === undefined && libraryId === undefined) return;
    let live = true;
    callAction(previewEditedWorkout({ sessionId, workoutId: libraryId, workout })).then((r) => {
      if (!live) return;
      if (r.success) setPreview(r.data);
      else setPreview({ session: [], later: [], keepOwn: [] });
    });
    return () => {
      live = false;
    };
  }, [sessionId, libraryId, workout]);

  const choices: Choice[] = [];
  if (context.kind === "session") {
    choices.push({
      key: "session",
      title: "This session",
      sub: `Only ${shortDay(context.date)} changes.`,
      input: { target: "session", sessionId: context.sessionId, workout },
      message: "Saved for this session.",
      warnings: preview?.session ?? null,
    });
  }
  if (libraryId !== undefined) {
    choices.push({
      key: "later",
      title: "This and later sessions",
      sub: "The library workout changes, and the sessions that follow it.",
      input: { target: "later", workoutId: libraryId, sessionId, workout },
      message: "Saved to the library workout.",
      warnings: preview?.later ?? null,
      keepOwn: preview?.keepOwn ?? [],
    });
  }
  if (context.kind === "new" && context.plan) {
    choices.push({
      key: "plan",
      title: `Save and plan on ${shortDay(context.plan.date)}`,
      sub: "A new library workout, and a session of it on that day.",
      input: { target: "new", workout, plan: context.plan },
      message: `Saved, and planned on ${shortDay(context.plan.date)}.`,
      warnings: [],
    });
  }
  choices.push({
    key: "new",
    title: context.kind === "new" ? "Save to the library" : "Save as a new library workout",
    sub: "Plan it from the calendar or a template day.",
    input: { target: "new", workout },
    message: "Saved as a new library workout.",
    warnings: [],
  });

  async function save(c: Choice) {
    if (pending) return;
    setPending(true);
    setError(null);
    const r = await callAction(saveEditedWorkout(c.input));
    setPending(false);
    if (!r.success) {
      if ("fieldErrors" in r && r.fieldErrors) onFieldErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    onSaved({ ...r.data, message: c.message });
  }

  return (
    <PlanSheetPanel
      label="Save the workout"
      title="Save"
      testId="save-sheet"
      footer={
        <button type="button" onClick={onCancel} className={SHEET_CANCEL}>
          Cancel
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {choices.map((c) => (
          <div key={c.key} className="flex flex-col gap-1.5 rounded-2xl bg-widget-2 p-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => save(c)}
              className="flex min-h-[52px] w-full flex-col items-start justify-center rounded-xl bg-primary px-4 py-2 text-left text-primary-foreground active:opacity-80 disabled:opacity-50"
            >
              <span className="text-base font-semibold">{c.title}</span>
            </button>
            <span className="text-[13px] text-muted-foreground">{c.sub}</span>
            {c.keepOwn?.map((s) => (
              <span key={s.id} className="text-[13px]">
                {shortDay(s.date)} keeps its own version.
              </span>
            ))}
            <Warnings lines={c.warnings} />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[#ff6b5a]">
          {error}
        </p>
      )}
    </PlanSheetPanel>
  );
}
