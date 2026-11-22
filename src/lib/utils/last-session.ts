/**
 * The home widget "Last session" as words (docs/plans/session-check.md,
 * decision 9): which day it shows, the match line, and one row per metric of
 * the session's sport judged over its work steps. The server reads the
 * sessions (src/components/features/home/widgets/last-session/load.ts); these
 * rules only shape them.
 */

import { formatEnduranceDistance } from "@/lib/utils/format";
import { rideClock } from "@/lib/utils/ride-screen";
import { judge, sessionVerdict, type CheckRow, type Mark, type StepCheck } from "@/lib/utils/session-check";
import { lengthText, type SessionMatch } from "@/lib/utils/session-match";
import { minSec } from "@/lib/utils/thresholds";
import type { Units } from "@/lib/utils/units";

export type LastSessionRow = { label: string; value: string; plan: string; mark: Mark };

export type LastSessionCard = {
  plannedSessionId: number;
  /** "Long ride · Sun 22 Nov". */
  title: string;
  /** "Matched to Garmin · Indoor Cycling · 2 h 16 min", or how it was logged. */
  match: string;
  rows: LastSessionRow[];
  time: LastSessionRow | null;
  /** The step page; null when the session has no steps to show. */
  href: string | null;
};

export type LastSessionData = { cards: LastSessionCard[] };

/**
 * The sessions the widget shows: the done bike and run sessions of the last
 * day that has any, in the day's order. Empty when there is none.
 */
export function lastDaySessions<T extends { date: string; position: number; state: string; sport: string | null }>(sessions: T[]): T[] {
  const done = sessions.filter((s) => s.state === "done" && (s.sport === "bike" || s.sport === "run"));
  const day = done.reduce<string | null>((a, s) => (a === null || s.date > a ? s.date : a), null);
  return done.filter((s) => s.date === day).sort((a, b) => a.position - b.position);
}

/**
 * The match line. The Garmin activity shows only when the match has one
 * (`sessionMatch` leaves it out where Garmin is not allowed); a run adds its
 * distance.
 */
export function matchLine(m: Pick<SessionMatch, "garmin" | "logged" | "sport"> | null, units?: Units): string {
  if (m?.garmin) {
    const g = m.garmin;
    return [
      "Matched to Garmin",
      g.name,
      ...(g.durationSeconds ? [lengthText(g.durationSeconds)] : []),
      ...(m.sport === "run" && g.distanceMeters ? [formatEnduranceDistance("km", Math.round(g.distanceMeters), units)] : []),
    ].join(" · ");
  }
  return m?.logged === "watch" ? "Logged on the watch" : "Logged in the app";
}

const METRICS = { bike: ["power", "hr", "cadence"], run: ["hr", "cadence", "pace"] } as const;
const LABEL: Record<CheckRow["metric"], string> = { power: "Power", hr: "Heart rate", cadence: "Cadence", pace: "Pace" };

function valueText(metric: CheckRow["metric"], v: number, sport: "bike" | "run"): string {
  const n = Math.round(v);
  if (metric === "power") return `${n} W`;
  if (metric === "cadence") return `${n} ${sport === "run" ? "spm" : "rpm"}`;
  if (metric === "pace") return `${minSec(n)} /km`;
  return `${n}`;
}

/** A session's length as the widget shows it: "20:00" under an hour, "2:16" from an hour on. */
export function clockText(seconds: number): string {
  if (seconds < 3600) return rideClock(seconds);
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** The time-weighted average of a metric over the done work steps, target or not. */
function workAverage(steps: StepCheck[], metric: CheckRow["metric"]): number | null {
  const w = steps.filter((s) => s.work && s.seconds !== null && s.measured[metric] !== null);
  const total = w.reduce((a, s) => a + s.seconds!, 0);
  return total > 0 ? w.reduce((a, s) => a + s.measured[metric]! * s.seconds!, 0) / total : null;
}

/**
 * One row per metric of the sport (decision 9), judged over the work steps
 * only (`sessionVerdict`): the time-weighted average, the plan's target
 * ("plan 140-149", "plan by step" when the work steps differ, "no target"),
 * and the mark. Pace outdoors is shown, not judged ("info"). A metric with
 * no target and no number is left out.
 */
export function metricRows(sport: "bike" | "run", steps: StepCheck[]): LastSessionRow[] {
  const verdicts = new Map(sessionVerdict(steps).map((v) => [v.metric, v]));
  const rows: LastSessionRow[] = [];
  for (const metric of METRICS[sport]) {
    const v = verdicts.get(metric);
    if (!v) {
      const avg = workAverage(steps, metric);
      if (avg !== null) rows.push({ label: LABEL[metric], value: valueText(metric, avg, sport), plan: "no target", mark: "none" });
      continue;
    }
    const plans = [...new Set(steps.filter((s) => s.work && s.seconds !== null).flatMap((s) => s.rows.filter((r) => r.metric === metric).map((r) => r.plan)))];
    const unjudgedPace = metric === "pace" && v.mark === "none" && v.actual !== null;
    rows.push({
      label: LABEL[metric],
      value: v.actual === null ? "–" : valueText(metric, v.actual, sport),
      plan: unjudgedPace ? "info" : plans.length === 1 ? `plan ${plans[0]}` : plans.length ? "plan by step" : "no target",
      mark: v.mark,
    });
  }
  return rows;
}

/**
 * The time row: the work steps' total against their plan, else (no timed
 * work step, as for a session confirmed by hand) the session's done time
 * against its planned time. Null with no time at all.
 */
export function timeRow(steps: StepCheck[], fallback: { done: number | null; planned: number | null }): LastSessionRow | null {
  const t = sessionVerdict(steps).find((v) => v.metric === "time");
  const [done, planned] = t && t.actual !== null ? [t.actual, t.planned] : [fallback.done, fallback.planned];
  if (!done) return null;
  return {
    label: "Time",
    value: clockText(done),
    plan: planned ? `plan ${clockText(planned)}` : "no target",
    mark: planned ? judge("time", done, { low: planned, high: planned }) : "none",
  };
}
