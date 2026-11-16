"use client";

import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * Start Today's Workout. On a day whose program has structured steps
 * (docs/plans/one-program-model.md, home merge) it asks how: guided (the
 * pool view for a swim) or by hand. Any other day it starts at once, as before.
 */
export function StartToday({
  href,
  name,
  guided,
  className,
}: {
  href: string;
  name: string;
  guided: { href: string; kind: "guided" | "pool" } | null;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
      Start Today&apos;s Workout
    </>
  );
  if (!guided) {
    return (
      <Link href={href} prefetch={true} className={className}>
        {label}
      </Link>
    );
  }
  const option = "flex flex-col items-start gap-0.5 rounded-2xl bg-widget-2 px-4 py-3 min-h-14 text-left active:opacity-70";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-haspopup="dialog">
        {label}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <PlanSheetPanel
          label="How do you want to do it"
          title="How do you want to do it?"
          kicker={<span className="text-xs font-semibold tracking-[1px] uppercase text-muted-foreground">{name}</span>}
          testId="start-choice"
          footer={
            <button type="button" onClick={() => setOpen(false)} className={SHEET_CANCEL}>
              Cancel
            </button>
          }
        >
          <Link href={guided.href} className={option}>
            <span className="text-base font-semibold">{guided.kind === "pool" ? "Pool view" : "Guided"}</span>
            <span className="text-sm text-muted-foreground">
              {guided.kind === "pool" ? "One block per screen in large text, with the send-off clock" : "A timer takes you through each step, with the target and a beep at each change"}
            </span>
          </Link>
          <Link href={href} prefetch={true} className={option}>
            <span className="text-base font-semibold">Log by hand</span>
            <span className="text-sm text-muted-foreground">The step list. Tap each step and enter what you did</span>
          </Link>
        </PlanSheetPanel>
      </BottomSheet>
    </>
  );
}
