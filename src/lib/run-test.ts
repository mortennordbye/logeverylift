/**
 * A run threshold test's result as the summary and get_ride show it
 * (docs/plans/run-logger.md, 4.10): the pure `runTestView` with the run's
 * step timings and belt taps, the thresholds of now to compare with, and
 * whether it is saved: a live test row of protocol run_30min, measured on the
 * run's date, with this value, for every value the test gives.
 *
 * Plain server code: callers resolve the user.
 */

import { testThresholdSaved } from "@/lib/athlete-profile";
import { thresholdValues } from "@/lib/session-compliance";
import type { RidePlan, RideTimeline } from "@/lib/utils/ride-timeline";
import { runTestCurrent, runTestSteps, runTestThresholds, runTestView, type RunTestLog, type RunTestView } from "@/lib/utils/run-test";
import { localDateStr } from "@/lib/utils/user-date";

export type RunThresholdTest = RunTestView & { measuredOn: string };

/** A belt tap inside a test step: its step key, or its time when it has none. */
function beltTapped(plan: RidePlan, timeline: Pick<RideTimeline, "steps">, events: { kind: string; at: number; stepKey?: string | null }[]): boolean {
  const idx = runTestSteps(plan.steps);
  if (!idx) return false;
  const keys = [idx.first, idx.last].filter((i): i is number => i !== null).map((i) => plan.steps[i].key);
  const spans = timeline.steps.filter((s) => keys.includes(s.key));
  return events.some((e) => e.kind === "belt" && (e.stepKey ? keys.includes(e.stepKey) : spans.some((s) => e.at >= s.startedAt && e.at < s.endedAt)));
}

export async function runThresholdTest(
  userId: string,
  ride: { plan: RidePlan; startedAt: Date | number; timeZone: string | null },
  logs: Record<number, RunTestLog>,
  timeline: Pick<RideTimeline, "steps">,
  events: { kind: string; at: number; stepKey?: string | null }[],
): Promise<RunThresholdTest | null> {
  if (ride.plan.test !== "30min") return null;
  const view = runTestView({
    plan: ride.plan,
    logs,
    timing: timeline.steps,
    beltEvents: beltTapped(ride.plan, timeline, events),
    current: runTestCurrent(await thresholdValues(userId)),
  });
  if (!view) return null;
  const measuredOn = localDateStr(new Date(ride.startedAt), ride.timeZone);
  if (!view.result) return { ...view, measuredOn };
  const rows = runTestThresholds(view.result);
  const saved = (await Promise.all(rows.map((r) => testThresholdSaved(userId, { kind: r.kind, protocol: "run_30min", measuredOn, value: r.value })))).every(Boolean);
  return { ...view, saved, measuredOn };
}
