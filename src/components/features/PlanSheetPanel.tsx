"use client";

import { HOME_UI } from "@/components/features/home/fonts";
import { useSheetClose } from "@/components/ui/BottomSheet";
import { X } from "lucide-react";

/**
 * The inside of a Plan bottom sheet (docs/design/plan-redesign/spec.md,
 * "Bottom sheet"): the card surface, top corners of 20 px, the grab handle,
 * in the home's look, and a 44 px close button when the sheet can close.
 * Put it inside a `BottomSheet`.
 */
export function PlanSheetPanel({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  const close = useSheetClose();
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className={`${HOME_UI} bg-widget rounded-t-[20px] px-4 pt-2 pb-8 flex flex-col gap-3.5 max-h-[88dvh] overflow-y-auto`}
    >
      {close ? (
        <div className="relative flex h-11 shrink-0 justify-end -mb-2">
          <span aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2 w-10 h-[5px] rounded-full bg-muted-foreground/50" />
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="-mr-2 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground active:opacity-70"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
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
