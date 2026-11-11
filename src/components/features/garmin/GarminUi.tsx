import type { LucideIcon } from "lucide-react";

/**
 * Shared pieces of the Garmin views: a card with an icon, the readout row a
 * chart's crosshair writes to, the legend, and a stat tile.
 */

export function Card({
  title,
  icon: Icon,
  aside,
  note,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  aside?: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {Icon && (
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-background">
              <Icon className="h-3.5 w-3.5 text-foreground" aria-hidden />
            </span>
          )}
          {title}
        </h2>
        {aside && <span className="text-[11px] text-muted-foreground text-right">{aside}</span>}
      </div>
      {children}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

/** Values at the crosshair, above the chart where a finger can't hide them. Values lead, names follow. */
export function Readout({ title, values }: { title: string; values: { label: string; value: string }[] }) {
  return (
    <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap min-h-[34px] tabular-nums" aria-live="polite">
      <span className="text-[11px] text-muted-foreground w-full">{title}</span>
      {values.map((v) => (
        <span key={v.label} className="text-xs text-muted-foreground">
          <span className="text-base font-semibold text-foreground">{v.value}</span> {v.label}
        </span>
      ))}
    </div>
  );
}

/** Line key for lines, dot for points, swatch for bars and areas, plus an optional letter mark. */
export function Legend({ items }: { items: { name: string; color: string; kind: "line" | "bar" | "dot"; mark?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span
            className={i.kind === "line" ? "inline-block h-0.5 w-3.5 rounded-full" : i.kind === "dot" ? "inline-block h-2 w-2 rounded-full" : "inline-block h-2.5 w-2.5 rounded-sm"}
            style={{ background: i.color }}
          />
          {i.mark && <span className="font-semibold text-foreground">{i.mark}</span>}
          {i.name}
        </span>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = "muted" }: { label: string; value: string; sub?: string | null; icon?: LucideIcon; tone?: "muted" | "background" }) {
  return (
    <div className={`rounded-xl p-3 ${tone === "background" ? "bg-background" : "bg-muted"}`}>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground leading-tight">
        {Icon && <Icon className="h-3.5 w-3.5 flex-none" aria-hidden />}
        {label}
      </p>
      <p className="text-xl font-semibold leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
