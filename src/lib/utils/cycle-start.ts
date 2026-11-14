/**
 * What a start or a schedule does to the user's other cycles, in words. Only
 * one cycle runs and only one draft is scheduled at a time
 * (`activateInSession` and `scheduleCycle` in src/lib/plan-revisions.ts):
 * starting a draft ends the running cycle and drops any other scheduled
 * start, and scheduling a draft drops any other scheduled start.
 */

import { shortDay } from "@/lib/utils/seasons";

/** The running cycle and the week of it that holds today. */
export type RunningCycle = { id: number; name: string; week: number; totalWeeks: number };
/** The draft scheduled to start on a later day. */
export type ScheduledDraft = { id: number; name: string; day: string };

/** "This ends Upper / Lower at week 3 of 6.", or null when no other cycle runs. */
export function endsRunningLine(cycleId: number, running: RunningCycle | null | undefined): string | null {
  if (!running || running.id === cycleId) return null;
  return `This ends ${running.name} at week ${running.week} of ${running.totalWeeks}.`;
}

/** "Strength peak no longer starts Mon 23 Nov.", or null when no other draft is scheduled. */
export function dropsScheduledLine(cycleId: number, scheduled: ScheduledDraft | null | undefined): string | null {
  if (!scheduled || scheduled.id === cycleId) return null;
  return `${scheduled.name} no longer starts ${shortDay(scheduled.day)}.`;
}
