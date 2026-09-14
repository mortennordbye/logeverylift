"use client";

import { skipAutoCompletedDay } from "@/lib/actions/training-cycles";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "I skipped it" on a cycle day the app completed automatically. Removes the
 * auto session so the day no longer counts as done.
 */
export function SkipAutoDayButton({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSkip() {
    if (pending) return;
    setPending(true);
    const result = await skipAutoCompletedDay({ sessionId });
    if (result.success) {
      router.refresh();
    } else {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleSkip}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70 disabled:opacity-50"
    >
      I skipped it
    </button>
  );
}
