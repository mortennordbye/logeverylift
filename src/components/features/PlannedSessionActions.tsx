"use client";

import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type PlannedSessionLite = {
  id: number;
  date: string;
  status: "planned" | "done" | "missed" | "skipped";
  touched: boolean;
  templateDate: string | null;
};

/**
 * Move, skip, plan again or reset one dated session (docs/plans/sessions.md,
 * 5), from the calendar's day sheet. A logged session has no actions: past
 * sessions never change.
 */
export function PlannedSessionActions({
  session,
  today,
  lastDay,
  name,
}: {
  session: PlannedSessionLite;
  today: string;
  /** The last day of the block: the latest a session can move to. */
  lastDay: string;
  name: string;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(session.date < today ? today : session.date);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.status === "done") return null;

  async function run(op: Parameters<typeof updatePlannedSession>[0]) {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await callAction(updatePlannedSession(op));
    setPending(false);
    if (result.success) {
      setMoving(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const button = "min-h-[44px] rounded-xl px-4 text-sm font-medium active:opacity-70 disabled:opacity-50";
  const canReset = session.touched && session.templateDate != null && session.templateDate >= today;

  return (
    <div className="px-4 pb-3.5 flex flex-col gap-2">
      {moving ? (
        <div className="flex items-center gap-2">
          <label className="flex-1 text-sm">
            <span className="sr-only">New day for {name}</span>
            <input
              type="date"
              value={date}
              min={today}
              max={lastDay}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-border bg-background px-3"
            />
          </label>
          <button
            type="button"
            disabled={pending || !date}
            onClick={() => run({ op: "move", id: session.id, date })}
            className={`${button} bg-primary text-primary-foreground`}
          >
            Save
          </button>
          <button type="button" onClick={() => setMoving(false)} className={`${button} border border-border`}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {session.status === "skipped" ? (
            session.date >= today && (
              <button type="button" disabled={pending} onClick={() => run({ op: "unskip", id: session.id })} className={`${button} border border-border`}>
                Plan {name} again
              </button>
            )
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => setMoving(true)} className={`${button} border border-border`}>
                Move {name}
              </button>
              <button type="button" disabled={pending} onClick={() => run({ op: "skip", id: session.id })} className={`${button} border border-border`}>
                Skip {name}
              </button>
            </>
          )}
          {canReset && (
            <button type="button" disabled={pending} onClick={() => run({ op: "reset", id: session.id })} className={`${button} text-muted-foreground`}>
              Back to the template
            </button>
          )}
        </div>
      )}
      {session.status === "skipped" && <p className="text-xs text-muted-foreground">Skipped</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
