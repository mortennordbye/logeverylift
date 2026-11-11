import { ENDURANCE, type DemandRow, type VolumeWeek } from "@/lib/garmin/analytics/demands";
import { RACE_LABEL } from "@/lib/garmin/analytics/overview";
import { SPORT_LABEL, SPORT_MARK } from "@/lib/garmin/charts/theme";
import type { VolumeData } from "@/lib/garmin/queries";
import { CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Volume pieces shared by the Overview and Training tabs: the race demands
 * checklist and this week's hours per sport against the plan.
 */

const hm = (hours: number) => {
  const m = Math.round(hours * 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}`;
};

/** One row per demand: a bar toward the target, the best value, and the next step. */
export function DemandsList({ rows, compact = false }: { rows: DemandRow[]; compact?: boolean }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium flex items-center gap-1.5">
                {r.met && <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--viz-good)" }} aria-label="met" />}
                {r.label}
              </span>
              <span className="text-muted-foreground tabular-nums">
                <b className="text-foreground">{r.best}</b> of {r.target}
              </span>
            </div>
            <div className="h-2 rounded-full bg-background overflow-hidden mt-1" role="img" aria-label={`${r.label}: ${Math.round(r.progress * 100)} % of the target`}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.progress * 100)}%`, background: r.met ? "var(--viz-good)" : "var(--viz-warning)" }} />
            </div>
            {!compact && r.next && <p className="text-[11px] text-muted-foreground mt-1">Next step: {r.next}</p>}
          </>
        );
        return (
          <li key={r.key}>
            {r.activityId && !compact ? (
              <Link href={`/more/garmin/activity/${r.activityId}`} className="block active:opacity-70">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function demandsTitle(v: VolumeData) {
  return `${RACE_LABEL[v.distance]} demands${v.distanceAssumed ? " (no race distance set)" : ""}`;
}

/** This week's hours per sport as bars, with the plan as a tick when the active cycle has one. */
export function WeekAgainstPlan({ week, planned }: { week: VolumeWeek; planned: VolumeData["planned"] }) {
  const sports = [...ENDURANCE, "strength" as const];
  const max = Math.max(1, ...sports.map((s) => week.hours[s]), ...(planned ? ENDURANCE.map((s) => planned[s]) : []));
  return (
    <ul className="space-y-2">
      {sports.map((s) => {
        const done = week.hours[s];
        const plan = planned && s !== "strength" ? planned[s] : null;
        return (
          <li key={s} className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: `var(--viz-${s})` }}>
                {SPORT_MARK[s]}
              </span>
              {SPORT_LABEL[s]}
            </span>
            <span className="relative h-3 rounded-full bg-background" role="img" aria-label={`${SPORT_LABEL[s]}: ${hm(done)} done${plan !== null ? ` of ${hm(plan)} planned` : ""}`}>
              {done > 0 && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(done / max) * 100}%`, background: `var(--viz-${s})` }} />}
              {plan !== null && plan > 0 && <span className="absolute -top-1 -bottom-1 w-0.5 rounded bg-foreground" style={{ left: `calc(${(plan / max) * 100}% - 1px)` }} />}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {done > 0 ? <b className="text-foreground">{hm(done)}</b> : <span className="text-foreground">none</span>}
              {plan !== null ? ` / ${hm(plan)}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function MoreLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} replace scroll={false} className="flex h-11 items-center justify-end gap-0.5 text-sm text-primary active:opacity-60">
      {label}
      <ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}
