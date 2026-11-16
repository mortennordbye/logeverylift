"use client";

import { editDayOnly } from "@/lib/actions/program-steps";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Change this day only" (docs/plans/one-program-model.md, decision 2): the
 * session gets its own copy of its program, and the step editor opens on it.
 * The template and the other days keep the program as it is.
 */
export function DayOnlyButton({ plannedSessionId }: { plannedSessionId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await callAction(editDayOnly({ plannedSessionId }));
          setPending(false);
          if (!r.success) return setError(r.error);
          router.push(`/programs/${r.data.programId}/exercises/${r.data.programExerciseId}`);
        }}
        className="min-h-12 rounded-2xl border border-border px-4 py-3 text-center text-base font-medium active:opacity-70 disabled:opacity-50"
        data-testid="day-only"
      >
        Change this day only
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
