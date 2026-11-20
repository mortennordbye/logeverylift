/**
 * A run's Garmin state for the summary and get_ride (docs/plans/run-logger.md,
 * 4.8 and 4.9): the fill that stands (Undo), the Garmin runs to pick from,
 * the stream numbers and the plan against done chart of the filled run's own
 * part of its activity, and T2 from the transition of a multisport file.
 *
 * Plain server code: callers resolve the user. Streams are read only for the
 * filled activity.
 */

import { db } from "@/db";
import { rideEvents } from "@/db/schema";
import { garminAllowedFor } from "@/lib/garmin/access";
import { sportOf } from "@/lib/garmin/analytics/sport";
import { endedRideOf, garminFillState, rideSplit, type RideActivity, type RideGarminView } from "@/lib/ride-garmin";
import type { RideSplit } from "@/lib/utils/ride-stream";
import type { RidePlan, RideTimeline } from "@/lib/utils/ride-timeline";
import { runStepBounds, type RunStreamView } from "@/lib/utils/run-results";
import { beltSpans, runDoneChart, runStreamNumbers } from "@/lib/utils/run-stream";
import { asc, eq } from "drizzle-orm";

export type RunGarminView = Omit<RideGarminView, "stream"> & {
  stream: (RunStreamView & { split: RideSplit["method"] }) | null;
  /** T2 in seconds from the transition before the run in a multisport file; null without one. */
  t2Seconds: number | null;
};

const NONE: RunGarminView = { state: "none", garminActivityId: null, declined: false, candidates: [], stream: null, t2Seconds: null };

/** The transition before the run's part of a multisport file, when a ride comes before it: T2 (4.8). */
export function garminT2(a: Pick<RideActivity, "segment" | "segments">): number | null {
  const k = a.segment;
  if (k < 2 || a.segments.length <= k) return null;
  const tr = a.segments[k - 1];
  return tr.typeKey === "transition" && sportOf(a.segments[k - 2].typeKey) === "bike" ? Math.round(tr.seconds) : null;
}

/** The stream numbers and chart of a run from its filled activity. */
export function runStreamView(plan: RidePlan, t: RideTimeline, a: RideActivity, events: { kind: string; value: number | null; at: number; stepKey?: string | null }[]): RunStreamView & { split: RideSplit["method"] } {
  const split = rideSplit(t, a);
  const input = {
    streams: a.streams,
    t0Ms: a.t0Ms,
    split,
    plan,
    belts: plan.mode === "indoor" ? beltSpans(plan, t.steps, events.map((e, i) => ({ seq: i + 1, kind: e.kind as never, value: e.value, at: e.at, stepKey: e.stepKey ?? null }))) : null,
    bounds: runStepBounds(plan),
  };
  return { split: split.method, numbers: runStreamNumbers(input), chart: runDoneChart(input) };
}

/** The run's Garmin state. Garmin access only; else nothing. */
export async function runGarminView(userId: string, rideId: number): Promise<RunGarminView> {
  if (!(await garminAllowedFor(userId))) return NONE;
  const found = await endedRideOf(userId, rideId, "run");
  if (!found) return NONE;
  const { ride, t } = found;
  const g = await garminFillState(userId, ride, t);
  const base = { state: g.state, garminActivityId: g.garminActivityId, declined: g.declined, candidates: g.candidates, stream: null, t2Seconds: null };
  const a = g.activity;
  if (g.state !== "filled" || !a) return base;
  const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  return {
    ...base,
    garminActivityId: a.garminActivityId,
    stream: runStreamView(ride.plan as RidePlan, t, a, events.map((e) => ({ kind: e.kind, value: e.value, at: e.at.getTime(), stepKey: e.stepKey }))),
    t2Seconds: garminT2(a),
  };
}
