import type { SeasonSummary } from "@/lib/seasons";
import { dayLabel, daysBetweenStr } from "@/lib/utils/seasons";
import { ChevronRight, PlusIcon } from "lucide-react";
import Link from "next/link";

/**
 * The Seasons section at the top of /cycles (docs/plans/seasons.md, 2.10).
 * For every user (D22); the A race shows only with the endurance switch (D18)
 * or when the season already has one.
 */
export function SeasonsSection({ seasons, today, enduranceEnabled }: { seasons: SeasonSummary[]; today: string; enduranceEnabled: boolean }) {
  return (
    <section data-testid="seasons-section">
      <div className="flex items-center justify-between px-2 mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Seasons</p>
        <Link href="/seasons/new" className="flex items-center gap-1 text-primary text-sm font-medium min-h-[44px] active:opacity-70">
          <PlusIcon className="w-4 h-4" />
          New season
        </Link>
      </div>
      {seasons.length === 0 ? (
        <p className="text-sm text-muted-foreground px-2">A season is a long goal above your cycles, such as a race or “Bench 120 kg by summer”.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden">
          {seasons.map((s) => (
            <Link key={s.id} href={`/seasons/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[44px] active:bg-muted/50">
              <div className="min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {dayLabel(s.startDate)} to {dayLabel(s.endDate)}
                  {s.currentPhase ? ` · ${s.currentPhase}` : ""}
                </p>
                {(enduranceEnabled || s.aRace) && s.aRace && (
                  <p className="text-xs text-muted-foreground">
                    {s.aRace.name}
                    {s.aRace.raceDate >= today ? `, in ${daysBetweenStr(today, s.aRace.raceDate)} days` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.replanFlaggedAt && (
                  <span className="text-xs font-medium rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5">Re-plan needed</span>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
