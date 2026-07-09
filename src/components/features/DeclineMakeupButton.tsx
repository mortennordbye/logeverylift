"use client";

import { dismissMissedWorkout } from "@/lib/actions/training-cycles";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Decline" action next to a missed workout's "Make up" link. Permanently hides
 * that missed day from the "Missed this week" list.
 */
export function DeclineMakeupButton({ date }: { date: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDecline() {
    if (pending) return;
    setPending(true);
    const result = await dismissMissedWorkout({ date });
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
      className="text-xs font-semibold text-muted-foreground px-3 py-1.5 rounded-full bg-muted active:opacity-70 disabled:opacity-50"
    >
      Decline
    </button>
  );
}
