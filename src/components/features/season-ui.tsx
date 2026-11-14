"use client";

/**
 * Small parts the season screens share, drawn to the Plan tab spec
 * (docs/design/plan-redesign/spec.md): section labels, radio cards, chips,
 * a segmented choice and the pinned bottom bar. Used inside `.home-ui`.
 */

/** The selected chip tint comes from the accent, never a fixed blue. */
export const ACCENT_TINT = "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)]";
export const LABEL = "text-xs font-semibold uppercase tracking-[1px] text-muted-foreground";
export const FIELD =
  "w-full min-h-12 rounded-xl border border-hairline bg-widget px-3.5 text-base text-foreground outline-none focus:ring-2 ring-primary";
export const INNER_FIELD = "w-full min-h-11 rounded-[10px] bg-widget-2 px-3 text-[15px] text-foreground outline-none focus:ring-2 ring-primary";
export const DESTRUCTIVE_TEXT = "text-[#ff6b5a]";

export function SectionLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className={`${LABEL} mx-1`}>
      {children}
    </h2>
  );
}

/** A card with a radio mark: a real radio input, so the group reads right to a screen reader. */
export function RadioCard({
  name,
  checked,
  onChange,
  title,
  sub,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  sub?: React.ReactNode;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={`flex flex-col gap-2.5 rounded-2xl bg-widget px-4 py-3.5 min-h-11 border ${checked ? "border-primary" : "border-transparent"} ${disabled ? "opacity-60" : "active:opacity-80"}`}
    >
      <span className="flex items-center gap-3">
        <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="peer sr-only" />
        <span
          aria-hidden="true"
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:ring-2 ring-primary ${checked ? "border-primary" : "border-muted-foreground"}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-primary" : ""}`} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{title}</span>
          {sub && <span className="text-[13px] text-muted-foreground">{sub}</span>}
        </span>
      </span>
      {children}
    </label>
  );
}

/** A pill that toggles; `aria-pressed` carries the state. */
export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-3.5 text-sm font-medium active:opacity-70 ${pressed ? `border-primary ${ACCENT_TINT} text-foreground` : "border-hairline text-foreground/75"}`}
    >
      {children}
    </button>
  );
}

/** Two or three equal choices in one rounded track; the chosen one is filled with the accent. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
  track = "bg-widget",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  track?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`grid gap-1 rounded-xl p-[3px] ${track} ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-[10px] text-sm ${value === o.value ? "bg-primary font-semibold text-primary-foreground" : "font-medium text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The pinned bottom bar of a form screen: one full-width primary button. It
 * sits over the tab bar, so a form screen shows no tab bar.
 */
export function PinnedBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-home px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}

export const PRIMARY_BUTTON =
  "w-full min-h-[52px] rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-[0.98] transition-transform";

/** "Step 1 of 2" and a two-part bar. */
export function StepProgress({ step, of }: { step: number; of: number }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>
        Step {step} of {of}
      </span>
      <div className="grid h-1 gap-1" style={{ gridTemplateColumns: `repeat(${of}, minmax(0, 1fr))` }}>
        {Array.from({ length: of }, (_, i) => (
          <div key={i} className={`rounded-sm ${i < step ? "bg-primary" : "bg-[#707076]"}`} />
        ))}
      </div>
    </div>
  );
}
