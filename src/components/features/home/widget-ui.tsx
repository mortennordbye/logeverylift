/**
 * Shared pieces for home widgets: the card, the loading and error states and
 * the static preview box. Theme tokens only, so light and dark need no extra
 * work.
 */

import type { WidgetSize } from "@/lib/home/widgets/types";
import Link from "next/link";
import type { ReactNode } from "react";

/** Height of a skeleton or preview: S and M one unit, L two. */
export const SIZE_HEIGHT: Record<WidgetSize, string> = { s: "h-36", m: "h-36", l: "h-72" };

export function WidgetCard({
  title,
  href,
  linkLabel,
  children,
  testId,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-2xl bg-muted px-4 py-3 h-full" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">{title}</h2>
        {href && (
          <Link href={href} className="min-h-11 inline-flex items-center text-xs font-semibold text-primary shrink-0 active:opacity-70">
            {linkLabel ?? "See all →"}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function WidgetSkeleton({ size }: { size: WidgetSize }) {
  return <div className={`animate-pulse rounded-2xl bg-muted ${SIZE_HEIGHT[size]}`} aria-hidden="true" data-testid="widget-skeleton" />;
}

export function WidgetError() {
  return (
    <div className="rounded-2xl bg-muted px-4 py-3 h-full" role="status" data-testid="widget-error">
      <p className="text-sm text-muted-foreground">Couldn&apos;t load this.</p>
    </div>
  );
}

/** A widget's static stand-in in edit mode and the gallery: its name and a few bars. */
export function PreviewBox({ title, size, lines = 2 }: { title: string; size: WidgetSize; lines?: number }) {
  const n = size === "l" ? lines + 2 : lines;
  return (
    <div className={`rounded-xl bg-muted px-3 py-2 ${size === "s" ? "w-1/2" : "w-full"}`} aria-hidden="true">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{title}</p>
      <div className="mt-1.5 space-y-1">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="h-1.5 rounded-full bg-border" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}
