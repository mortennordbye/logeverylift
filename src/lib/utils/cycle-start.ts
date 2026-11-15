/**
 * What a start or a schedule does to the user's other cycles, in words. Only
 * one cycle runs and only one draft is scheduled at a time
 * (`activateInSession` and `scheduleCycle` in src/lib/plan-revisions.ts):
 * starting a draft ends the running cycle and drops any other scheduled
 * start, and scheduling a draft drops any other scheduled start. When that
 * start is a season's next phase, the season pauses until the user resumes
 * it (chainSeason).
 */

import { cycleWeek, parseDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr, shortDay } from "@/lib/utils/seasons";

/** How far ahead a block can be scheduled to start. */
export const MAX_SCHEDULE_DAYS = 120;

/** The last day a block can be scheduled to start on. */
export const latestStartDay = (today: string) => addDaysStr(today, MAX_SCHEDULE_DAYS);

/**
 * Why a block cannot start on `start`: it is before today, or more than
 * MAX_SCHEDULE_DAYS ahead. Null when it can. The app and the assistant's
 * manage_training_cycle start both check it, each in its own words.
 */
export function startDayProblem(start: string, today: string): "past" | "too_far" | null {
  if (start < today) return "past";
  return start > latestStartDay(today) ? "too_far" : null;
}

/**
 * The running cycle and the week of it that holds today. `startDate` and
 * `durationDays` let a screen work out the week on a later start day.
 */
export type RunningCycle = { id: number; name: string; week: number; totalWeeks: number; startDate?: string; durationDays?: number | null };
/** The draft scheduled to start on a later day, and its season when it is a phase of one. */
export type ScheduledDraft = { id: number; name: string; day: string; season: { id: number; name: string } | null };

/** "This ends Upper / Lower at week 3 of 6.", or null when no other cycle runs. */
export function endsRunningLine(cycleId: number, running: RunningCycle | null | undefined): string | null {
  if (!running || running.id === cycleId) return null;
  return `This ends ${running.name} at week ${running.week} of ${running.totalWeeks}.`;
}

/**
 * The last week a running cycle from `startDate` runs when another cycle
 * starts on `day`: the week of the day before (week 1 when that is its own
 * first day), not the week it would have entered on `day` (round 8).
 */
export function lastRunWeek(startDate: string, totalWeeks: number, durationDays: number | null | undefined, day: string): number {
  return cycleWeek(parseDateStr(startDate), totalWeeks, parseDateStr(addDaysStr(day, -1)), durationDays).currentWeek;
}

/**
 * The running cycle as it stands when another cycle starts on `day`: the last
 * week it runs (lastRunWeek), or null when it has ended by then (a scheduled
 * start ends it only on that day, startDueScheduledCycle).
 */
export function runningOn(running: RunningCycle | null | undefined, day: string): RunningCycle | null {
  if (!running) return null;
  if (!running.startDate) return running;
  const at = cycleWeek(parseDateStr(running.startDate), running.totalWeeks, parseDateStr(day), running.durationDays);
  return at.isOver ? null : { ...running, week: lastRunWeek(running.startDate, running.totalWeeks, running.durationDays, day) };
}

/**
 * What a start or a schedule does to the draft scheduled now, in the same
 * words on every screen that chooses one:
 * - "Strength peak no longer starts Mon 23 Nov." for a standalone draft;
 * - "Jevnaker Half 2027 pauses. Its next phase no longer starts Mon 16 Nov.
 *   You can resume it from the season." for a season's next phase.
 * Null when nothing else is scheduled, or the scheduled one is this cycle or
 * a phase of this cycle's own season (that chain moves on by itself).
 * `cycleId` is null for a cycle not made yet.
 */
export function dropsScheduledLine(cycleId: number | null, scheduled: ScheduledDraft | null | undefined, seasonId: number | null = null): string | null {
  if (!scheduled || scheduled.id === cycleId) return null;
  if (!scheduled.season) return `${scheduled.name} no longer starts ${shortDay(scheduled.day)}.`;
  if (scheduled.season.id === seasonId) return null;
  return `${scheduled.season.name} pauses. Its next phase no longer starts ${shortDay(scheduled.day)}. You can resume it from the season.`;
}
