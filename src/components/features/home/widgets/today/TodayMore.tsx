"use client";

import { SkipAutoDayButton } from "@/components/features/SkipAutoDayButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { TodayAction } from "@/lib/home/today-actions";
import { MoreHorizontal } from "lucide-react";
import { HOME_UI } from "../../fonts";
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
        className="h-12 w-12 shrink-0 inline-flex items-center justify-center rounded-[16px] bg-white/15 text-white active:scale-[0.94] transition-transform"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <div className={`${HOME_UI} bg-sheet rounded-t-[28px] px-4 pt-2 pb-8 space-y-3`} data-testid="today-more-sheet">
          <div className="mx-auto mb-2.5 h-[5px] w-9 rounded-full bg-muted-foreground/50" aria-hidden />
          <div className="flex items-center justify-between">
            <h2 className="home-display text-[24px]">Today</h2>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-full bg-widget-2 px-4 text-[15px] font-semibold active:scale-[0.94] transition-transform">
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
                      ? "inline-flex min-h-12 items-center justify-center rounded-[14px] bg-brand-fill px-4 text-[15px] font-semibold text-white active:scale-[0.97] transition-transform"
                      : "inline-flex min-h-12 items-center justify-center rounded-[14px] bg-widget ring-1 ring-inset ring-hairline px-4 text-[15px] font-semibold active:opacity-60"
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
