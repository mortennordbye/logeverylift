import { keepDates } from "@/lib/utils/keep-dates";
import type { SeasonCardView } from "@/lib/utils/plan-list";
import Link from "next/link";

/** The flag of a season or a race (stroke icon, as the mockups draw it). */
export function FlagIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden>
      <path d="M5 21V4M5 4h12l-2 4 2 4H5" />
    </svg>
  );
}

function PhaseBar({ season }: { season: SeasonCardView }) {
  if (season.bar.length === 0) return null;
  return (
    <div className="flex h-2 gap-[3px]" role="img" aria-label={season.barLabel}>
      {season.bar.map((b) => (
        <div
          key={b.id}
          className={`min-w-2 rounded ${b.tone === "grey" ? "bg-[#707076]" : "bg-brand"} ${b.tone === "current" ? "ring-2 ring-brand ring-offset-2 ring-offset-widget" : ""}`}
          style={{ flex: `${b.flex} 1 0` }}
        />
      ))}
    </div>
  );
}

const row = "flex items-center gap-3 min-h-[44px] border-t border-hairline px-[18px] py-2.5 active:bg-widget-2";

/**
 * One season on the Plan list (J4_PlanSeason, J6_PlanGoalSeason): the race
 * countdown or the goal date, the phase bar, the phases inline and the A race.
 */
export function SeasonCard({ season }: { season: SeasonCardView }) {
  const { race } = season;
  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-[20px] bg-widget" data-testid="season-card" aria-label={season.name}>
      <Link href={`/seasons/${season.id}`} className="flex flex-col gap-3 px-[18px] pt-4 pb-3 active:opacity-70">
        {race ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-base font-semibold">{season.name}</span>
            {race.daysLeft != null && (
              <span className="shrink-0 text-[13px] text-muted-foreground">
                Race in <span className="home-display text-xl text-foreground">{race.daysLeft}</span> {race.daysLeft === 1 ? "day" : "days"}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[1px] text-muted-foreground">Season · {keepDates(season.goalBy)}</span>
              <span className="text-lg font-semibold">{season.name}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="home-display text-[40px] leading-[38px]">{season.weeksLeft}</span>
              <span className="text-xs text-muted-foreground">{season.weeksLeft === 1 ? "week left" : "weeks left"}</span>
            </span>
          </div>
        )}
        {season.replan && <span className="text-[13px] font-medium text-foreground">Re-plan needed</span>}
        <PhaseBar season={season} />
      </Link>
      {season.phases.map((p) => (
        <Link key={p.id} href={`/cycles/${p.id}`} className={row}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${p.mark === "accent" ? "bg-brand" : "bg-[#707076]"}`} aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[15px] font-medium">{p.name}</span>
            <span className="text-[13px] text-muted-foreground">{keepDates(p.sub)}</span>
          </span>
          {p.badge && <span className={`shrink-0 text-xs font-semibold ${p.badgeAccent ? "text-brand" : "text-muted-foreground"}`}>{keepDates(p.badge)}</span>}
        </Link>
      ))}
      {race && (
        <Link href={`/seasons/${season.id}`} className={row}>
          <FlagIcon className="-ml-1 h-4 w-4 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[15px] font-semibold">{race.name}</span>
            <span className="text-[13px] text-muted-foreground">A race · {keepDates(race.when)}</span>
          </span>
        </Link>
      )}
    </section>
  );
}

/** The season cards of the Plan list, for every user (D22); absent when there is no season. */
export function SeasonsSection({ seasons }: { seasons: SeasonCardView[] }) {
  if (seasons.length === 0) return null;
  return (
    <>
      {seasons.map((s) => (
        <SeasonCard key={s.id} season={s} />
      ))}
    </>
  );
}
