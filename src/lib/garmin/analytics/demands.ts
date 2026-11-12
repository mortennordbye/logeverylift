/**
 * Training volume against what the race needs: hours per sport per week, the
 * longest session per week (the long-session ladder), ride-then-run bricks,
 * and the race checklist (docs/plans/garmin-insights-design.md, 2.13).
 * Pure: the query passes plain activity rows in.
 */

import { addDays, mondayOf } from "../dates";
import type { RaceDistance } from "./overview";
import type { Sport } from "./sport";

export type VolumeActivity = {
  id: number;
  sport: Sport;
  /** Local calendar date. */
  day: string;
  /** UTC start and end in ms, for brick detection. Null when unknown. */
  startMs: number | null;
  endMs: number | null;
  durationS: number;
  distanceM: number | null;
  /** Indoor sessions (treadmill, trainer) count for hours, not for the longest distance. */
  indoor: boolean;
};

export const ENDURANCE = ["swim", "bike", "run"] as const;
export type Endurance = (typeof ENDURANCE)[number];
export const VOLUME_SPORTS = ["swim", "bike", "run", "strength", "other"] as const satisfies readonly Sport[];

export type Longest = { id: number; durationS: number; distanceM: number | null };

export type VolumeWeek = {
  weekStart: string;
  hours: Record<Sport, number>;
  totalHours: number;
  longest: Record<Endurance, Longest | null>;
};

const emptyHours = (): Record<Sport, number> => ({ swim: 0, bike: 0, run: 0, strength: 0, other: 0 });

/** Is `a` a longer session than `b`? Swims by distance, rides and runs by time. */
function longer(sport: Endurance, a: VolumeActivity, b: Longest | null): boolean {
  if (!b) return true;
  if (sport === "swim") return (a.distanceM ?? 0) > (b.distanceM ?? 0);
  return a.durationS > b.durationS;
}

/** One row per Monday-start week from `from` to `to`, empty weeks included. */
export function weeklyVolume(activities: VolumeActivity[], from: string, to: string): VolumeWeek[] {
  const weeks = new Map<string, VolumeWeek>();
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
    weeks.set(w, { weekStart: w, hours: emptyHours(), totalHours: 0, longest: { swim: null, bike: null, run: null } });
  }
  for (const a of activities) {
    const w = weeks.get(mondayOf(a.day));
    if (!w) continue;
    const h = a.durationS / 3600;
    w.hours[a.sport] += h;
    w.totalHours += h;
    if (a.sport === "swim" || a.sport === "bike" || a.sport === "run") {
      if (longer(a.sport, a, w.longest[a.sport])) w.longest[a.sport] = { id: a.id, durationS: a.durationS, distanceM: a.distanceM };
    }
  }
  return [...weeks.values()];
}

/** A run that starts within this many minutes of a ride ending is a brick. */
export const BRICK_GAP_MIN = 15;

export type Brick = { rideId: number; runId: number; day: string; gapMin: number; runDurationS: number };

export function findBricks(activities: VolumeActivity[]): Brick[] {
  const rides = activities.filter((a) => a.sport === "bike" && a.endMs !== null);
  const runs = activities.filter((a) => a.sport === "run" && a.startMs !== null);
  const out: Brick[] = [];
  for (const run of runs) {
    const ride = rides
      .filter((r) => run.startMs! >= r.endMs! - 60_000 && run.startMs! - r.endMs! <= BRICK_GAP_MIN * 60_000)
      .sort((a, b) => b.endMs! - a.endMs!)[0];
    if (ride) out.push({ rideId: ride.id, runId: run.id, day: run.day, gapMin: Math.max(0, Math.round((run.startMs! - ride.endMs!) / 60_000)), runDurationS: run.durationS });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Checklist targets per race. Full distance from plan 2.13 (4.5 h ride, 2.5 h
 * run, 3.0 km continuous swim). 70.3 uses the same idea scaled to the race:
 * about 3 h ride, 1.75 h run, the race swim distance.
 */
export const DEMAND_TARGETS: Record<RaceDistance, { bikeS: number; runS: number; swimM: number }> = {
  full: { bikeS: 4.5 * 3600, runS: 2.5 * 3600, swimM: 3000 },
  half: { bikeS: 3 * 3600, runS: 1.75 * 3600, swimM: 1900 },
};

/** Windows the checklist looks back over, in days. */
export const LONG_WINDOW_DAYS = 56;
export const BRICK_WINDOW_DAYS = 28;
export const RAMP_WINDOW_DAYS = 42;
/** Ramp rate (fitness points per week) above this raises injury risk (plan 2.3). */
export const RAMP_LIMIT = 8;

export type DemandKey = "swim" | "bike" | "run" | "brick" | "ramp";

export type DemandRow = {
  key: DemandKey;
  label: string;
  /** "3.0 km", "4.5 h", "1", "≤ 8". */
  target: string;
  /** Best value in the window, as text. */
  best: string;
  /** 0 to 1, how far the best value is toward the target. */
  progress: number;
  met: boolean;
  /** The activity that set the best value, for a link. */
  activityId: number | null;
  /** The next safe step for a long session, as text, when the target is not met. */
  next: string | null;
};

export const hoursLabel = (s: number) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
};
export const kmLabel = (m: number) => `${(m / 1000).toFixed(1)} km`;

/**
 * The next long session to aim for: the longest of the last 4 weeks plus one
 * step (ride 30 min, run 15 min, swim 400 m), never past the target. These are
 * the usual long-session progressions; one step a week keeps the ramp safe.
 */
export const LONG_STEP = { bikeS: 30 * 60, runS: 15 * 60, swimM: 400 } as const;

function bestIn(activities: VolumeActivity[], sport: Endurance, from: string): VolumeActivity | null {
  let best: VolumeActivity | null = null;
  for (const a of activities) {
    if (a.sport !== sport || a.day < from) continue;
    if (sport === "swim" ? (a.distanceM ?? 0) > (best?.distanceM ?? 0) : a.durationS > (best?.durationS ?? 0)) best = a;
  }
  return best;
}

export function demandsChecklist(input: {
  activities: VolumeActivity[];
  distance: RaceDistance;
  today: string;
  /** Ramp rate per day over the last RAMP_WINDOW_DAYS days. */
  ramps: (number | null)[];
}): DemandRow[] {
  const { activities, distance, today } = input;
  const t = DEMAND_TARGETS[distance];
  const longFrom = addDays(today, -(LONG_WINDOW_DAYS - 1));
  const stepFrom = addDays(today, -27);
  const rows: DemandRow[] = [];

  const swim = bestIn(activities, "swim", longFrom);
  const swimRecent = bestIn(activities, "swim", stepFrom)?.distanceM ?? 0;
  const swimBest = swim?.distanceM ?? 0;
  rows.push({
    key: "swim",
    label: "Longest swim, 8 weeks",
    target: kmLabel(t.swimM),
    best: swim ? kmLabel(swimBest) : "none",
    progress: Math.min(1, swimBest / t.swimM),
    met: swimBest >= t.swimM,
    activityId: swim?.id ?? null,
    next: swimBest >= t.swimM ? null : kmLabel(Math.min(t.swimM, swimRecent + LONG_STEP.swimM)),
  });
  for (const [sport, targetS, step, label] of [
    ["bike", t.bikeS, LONG_STEP.bikeS, "Longest ride, 8 weeks"],
    ["run", t.runS, LONG_STEP.runS, "Longest run, 8 weeks"],
  ] as const) {
    const best = bestIn(activities, sport, longFrom);
    const recent = bestIn(activities, sport, stepFrom)?.durationS ?? 0;
    const s = best?.durationS ?? 0;
    rows.push({
      key: sport,
      label,
      target: hoursLabel(targetS),
      best: best ? hoursLabel(s) : "none",
      progress: Math.min(1, s / targetS),
      met: s >= targetS,
      activityId: best?.id ?? null,
      next: s >= targetS ? null : hoursLabel(Math.min(targetS, recent + step)),
    });
  }

  const brick = findBricks(activities).find((b) => b.day >= addDays(today, -(BRICK_WINDOW_DAYS - 1)));
  rows.push({
    key: "brick",
    label: `Ride then run (within ${BRICK_GAP_MIN} min), 4 weeks`,
    target: "1",
    best: brick ? `${hoursLabel(brick.runDurationS)} run` : "none",
    progress: brick ? 1 : 0,
    met: !!brick,
    activityId: brick?.runId ?? null,
    next: null,
  });

  const ramps = input.ramps.filter((r): r is number => r !== null);
  const maxRamp = ramps.length ? Math.max(...ramps) : null;
  rows.push({
    key: "ramp",
    label: "Ramp rate, 6 weeks",
    target: `≤ ${RAMP_LIMIT}/wk`,
    best: maxRamp === null ? "no data" : `max ${maxRamp.toFixed(1)}/wk`,
    progress: maxRamp === null ? 0 : maxRamp <= RAMP_LIMIT ? 1 : RAMP_LIMIT / maxRamp,
    met: maxRamp !== null && maxRamp <= RAMP_LIMIT,
    activityId: null,
    next: null,
  });
  return rows;
}

/** The rows ordered by the largest gap first, for the Overview block. */
export function byGap(rows: DemandRow[]): DemandRow[] {
  return [...rows].sort((a, b) => a.progress - b.progress);
}

// ── The plan ────────────────────────────────────────────────────────────────

export type PlannedSet = { discipline: Endurance; durationS: number | null; distanceM: number | null };

/** Speeds for turning a planned distance into time when there is no history: about 2:15/100 m, 27 km/h, 6:00/km. */
export const DEFAULT_SPEED_MPS: Record<Endurance, number> = { swim: 100 / 135, bike: 27 / 3.6, run: 1000 / 360 };

/**
 * Planned hours per sport for one week, from the endurance sets of the week's
 * programs. A set planned by distance is turned into time with the user's own
 * mean speed for the sport (`speeds`), else the defaults. Null when nothing
 * is planned.
 */
export function plannedHours(sets: PlannedSet[], speeds: Partial<Record<Endurance, number>> = {}): Record<Endurance, number> | null {
  const out: Record<Endurance, number> = { swim: 0, bike: 0, run: 0 };
  for (const s of sets) {
    const seconds = s.durationS ?? (s.distanceM ? s.distanceM / (speeds[s.discipline] ?? DEFAULT_SPEED_MPS[s.discipline]) : 0);
    out[s.discipline] += seconds / 3600;
  }
  // A cycle with no timed or measured endurance sets has no plan to compare.
  return out.swim + out.bike + out.run > 0 ? out : null;
}

/** Mean speed per sport (m/s) from outdoor sessions with distance, for plannedHours. */
export function meanSpeeds(activities: VolumeActivity[]): Partial<Record<Endurance, number>> {
  const out: Partial<Record<Endurance, number>> = {};
  for (const sport of ENDURANCE) {
    const xs = activities.filter((a) => a.sport === sport && !a.indoor && (a.distanceM ?? 0) > 0 && a.durationS > 0);
    const m = xs.reduce((s, a) => s + (a.distanceM ?? 0), 0);
    const t = xs.reduce((s, a) => s + a.durationS, 0);
    if (xs.length >= 3 && t > 0) out[sport] = m / t;
  }
  return out;
}
