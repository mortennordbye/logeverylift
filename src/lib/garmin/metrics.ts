/**
 * Turns stored Garmin JSON (garmin_days, garmin_activities) into what the
 * Garmin page's Overview tab shows. Pure, so it is unit tested without the
 * database. Every field is read defensively: Garmin's JSON is not ours, and a
 * missing field shows as a gap, not a crash.
 */

export type GarminDayView = {
  date: string;
  hrvLastNight: number | null;
  hrvWeeklyAvg: number | null;
  hrvBaselineLow: number | null;
  hrvBaselineHigh: number | null;
  hrvStatus: string | null;
  sleepSeconds: number | null;
  deepSeconds: number | null;
  remSeconds: number | null;
  lightSeconds: number | null;
  awakeSeconds: number | null;
  sleepScore: number | null;
  restingHr: number | null;
  bodyBatteryMax: number | null;
  bodyBatteryMin: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  steps: number | null;
  stressAvg: number | null;
  intensityMinutes: number | null;
};

export type GarminActivityView = {
  id: number;
  startTimeLocal: string;
  type: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgHr: number | null;
  trainingLoad: number | null;
  aerobicEffect: number | null;
};

export type GarminWeekLoad = { weekStart: string; load: number; minutes: number; count: number };

export type GarminMetrics = {
  days: GarminDayView[];
  activities: GarminActivityView[];
  weeklyLoad: GarminWeekLoad[];
};

type Json = Record<string, unknown>;

function at(obj: unknown, ...keys: string[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[k];
  }
  return cur;
}

function num(obj: unknown, ...keys: string[]): number | null {
  const v = at(obj, ...keys);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(obj: unknown, ...keys: string[]): string | null {
  const v = at(obj, ...keys);
  return typeof v === "string" ? v : null;
}

/** GPS and place fields Garmin puts on an activity summary. Not stored: the tab doesn't use location. */
const LOCATION_KEYS = new Set([
  "startLatitude",
  "startLongitude",
  "endLatitude",
  "endLongitude",
  "locationName",
  "geoPolylineDTO",
  "polyline",
]);

export function stripActivityLocation<T extends Json>(activity: T): T {
  return Object.fromEntries(Object.entries(activity).filter(([k]) => !LOCATION_KEYS.has(k))) as T;
}

function emptyDay(date: string): GarminDayView {
  return {
    date,
    hrvLastNight: null,
    hrvWeeklyAvg: null,
    hrvBaselineLow: null,
    hrvBaselineHigh: null,
    hrvStatus: null,
    sleepSeconds: null,
    deepSeconds: null,
    remSeconds: null,
    lightSeconds: null,
    awakeSeconds: null,
    sleepScore: null,
    restingHr: null,
    bodyBatteryMax: null,
    bodyBatteryMin: null,
    bodyBatteryCharged: null,
    bodyBatteryDrained: null,
    steps: null,
    stressAvg: null,
    intensityMinutes: null,
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week holding `date` (YYYY-MM-DD). */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export type StoredDay = { calendarDate: string; kind: "hrv" | "sleep" | "daily"; data: unknown };
export type StoredActivity = { garminActivityId: number; data: unknown };

/**
 * One view row per date from `start` to `end` (inclusive, oldest first), so a
 * day with no data is a gap the charts can show. Activities newest first.
 * Weekly load covers the weeks that overlap the range.
 */
export function buildGarminMetrics(
  dayRows: StoredDay[],
  activityRows: StoredActivity[],
  start: string,
  end: string,
): GarminMetrics {
  const byDate = new Map<string, GarminDayView>();
  for (let d = start; d <= end; d = addDays(d, 1)) byDate.set(d, emptyDay(d));

  for (const row of dayRows) {
    const day = byDate.get(row.calendarDate);
    if (!day) continue;
    const j = row.data;
    if (row.kind === "hrv") {
      day.hrvLastNight = num(j, "lastNightAvg");
      day.hrvWeeklyAvg = num(j, "weeklyAvg");
      day.hrvBaselineLow = num(j, "baseline", "balancedLow");
      day.hrvBaselineHigh = num(j, "baseline", "balancedUpper");
      day.hrvStatus = str(j, "status");
    } else if (row.kind === "sleep") {
      day.sleepSeconds = num(j, "sleepTimeSeconds");
      day.deepSeconds = num(j, "deepSleepSeconds");
      day.remSeconds = num(j, "remSleepSeconds");
      day.lightSeconds = num(j, "lightSleepSeconds");
      day.awakeSeconds = num(j, "awakeSleepSeconds");
      day.sleepScore = num(j, "sleepScores", "overall", "value");
    } else {
      day.restingHr = num(j, "heartRate", "restingValue");
      day.bodyBatteryMax = num(j, "bodyBattery", "maxValue");
      day.bodyBatteryMin = num(j, "bodyBattery", "minValue");
      day.bodyBatteryCharged = num(j, "bodyBattery", "chargedValue");
      day.bodyBatteryDrained = num(j, "bodyBattery", "drainedValue");
      day.steps = num(j, "movement", "steps", "value");
      day.stressAvg = num(j, "stress", "avgLevel");
      const moderate = num(j, "intensityMinutes", "moderate");
      const vigorous = num(j, "intensityMinutes", "vigorous");
      // Garmin counts a vigorous minute double toward its weekly goal.
      day.intensityMinutes = moderate === null && vigorous === null ? null : (moderate ?? 0) + 2 * (vigorous ?? 0);
    }
  }

  const activities: GarminActivityView[] = activityRows
    .map((row) => ({
      id: row.garminActivityId,
      startTimeLocal: str(row.data, "startTimeLocal") ?? "",
      type: str(row.data, "activityType", "typeKey") ?? "other",
      durationSeconds: num(row.data, "duration"),
      distanceMeters: num(row.data, "distance"),
      avgHr: num(row.data, "averageHR"),
      trainingLoad: num(row.data, "activityTrainingLoad"),
      aerobicEffect: num(row.data, "aerobicTrainingEffect"),
    }))
    .filter((a) => a.startTimeLocal.slice(0, 10) >= start && a.startTimeLocal.slice(0, 10) <= end)
    .sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal));

  const weeks = new Map<string, GarminWeekLoad>();
  for (let w = weekStartOf(start); w <= end; w = addDays(w, 7)) weeks.set(w, { weekStart: w, load: 0, minutes: 0, count: 0 });
  for (const a of activities) {
    const week = weeks.get(weekStartOf(a.startTimeLocal.slice(0, 10)));
    if (!week) continue;
    week.load += a.trainingLoad ?? 0;
    week.minutes += (a.durationSeconds ?? 0) / 60;
    week.count += 1;
  }

  return {
    days: [...byDate.values()],
    activities,
    weeklyLoad: [...weeks.values()].map((w) => ({ ...w, load: Math.round(w.load), minutes: Math.round(w.minutes) })),
  };
}
