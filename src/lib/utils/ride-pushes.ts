/**
 * The push alerts of a running ride (docs/plans/bike-ride-logger.md, D7 and
 * 4.7): one when a step starts and one a minute before a step ends, worked
 * out from the frozen plan and the timeline at this moment. The server
 * rewrites the ride's `ride_pushes` rows from this after every ride event.
 *
 * Pure: no database, no clock. Times are epoch milliseconds.
 */

import type { RidePushKind } from "@/db/schema/push";
import { bikeStepRows } from "@/lib/utils/bike-ride-view";
import type { RidePlan, RideTimeline } from "@/lib/utils/ride-timeline";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";

export type RidePushPlan = { sendAt: number; kind: RidePushKind; title: string; body: string; stepIndex: number };

/** The payload the service worker shows (public/push-sw.js). */
export type PushPayload = { title: string; body: string; tag: string; url: string };

/** "45 s", "5 min", "1 min 30 s": a time with no colon, for push text. */
function pushTime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** "Work · 1 of 2" reads "Work" after "next". */
const word = (title: string) => title.split(" · ")[0];

/**
 * The alerts still to come, in time order. None unless the ride runs: a
 * paused or ended ride has none, and a pause or the end rewrites them away.
 * The walk stops at a step with no end time (a lap step, an open distance
 * step): its start is the last alert, as nothing after it has a time. The
 * last step's end is the ride's end, and its alert says so.
 */
export function ridePushSchedule(plan: RidePlan, t: RideTimeline, now: number, units: Units = DEFAULT_UNITS): RidePushPlan[] {
  const cur = t.current;
  if (t.status !== "running" || !cur || cur.endsAt === null) return [];
  // A push title stays short: the target without the words of an easy spin (the step word says it).
  const rows = bikeStepRows(plan, units).map((r) => ({ ...r, target: r.target?.replace(/ · easy spin$/, "") ?? null }));
  const n = plan.steps.length;
  const time = (i: number) => {
    const s = plan.steps[i].seconds;
    return s !== null ? pushTime(s) : rows[i].time;
  };
  const out: RidePushPlan[] = [];

  let i = cur.index;
  let end = cur.endsAt;
  // Seconds the step runs from where the walk sees it: the rest of the current step, the whole of a later one.
  let length = cur.remainingSeconds ?? 0;
  for (;;) {
    const after = i + 1 < n ? rows[i + 1] : null;
    if (length > 60 && end - 60_000 > now) {
      out.push({
        sendAt: end - 60_000,
        kind: "minute_left",
        title: after ? `1 min left · next ${word(after.title)}${after.target ? ` ${after.target}` : ""}` : "1 min left · last step",
        body: `Step ${i + 1} of ${n} · ${rows[i].title}`,
        stepIndex: i,
      });
    }
    if (!after) {
      out.push({ sendAt: end, kind: "done", title: "Ride done", body: `Step ${n} of ${n} · ${rows[i].title} done`, stepIndex: i });
      break;
    }
    out.push({
      sendAt: end,
      kind: "step",
      title: [after.title, after.target, time(i + 1)].filter(Boolean).join(" · "),
      body: `Step ${i + 2} of ${n} · ${rows[i].title} done`,
      stepIndex: i + 1,
    });
    i++;
    const seconds = plan.steps[i].seconds;
    if (seconds === null) break;
    end += seconds * 1000;
    length = seconds;
  }
  return out;
}

/** The notification tag of a ride: a new alert replaces the one before. */
export const ridePushTag = (rideId: number) => `ride-${rideId}`;

/** Where tapping an alert goes: the bike exercise in ride mode. */
export const ridePushUrl = (programId: number, programExerciseId: number) => `/programs/${programId}/workout/exercises/${programExerciseId}?ride=1`;
