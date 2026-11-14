/**
 * What a season's chain does to the user's other blocks when it takes the one
 * scheduled start (chainSeason with `claim`, resumeSeason), in the shared
 * words of src/lib/utils/cycle-start.ts. A season start on a later day ends
 * the running cycle on that day and drops any other scheduled start now.
 */

import { dropsScheduledLine, endsRunningLine, lastRunWeek, type ScheduledDraft } from "@/lib/utils/cycle-start";

/** The running cycle, with what it takes to say which week of it a later day falls in. */
export type RunningBlock = {
  id: number;
  name: string;
  startDate: string;
  durationWeeks: number;
  durationDays: number | null;
  /** The live season it is a phase of, if any. */
  seasonId: number | null;
};

/**
 * The lines for a season phase that starts on `day`: the running cycle ends
 * then, and the other scheduled start is dropped. `seasonId` is null for a
 * season not made yet. `joining` are cycles that become phases of this season
 * in the same step: a running one joining means nothing ends, so nothing is
 * claimed (chainSeason) and there are no lines.
 */
export function takeStartLines(opts: {
  seasonId: number | null;
  day: string;
  running: RunningBlock | null;
  scheduled: ScheduledDraft | null;
  joining?: number[];
}): string[] {
  const joining = opts.joining ?? [];
  const { running, scheduled } = opts;
  if (running && joining.includes(running.id)) return [];
  const ends =
    running && (running.seasonId == null || running.seasonId !== opts.seasonId)
      ? endsRunningLine(0, {
          id: running.id,
          name: running.name,
          week: lastRunWeek(running.startDate, running.durationWeeks, running.durationDays, opts.day),
          totalWeeks: running.durationWeeks,
        })
      : null;
  const drops = scheduled && !joining.includes(scheduled.id) ? dropsScheduledLine(null, scheduled, opts.seasonId) : null;
  return [ends, drops].filter((l): l is string => l != null);
}
