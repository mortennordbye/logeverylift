/** Pure parts of the after-ride view (docs/plans/bike-sessions.md, 5.5 and 7.3). */

import type { Workout, WorkoutStep } from "@/lib/utils/workout-steps";
import { FTP_TEST_STEP_ID } from "@/lib/utils/workout-templates";

/** "65 of 65 min"; null without both times. */
export function minutesOf(doneSeconds: number | null, plannedSeconds: number | null): string | null {
  if (!doneSeconds || !plannedSeconds) return null;
  return `${Math.round(doneSeconds / 60)} of ${Math.round(plannedSeconds / 60)} min`;
}

/** A long ride asks "Carbs taken?" (the fuel rule starts at 60 min; a ride of 90 min or more needs it). */
export const LONG_RIDE_SECONDS = 90 * 60;

/** The 40-60 g carbs per hour target, for a ride of this length. */
export function carbsTarget(seconds: number): { low: number; high: number } {
  const h = seconds / 3600;
  return { low: Math.round(40 * h), high: Math.round(60 * h) };
}

const FTP_TEST_SECONDS = 20 * 60;

/**
 * The key of the 20 min all-out step of an FTP test (7.3): the template's
 * step (id FTP_TEST_STEP_ID), a 20 min work or steady step whose note says
 * "all out", or the only such step of a workout named as an FTP test.
 */
export function ftpTestStepKey(workout: Workout, keyed: { key: string; step: WorkoutStep }[]): string | null {
  const twenty = keyed.filter((k) => (k.step.type === "work" || k.step.type === "steady") && k.step.end.type === "time" && k.step.end.seconds === FTP_TEST_SECONDS);
  const byId = twenty.find((k) => k.step.id === FTP_TEST_STEP_ID);
  if (byId) return byId.key;
  const allOut = twenty.find((k) => /all[\s-]?out/i.test(k.step.note ?? ""));
  if (allOut) return allOut.key;
  return /ftp\s*test/i.test(workout.name) && twenty.length === 1 ? twenty[0].key : null;
}

/** 95 % of the 20 min average power, in whole watts. */
export function ftpFromTwenty(avgPower: number): number {
  return Math.round(avgPower * 0.95);
}
