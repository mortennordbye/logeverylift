/**
 * Today's structured endurance sessions on home (docs/plans/endurance-app.md,
 * 4.1). Only with the endurance switch on and only for sessions with a
 * workout, which C2's home read leaves out (they have no program). The
 * strength card above it does not change.
 */

import { ProfileChart } from "@/components/features/bike/ProfileChart";
import { SavedRunLink } from "@/components/features/guided/SavedRunLink";
import type { BikeCardView } from "@/lib/utils/bike-view";
import Link from "next/link";

export type EnduranceTodayRow = {
  id: number;
  name: string;
  sport: "swim" | "bike" | "run";
  summary: string | null;
  /** "45 min · 30 km", already in the user's units. */
  amount: string | null;
  done: boolean;
  priority?: "key" | "support" | "optional";
  /** A bike workout as the Today card shows it (docs/plans/bike-sessions.md, 5.1). */
  bike?: BikeCardView | null;
};

/** The middle of the bike Today card: totals, block chart, the three lines and the FTP chips. */
export function BikeSummary({ view, compact = false }: { view: BikeCardView; compact?: boolean }) {
  return (
    <>
      <p className="font-semibold tabular-nums" data-testid="bike-totals">
        {view.totals}
      </p>
      {!compact && (
        <>
          <div className="mt-3">
            <ProfileChart blocks={view.blocks} height={64} axis={false} />
          </div>
          <ul className="mt-3 border-t border-hairline" data-testid="bike-lines">
            {view.lines.map((l) => (
              <li key={l.label} className="flex gap-3 border-b border-hairline py-2 text-sm">
                <span className="w-[78px] shrink-0 text-muted-foreground">{l.label}</span>
                <span className="flex-1 text-right font-semibold">
                  {l.value}
                  {l.sub && <small className="block text-xs font-normal text-muted-foreground">{l.sub}</small>}
                </span>
              </li>
            ))}
          </ul>
          {view.chips.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {view.chips.map((c) => (
                <span key={c.text} className={`rounded-full px-2.5 py-0.5 text-xs ${c.warn ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-widget-2"}`}>
                  {c.text}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

export function EnduranceTodayCard({ rows }: { rows: EnduranceTodayRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl bg-muted px-4 py-3 shrink-0" data-testid="endurance-today">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Endurance today</p>
        <Link href="/week" className="min-h-11 inline-flex items-center text-xs font-semibold text-primary active:opacity-70">
          This week →
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-border/40">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2" data-testid="endurance-today-row">
            <Link href={`/planned/${r.id}`} className="min-w-0 flex-1 active:opacity-70">
              <p className="text-sm font-medium truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground truncate">{r.bike ? r.bike.totals : [r.summary, r.amount].filter(Boolean).join(" · ")}</p>
            </Link>
            <div className="shrink-0 flex items-center gap-2">
              {r.done ? (
                <Link href={`/planned/${r.id}/results`} className="min-h-11 inline-flex items-center rounded-xl border border-border px-3 text-sm font-medium active:opacity-70">
                  Results
                </Link>
              ) : (
                <SavedRunLink plannedSessionId={r.id} compact />
              )}
              <Link
                href={r.sport === "swim" ? `/planned/${r.id}/pool` : `/planned/${r.id}/play`}
                className="min-h-11 inline-flex items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80"
              >
                {r.sport === "swim" ? "Pool view" : "Start guided"}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
