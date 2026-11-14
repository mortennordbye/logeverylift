/**
 * Shared pieces for home widgets, in the locked look
 * (docs/design/home-redesign/home-locked.html): the card, its label, big
 * numbers, the ring and sparkline, and the loading, error and preview states.
 * Theme tokens only (globals.css), so light and dark need no extra work.
 */

import { ringDash, sparkline } from "@/lib/home/charts";
import type { WidgetSize } from "@/lib/home/widgets/types";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** Height of a skeleton or preview: S and M one unit, L two. */
export const SIZE_HEIGHT: Record<WidgetSize, string> = { s: "h-[164px]", m: "h-[164px]", l: "h-[340px]" };

/** The widget surface: 24 px corners, a hairline, 14 px padding. S and M are at least one grid unit tall. */
export const CARD =
  "relative flex flex-col h-full min-h-[164px] overflow-hidden rounded-widget bg-widget p-3.5 ring-1 ring-inset ring-hairline text-left";

/**
 * A widget card. With `href` the whole card is the link, as on the iPhone:
 * one destination per widget, and no link inside it.
 */
export function Card({
  href,
  testId,
  className = "",
  children,
  ariaLabel,
}: {
  href?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        className={`${CARD} transition-transform duration-200 ease-spring active:scale-[0.975] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${className}`}
        data-testid={testId}
      >
        {children}
      </Link>
    );
  }
  return (
    <section className={`${CARD} ${className}`} data-testid={testId} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

/** The card's label row: icon, name, and an optional muted hint with a chevron at the end. */
export function Label({ icon, children, more }: { icon?: ReactNode; children: ReactNode; more?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 min-h-[18px] text-[13px] font-semibold text-muted-foreground">
      {icon && <span className="inline-flex shrink-0 [&_svg]:h-[15px] [&_svg]:w-[15px]" aria-hidden>{icon}</span>}
      <h2 className="truncate">{children}</h2>
      {more && (
        <span className="ml-auto flex items-center gap-0.5 font-medium shrink-0">
          {more}
          <ChevronRight className="h-[13px] w-[13px]" strokeWidth={2.4} aria-hidden />
        </span>
      )}
    </div>
  );
}

const NUM_SIZE = { 54: "text-[54px]", 38: "text-[38px]", 26: "text-[26px]", 20: "text-[20px]", 17: "text-[17px]" } as const;

/** A big number in the display face, with an optional unit after it. */
export function Num({ size, children, unit, className = "" }: { size: keyof typeof NUM_SIZE; children: ReactNode; unit?: string; className?: string }) {
  return (
    <span className={`home-display ${NUM_SIZE[size]} ${className}`}>
      {children}
      {unit && <span className="ml-[3px] text-[15px] font-semibold tracking-normal text-muted-foreground">{unit}</span>}
    </span>
  );
}

export const Cap = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <span className={`block text-xs font-medium text-muted-foreground ${className}`}>{children}</span>
);

/** A progress ring, plain SVG. `color` is a CSS colour; the track is the inner surface. */
export function Ring({ size, stroke, pct, color = "var(--brand)", children }: { size: number; stroke: number; pct: number; color?: string; children?: ReactNode }) {
  const { r, c, offset } = ringDash(size, stroke, pct);
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 block" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="var(--widget-2)" />
        <circle
          className="home-ring-fg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ "--ring-c": c } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** A sparkline with a soft area under it and a dot on the last value. Nothing for fewer than two values. */
export function Spark({ values, height, id }: { values: number[]; height: number; id: string }) {
  const s = sparkline(values, height);
  if (!s) return null;
  return (
    <div className="relative mt-auto" style={{ height }} aria-hidden>
      <svg className="home-reveal block h-full w-full overflow-visible" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--foreground)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--foreground)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={s.area} fill={`url(#${id})`} />
        <path d={s.line} fill="none" stroke="var(--foreground)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        className="absolute -right-[3px] h-2 w-2 -translate-y-1/2 rounded-full bg-foreground"
        style={{ top: `${s.endPct}%`, boxShadow: "0 0 0 3px color-mix(in oklab, var(--foreground) 20%, transparent)" }}
      />
    </div>
  );
}

/** A thin bar with a fill from 0 to 1, for muscle sets and readiness contributors. */
export function Track({ pct, className = "bg-brand" }: { pct: number; className?: string }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-widget-2">
      <i className={`home-growx block h-full rounded-full ${className}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%` }} />
    </span>
  );
}

export function WidgetSkeleton({ size }: { size: WidgetSize }) {
  return <div className={`animate-pulse rounded-widget bg-widget ring-1 ring-inset ring-hairline ${SIZE_HEIGHT[size]}`} aria-hidden="true" data-testid="widget-skeleton" />;
}

export function WidgetError() {
  return (
    <div className={CARD} role="status" data-testid="widget-error">
      <p className="text-sm text-muted-foreground">Couldn&apos;t load this.</p>
    </div>
  );
}

/**
 * A widget's static stand-in in edit mode and the gallery: its name and
 * placeholder bars at the size's shape. Never real data.
 */
export function PreviewBox({ title, size, lines = 2 }: { title: string; size: WidgetSize; lines?: number }) {
  const n = size === "l" ? lines + 2 : lines;
  return (
    <div className={`${CARD} ${SIZE_HEIGHT[size]}! gap-2`} aria-hidden="true">
      <p className="text-[13px] font-semibold text-muted-foreground truncate">{title}</p>
      <div className="mt-1 space-y-2">
        <div className="h-6 w-1/3 rounded-lg bg-widget-2" />
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="h-2 rounded-full bg-widget-2" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}
