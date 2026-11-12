import type { Severity } from "@/lib/garmin/analytics/insights";
import { CONTRIBUTOR_LABEL, type Readiness } from "@/lib/garmin/analytics/readiness";
import type { Sport } from "@/lib/garmin/analytics/sport";
import { SPORT_LABEL } from "@/lib/garmin/charts/theme";
import { Activity, AlertTriangle, Bike, CheckCircle2, Dumbbell, Footprints, Info, ShieldAlert, Waves, type LucideIcon } from "lucide-react";

/** Icons so a sport is never told by colour alone (3.1). */
export const SPORT_ICON: Record<Sport, LucideIcon> = { swim: Waves, bike: Bike, run: Footprints, strength: Dumbbell, other: Activity };

const BADGE_SIZE = { sm: ["h-4 w-4", "h-2.5 w-2.5"], md: ["h-5 w-5", "h-3 w-3"], lg: ["h-9 w-9", "h-[18px] w-[18px]"] } as const;

/** The sport's icon on a circle in its colour. */
export function SportBadge({ sport, size = "sm", label = false }: { sport: Sport; size?: keyof typeof BADGE_SIZE; label?: boolean }) {
  const Icon = SPORT_ICON[sport];
  const [box, icon] = BADGE_SIZE[size];
  return (
    <span
      className={`inline-flex ${box} flex-none items-center justify-center rounded-full text-white`}
      style={{ background: `var(--viz-${sport})` }}
      {...(label ? { role: "img", "aria-label": SPORT_LABEL[sport] } : { "aria-hidden": true })}
    >
      <Icon className={icon} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

export const SEVERITY_ICON: Record<Severity, LucideIcon> = { warning: ShieldAlert, caution: AlertTriangle, good: CheckCircle2, info: Info };
export const SEVERITY_COLOR: Record<Severity, string> = { warning: "var(--viz-critical)", caution: "var(--viz-warning)", good: "var(--viz-good)", info: "var(--muted-foreground)" };

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

/** Line key for lines, dot for points, swatch for bars and areas, plus an optional sport icon. */
export function Legend({ items }: { items: { name: string; color: string; kind: "line" | "bar" | "dot"; sport?: Sport }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span
            className={i.kind === "line" ? "inline-block h-0.5 w-3.5 rounded-full" : i.kind === "dot" ? "inline-block h-2 w-2 rounded-full" : "inline-block h-2.5 w-2.5 rounded-sm"}
            style={{ background: i.color }}
          />
          {i.sport && (() => { const Icon = SPORT_ICON[i.sport]; return <Icon className="h-3 w-3 text-foreground" aria-hidden />; })()}
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

/** Readiness contributors as bars from the centre: right helps the score, left holds it down. */
export function Contributors({ readiness: r }: { readiness: Readiness }) {
  return (
    <ul className="space-y-2.5 pt-2">
      {r.contributors.map((c) => {
        const delta = c.score - 50;
        return (
          <li key={c.key} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">{CONTRIBUTOR_LABEL[c.key]}</span>
              <span className="text-muted-foreground">{c.detail}</span>
            </div>
            {/* Bar from the centre: right is helping, left is holding the score down. */}
            <div className="relative h-2 rounded-full bg-background" role="img" aria-label={`${CONTRIBUTOR_LABEL[c.key]} ${c.score} of 100`}>
              <span className="absolute left-1/2 top-[-2px] h-3 w-px bg-muted-foreground/60" />
              <span
                className="absolute top-0 h-2 rounded-full"
                style={{
                  left: delta >= 0 ? "50%" : `${50 + delta}%`,
                  width: `${Math.abs(delta)}%`,
                  background: delta >= 0 ? "var(--viz-positive)" : "var(--viz-negative)",
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
