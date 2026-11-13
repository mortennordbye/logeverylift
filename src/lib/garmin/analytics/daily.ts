/**
 * The daily series stored in garmin_daily_metrics: load per sport (Garmin
 * activities plus LogEveryLift strength sessions, each counted once), fitness,
 * fatigue and form, HRV state, resting HR trend, sleep debt and regularity.
 * Pure: the worker passes plain rows in and stores what comes out.
 *
 * A LogEveryLift session with strength sets counts whole as strength here, as in
 * model v2, even when it also holds a run or a ride: its endurance sets add no
 * load of their own (docs/plans/endurance-app.md, review fix 1). The app series
 * for users without Garmin (src/lib/training-load.ts) splits such a session by
 * sport instead. BACKLOG: "Per-sport split of mixed app sessions in the Garmin series".
 */

import { overlapShare, strengthLoad, type LoadMethod } from "./load";
import { computePmc, type PmcDay } from "./pmc";
import { hrvSeries, restingHrSeries, type HrvDay, type RestingHrDay } from "./recovery";
import { regularityIndex, sleepDebt, sleepTiming, type SleepNight, type SleepTiming } from "./sleep";
import type { Sport } from "./sport";
import { readiness, type Readiness } from "./readiness";
import { EMPTY_BANDS, addBands, type Bands } from "./zones";
import { pairWithGarmin } from "@/lib/utils/training-load";

// v3: app endurance sessions Garmin did not record count too (docs/plans/endurance-app.md, 6.4).
export const DAILY_MODEL_VERSION = 3;

/** Overlap needed for a Garmin strength activity and a LogEveryLift session to be one session. */
const SAME_SESSION_SHARE = 0.5;

export type ActivityInput = {
  garminActivityId: number;
  day: string;
  sport: Sport;
  load: number | null;
  loadMethod: LoadMethod;
  startMs: number | null;
  endMs: number | null;
  bands: Bands;
};

export type StrengthSessionInput = {
  sessionId: number;
  day: string;
  startMs: number;
  endMs: number | null;
  setRpes: (number | null)[];
  feeling: string | null;
};

/** An endurance session logged in the app, with its app load (src/lib/training-load.ts). */
export type AppEnduranceInput = {
  sessionId: number;
  day: string;
  sport: "swim" | "bike" | "run";
  durationS: number;
  load: number | null;
  method: LoadMethod;
};

export type DayInputs = {
  date: string;
  hrvMs: number | null;
  garminHrvLow: number | null;
  garminHrvHigh: number | null;
  restingHr: number | null;
  sleep: SleepNight | null;
  /** Mean LogEveryLift readiness (1 to 5) logged that day. */
  feel?: number | null;
};

export type DayEntry = {
  source: "garmin" | "logeverylift";
  id: number;
  sport: Sport;
  load: number;
  method: LoadMethod;
  /** For a Garmin strength activity counted with the matched LogEveryLift session's RPE. */
  matchedSessionId?: number;
};

export type DailyMetrics = {
  date: string;
  entries: DayEntry[];
  pmc: PmcDay["tracks"];
  calibrating: boolean;
  ramp: number | null;
  monotony: number | null;
  bands: Bands;
  hrv: Omit<HrvDay, "date">;
  restingHr: Omit<RestingHrDay, "date">;
  sleepDebtS: number | null;
  regularity: number | null;
  timing: SleepTiming;
  /** Since model v2. */
  sleepSeconds: number | null;
  sleepNeedS: number | null;
  readiness: Readiness | null;
};

/** Each LogEveryLift strength session is matched to at most one Garmin activity, and the other way round. */
export function matchStrength(activities: ActivityInput[], sessions: StrengthSessionInput[]): Map<number, StrengthSessionInput> {
  const matches = new Map<number, StrengthSessionInput>();
  const used = new Set<number>();
  for (const a of activities) {
    if (a.sport !== "strength" || a.startMs === null || a.endMs === null) continue;
    let best: { s: StrengthSessionInput; share: number } | null = null;
    for (const s of sessions) {
      if (used.has(s.sessionId) || s.endMs === null) continue;
      const share = overlapShare([a.startMs, a.endMs], [s.startMs, s.endMs]);
      if (share >= SAME_SESSION_SHARE && (!best || share > best.share)) best = { s, share };
    }
    if (best) {
      matches.set(a.garminActivityId, best.s);
      used.add(best.s.sessionId);
    }
  }
  return matches;
}

export function buildDailyMetrics(input: {
  start: string;
  end: string;
  activities: ActivityInput[];
  strengthSessions: StrengthSessionInput[];
  /** Since model v3. */
  appEndurance?: AppEnduranceInput[];
  days: DayInputs[];
}): DailyMetrics[] {
  const { start, end } = input;
  const matches = matchStrength(input.activities, input.strengthSessions);
  const matchedSessionIds = new Set([...matches.values()].map((s) => s.sessionId));

  const entries = new Map<string, DayEntry[]>();
  const bands = new Map<string, Bands>();
  const push = (day: string, e: DayEntry) => entries.set(day, [...(entries.get(day) ?? []), e]);

  for (const a of input.activities) {
    if (a.day < start || a.day > end) continue;
    bands.set(a.day, addBands(bands.get(a.day) ?? EMPTY_BANDS, a.bands));
    const session = matches.get(a.garminActivityId);
    if (session && a.startMs !== null && a.endMs !== null) {
      // Garmin's clock for the duration, LogEveryLift's sets for the effort.
      const s = strengthLoad((a.endMs - a.startMs) / 60_000, session.setRpes, session.feeling);
      if (s) {
        push(a.day, { source: "garmin", id: a.garminActivityId, sport: "strength", load: s.load, method: "srpe", matchedSessionId: session.sessionId });
        continue;
      }
    }
    if (a.load !== null) push(a.day, { source: "garmin", id: a.garminActivityId, sport: a.sport, load: a.load, method: a.loadMethod });
  }
  for (const s of input.strengthSessions) {
    if (matchedSessionIds.has(s.sessionId) || s.endMs === null || s.day < start || s.day > end) continue;
    const l = strengthLoad((s.endMs - s.startMs) / 60_000, s.setRpes, s.feeling);
    if (l) push(s.day, { source: "logeverylift", id: s.sessionId, sport: "strength", load: l.load, method: "srpe" });
  }

  // An app endurance session that a Garmin activity of the same sport and day
  // recorded adds nothing: Garmin measured it. One to one, closest duration
  // first (decision 16). Unpaired ones add their app load.
  // A session with strength sets already counts whole on the strength path above
  // (matched to a Garmin activity or not), so its endurance sets add nothing here:
  // a warm-up run inside a gym session must not count twice (review fix 1).
  const strengthIds = new Set(input.strengthSessions.map((s) => s.sessionId));
  const app = (input.appEndurance ?? []).filter((s) => s.day >= start && s.day <= end && !strengthIds.has(s.sessionId));
  const garminEndurance = input.activities
    .filter((a): a is ActivityInput & { sport: "swim" | "bike" | "run" } => a.sport === "swim" || a.sport === "bike" || a.sport === "run")
    .map((a) => ({ id: a.garminActivityId, sport: a.sport, date: a.day, durationS: a.startMs !== null && a.endMs !== null ? (a.endMs - a.startMs) / 1000 : null }));
  const paired = pairWithGarmin(app.map((s) => ({ id: s.sessionId, sport: s.sport, date: s.day, durationS: s.durationS })), garminEndurance);
  for (const s of app) {
    if (paired.has(s.sessionId) || s.load === null) continue;
    push(s.day, { source: "logeverylift", id: s.sessionId, sport: s.sport, load: s.load, method: s.method });
  }

  const loads: Record<string, Partial<Record<Sport, number>>> = {};
  for (const [day, list] of entries) {
    loads[day] = {};
    for (const e of list) loads[day][e.sport] = (loads[day][e.sport] ?? 0) + e.load;
  }
  const pmc = computePmc(loads, start, end);

  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const dates = pmc.map((p) => p.date);
  const hrv = hrvSeries(
    dates.map((date) => {
      const d = byDate.get(date);
      return { date, ms: d?.hrvMs ?? null, garminLow: d?.garminHrvLow ?? null, garminHigh: d?.garminHrvHigh ?? null };
    }),
  );
  const rhr = restingHrSeries(dates.map((date) => ({ date, bpm: byDate.get(date)?.restingHr ?? null })));
  const nights: SleepNight[] = dates.map(
    (date) => byDate.get(date)?.sleep ?? { date, start: null, end: null, sleepSeconds: null, needSeconds: null, napSeconds: null },
  );

  return pmc.map((p, i) => {
    const upTo = nights.slice(0, i + 1);
    const withoutDate = <T extends { date: string }>(row: T): Omit<T, "date"> => {
      const copy: Partial<T> = { ...row };
      delete copy.date;
      return copy as Omit<T, "date">;
    };
    const hrvDay = withoutDate(hrv[i]);
    const rhrDay = withoutDate(rhr[i]);
    const debt = sleepDebt(upTo);
    const night = nights[i];
    const feel = [dates[i - 1], dates[i]].map((d) => (d ? byDate.get(d)?.feel : null)).filter((f): f is number => typeof f === "number");
    return {
      date: p.date,
      entries: entries.get(p.date) ?? [],
      pmc: p.tracks,
      calibrating: p.calibrating,
      ramp: p.ramp,
      monotony: p.monotony,
      bands: bands.get(p.date) ?? EMPTY_BANDS,
      hrv: hrvDay,
      restingHr: rhrDay,
      sleepDebtS: debt,
      regularity: regularityIndex(upTo),
      timing: sleepTiming(upTo),
      sleepSeconds: night.sleepSeconds,
      sleepNeedS: night.needSeconds,
      readiness: readiness({
        hrv: { lastNight: hrv[i].ms, mean7: hrv[i].mean7, bandLow: hrv[i].bandLow, bandHigh: hrv[i].bandHigh, state: hrv[i].state },
        restingHr: { today: rhr[i].bpm, baseline: rhr[i].baseline, sd: rhr[i].sd, flag: rhr[i].flag },
        sleep: { seconds: night.sleepSeconds, needSeconds: night.needSeconds },
        sleepDebtS: debt,
        // Form on the morning of the day, and only once fitness has calibrated.
        tsb: p.calibrating ? null : p.tracks.total.tsb,
        feel,
      }),
    };
  });
}

/** The first and last date the daily series covers: from the oldest stored day to today. */
export function seriesRange(oldestDay: string | null, today: string): { start: string; end: string } | null {
  if (!oldestDay || oldestDay > today) return null;
  return { start: oldestDay, end: today };
}

export type BodyBatteryDay = {
  /** Garmin's key levels for the day, local wall-clock ms (written as UTC), oldest first. */
  points: { t: number; level: number }[];
  /** What charged or drained it: sleep, activities, stress, with Garmin's feedback code. */
  events: { type: string; start: number; minutes: number; impact: number; feedback: string | null }[];
};

/**
 * The body_battery daily report: bodyBatteryValuesArray holds [GMT ms, level]
 * pairs (a few key points, not a full curve) and bodyBatteryActivityEvent the
 * events. Null when the day has no levels.
 */
export function bodyBatteryDay(j: Record<string, unknown> | null, offsetMs: number): BodyBatteryDay | null {
  const pairs = Array.isArray(j?.bodyBatteryValuesArray) ? (j!.bodyBatteryValuesArray as unknown[][]) : [];
  const points = pairs
    .filter((p) => typeof p?.[0] === "number" && typeof p?.[1] === "number")
    .map((p) => ({ t: (p[0] as number) + offsetMs, level: p[1] as number }))
    .sort((a, b) => a.t - b.t);
  if (!points.length) return null;
  const raw = Array.isArray(j?.bodyBatteryActivityEvent) ? (j!.bodyBatteryActivityEvent as Record<string, unknown>[]) : [];
  const events = raw.flatMap((e) => {
    const start = typeof e.eventStartTimeGmt === "string" ? Date.parse(`${e.eventStartTimeGmt.replace(/\.\d+$/, "")}Z`) : NaN;
    const impact = typeof e.bodyBatteryImpact === "number" ? e.bodyBatteryImpact : null;
    if (!Number.isFinite(start) || impact === null) return [];
    const tz = typeof e.timezoneOffset === "number" ? e.timezoneOffset : offsetMs;
    const ms = typeof e.durationInMilliseconds === "number" ? e.durationInMilliseconds : 0;
    const feedback = typeof e.shortFeedback === "string" && e.shortFeedback !== "NONE" ? e.shortFeedback : null;
    return [{ type: String(e.eventType ?? "EVENT"), start: start + tz, minutes: Math.round(ms / 60000), impact, feedback }];
  });
  return { points, events: events.sort((a, b) => a.start - b.start) };
}
