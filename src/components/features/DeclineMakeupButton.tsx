"use client";

import { dismissMissedWorkout } from "@/lib/actions/training-cycles";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Decline" action next to a missed workout's "Make up" link. Permanently hides
 * that missed day from the "Missed this week" list.
 */
export function DeclineMakeupButton({ date, plannedSessionId }: { date: string; plannedSessionId?: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDecline() {
    if (pending) return;
    setPending(true);
    // With the dated session, only that one is skipped (a day can hold several).
    const result = await callAction(dismissMissedWorkout(plannedSessionId != null ? { date, plannedSessionId } : { date }));
    if (result.success) {
      router.refresh();
    } else {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleDecline}
      disabled={pending}
      className="min-h-11 inline-flex items-center px-2 text-[13px] font-semibold text-muted-foreground active:opacity-60 disabled:opacity-50"
    >
      Decline
    </button>
  );
}
