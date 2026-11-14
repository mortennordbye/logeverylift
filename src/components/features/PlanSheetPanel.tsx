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
 * in the home's look, and one header for every Plan sheet: the optional
 * small label, the title and the lines under it on the left, the 44 px Close
 * button on the same row at the right when the sheet can close (J2-11).
 * Put it inside a `BottomSheet`.
 *
 * The sheet scrolls as a whole when its content is taller than the screen.
 * No part of it shrinks: a list that shrank scrolled inside the sheet, cut a
 * row in half and hid the actions under it (320 px). A `footer` (the main
 * actions, or the line that ends the sheet) stays pinned at the bottom of
 * the sheet while the rest scrolls under it, so it is always in view.
 */
export function PlanSheetPanel({
  label,
  title,
  kicker,
  sub,
  children,
  footer,
  testId,
}: {
  label: string;
  title: React.ReactNode;
  /** The small uppercase line over the title (a SectionLabel). */
  kicker?: React.ReactNode;
  /** Lines under the title, in the header. */
  sub?: React.ReactNode;
  children?: React.ReactNode;
  /** Pinned at the bottom of the sheet; the content scrolls under it. */
  footer?: React.ReactNode;
  testId?: string;
}) {
  const close = useSheetClose();
  return (
    <section
      aria-label={label}
      data-testid={testId}
      data-plan-sheet=""
      className={`${HOME_UI} bg-widget rounded-t-[20px] px-4 pt-2 ${footer ? "" : "pb-8"} flex flex-col gap-3.5 max-h-[90dvh] overflow-y-auto overscroll-contain [&>*]:shrink-0`}
    >
      <span aria-hidden className="self-center w-10 h-[5px] rounded-full bg-muted-foreground/50" />
      <div className="flex items-start gap-3" data-testid="sheet-header">
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
          {kicker}
          <h2 className="text-xl font-semibold break-words">{title}</h2>
          {sub}
        </div>
        {close && <SheetCloseButton onClick={close} className="-mr-1" />}
      </div>
      {children}
      {footer && (
        <div data-testid="sheet-footer" className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-hairline bg-widget px-4 pt-3 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </section>
  );
}

/** The plain Cancel under a sheet's full-width main button: every Plan sheet stacks them this way. */
export const SHEET_CANCEL = "min-h-11 text-[15px] font-medium text-muted-foreground active:opacity-70";

/** The 12 px uppercase label over a sheet title or a section. */
export function SectionLabel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={`text-xs font-semibold tracking-[1px] uppercase ${accent ? "text-brand" : "text-muted-foreground"}`}>{children}</span>;
}
