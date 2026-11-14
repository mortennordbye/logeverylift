/**
 * What a start or a schedule does to the user's other cycles, in words. Only
 * one cycle runs and only one draft is scheduled at a time
 * (`activateInSession` and `scheduleCycle` in src/lib/plan-revisions.ts):
 * starting a draft ends the running cycle and drops any other scheduled
 * start, and scheduling a draft drops any other scheduled start. When that
 * start is a season's next phase, the season pauses until the user resumes
 * it (chainSeason).
 */

import { shortDay } from "@/lib/utils/seasons";

/** The running cycle and the week of it that holds today. */
export type RunningCycle = { id: number; name: string; week: number; totalWeeks: number };
/** The draft scheduled to start on a later day, and its season when it is a phase of one. */
export type ScheduledDraft = { id: number; name: string; day: string; season: { id: number; name: string } | null };

/** "This ends Upper / Lower at week 3 of 6.", or null when no other cycle runs. */
export function endsRunningLine(cycleId: number, running: RunningCycle | null | undefined): string | null {
  if (!running || running.id === cycleId) return null;
  return `This ends ${running.name} at week ${running.week} of ${running.totalWeeks}.`;
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
