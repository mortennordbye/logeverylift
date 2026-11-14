import type { HomeContext } from "@/lib/home/core";
import { dayMonth } from "@/lib/home/labels";
import { daysUntil } from "@/lib/home/widget-data";
import { listSeasons } from "@/lib/seasons";

/** The next A race: its name, date label, days to go and the season it belongs to. */
export type RaceCountdownData = { name: string; dateLabel: string; days: number; seasonId: number };

/**
 * The soonest A race on or after today (user's zone) across the user's live
 * seasons (listSeasons filters by userId). Null without one, for the empty state.
 */
export async function loadRaceCountdown(ctx: HomeContext): Promise<RaceCountdownData | null> {
  const seasons = await listSeasons(ctx.userId);
  const next = seasons
    .flatMap((s) => (s.aRace && s.aRace.raceDate >= ctx.today ? [{ race: s.aRace, seasonId: s.id }] : []))
    .sort((a, b) => a.race.raceDate.localeCompare(b.race.raceDate))[0];
  if (!next) return null;
  return { name: next.race.name, dateLabel: dayMonth(next.race.raceDate), days: daysUntil(ctx.today, next.race.raceDate), seasonId: next.seasonId };
}
