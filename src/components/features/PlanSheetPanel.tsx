import { HOME_UI } from "@/components/features/home/fonts";

/**
 * The inside of a Plan bottom sheet (docs/design/plan-redesign/spec.md,
 * "Bottom sheet"): the card surface, top corners of 20 px, the grab handle,
 * in the home's look. Put it inside a `BottomSheet`.
 */
export function PlanSheetPanel({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className={`${HOME_UI} bg-widget rounded-t-[20px] px-4 pt-2 pb-8 flex flex-col gap-3.5 max-h-[88dvh] overflow-y-auto`}
    >
      <span aria-hidden className="self-center w-10 h-[5px] rounded-full bg-muted-foreground/50" />
      {children}
    </section>
  );
}

/** The 12 px uppercase label over a sheet title or a section. */
export function SectionLabel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={`text-xs font-semibold tracking-[1px] uppercase ${accent ? "text-brand" : "text-muted-foreground"}`}>{children}</span>;
}
