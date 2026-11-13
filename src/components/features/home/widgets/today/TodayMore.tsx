"use client";

import { SkipAutoDayButton } from "@/components/features/SkipAutoDayButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { TodayAction } from "@/lib/home/today-actions";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/** The S size's "More" button: every Today action that does not fit, in a sheet. */
export function TodayMore({ actions }: { actions: TodayAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More actions"
        className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground active:opacity-70"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-3" data-testid="today-more-sheet">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Today</h2>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm text-muted-foreground active:opacity-60">
              Close
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {actions.map((a) =>
              a.kind === "skip" ? (
                <SkipAutoDayButton key={`skip-${a.sessionId}`} sessionId={a.sessionId} />
              ) : (
                <Link
                  key={a.href}
                  href={a.href}
                  aria-label={a.ariaLabel}
                  className={
                    a.primary
                      ? "inline-flex min-h-11 items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80"
                      : "inline-flex min-h-11 items-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
                  }
                >
                  {a.label}
                </Link>
              ),
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
