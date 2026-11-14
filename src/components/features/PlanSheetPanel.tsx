"use client";

import { HOME_UI } from "@/components/features/home/fonts";
import { useSheetClose } from "@/components/ui/BottomSheet";
import { X } from "lucide-react";

/** The one Close button of every Plan sheet: 44 px, round, on the inner surface. */
export function SheetCloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      data-testid="sheet-close"
      className={`h-11 w-11 shrink-0 rounded-full bg-widget-2 text-muted-foreground flex items-center justify-center active:opacity-70 ${className}`}
    >
      <X className="w-[18px] h-[18px]" strokeWidth={2.2} aria-hidden />
    </button>
  );
}

/**
 * The inside of a Plan bottom sheet (docs/design/plan-redesign/spec.md,
 * "Bottom sheet"): the card surface, top corners of 20 px, the grab handle,
 * in the home's look, and a 44 px close button when the sheet can close.
 * Put it inside a `BottomSheet`.
 *
 * The sheet scrolls as a whole when its content is taller than the screen.
 * No part of it shrinks: a list that shrank scrolled inside the sheet, cut a
 * row in half and hid the actions under it (320 px).
 */
export function PlanSheetPanel({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  const close = useSheetClose();
  return (
    <section
      aria-label={label}
      data-testid={testId}
      data-plan-sheet=""
      className={`${HOME_UI} bg-widget rounded-t-[20px] px-4 pt-2 pb-8 flex flex-col gap-3.5 max-h-[90dvh] overflow-y-auto overscroll-contain [&>*]:shrink-0`}
    >
      {close ? (
        <div className="relative flex h-12 items-end justify-end -mb-2">
          <span aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2 w-10 h-[5px] rounded-full bg-muted-foreground/50" />
          <SheetCloseButton onClick={close} className="-mr-1" />
        </div>
      ) : (
        <span aria-hidden className="self-center w-10 h-[5px] rounded-full bg-muted-foreground/50" />
      )}
      {children}
    </section>
  );
}

/** The 12 px uppercase label over a sheet title or a section. */
export function SectionLabel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={`text-xs font-semibold tracking-[1px] uppercase ${accent ? "text-brand" : "text-muted-foreground"}`}>{children}</span>;
}
