/**
 * Every Garmin Personal API data endpoint LogEveryLift stores, and how its
 * answer becomes rows in garmin_days (one row per user, date and kind).
 * Paths and range limits are from Garmin's Personal API Swagger page; the
 * table in docs/plans/garmin-deep-data.md lists them with measured shapes.
 *
 * - range: one call covers start..end (at most maxDays days).
 * - day: one call per date.
 * - snapshot: no date; stored under the date it was fetched, so changes
 *   (new HR zones, profile edits) stay visible over time.
 *
 * Activities are not here: they have their own tables and pipeline (sync.ts).
 */

export const GARMIN_DAY_KINDS = [
  "hrv",
  "sleep",
  "daily",
  "steps",
  "stress",
  "hydration",
  "weight",
  "weight_entries",
  "weight_goal",
  "wellness_activity",
  "body_battery",
  "hrv_detail",
  "sleep_detail",
  "heart_rate",
  "spo2",
  "user_summary",
  "fitness_age",
  "food",
  "menstrual_summary",
  "menstrual_day",
  "profile",
  "hr_zones",
] as const;

export type GarminDayKind = (typeof GARMIN_DAY_KINDS)[number];

export type DayRow = { date: string; data: unknown };

type Base = { kind: GarminDayKind; label: string };
export type RangeEndpoint = Base & {
  scope: "range";
  maxDays: number;
  path: (start: string, end: string) => string;
  split: (json: unknown, start: string, end: string) => DayRow[];
};
export type DayEndpoint = Base & {
  scope: "day";
  path: (date: string, today: string) => string;
  /** Whether a 200 answer still means "nothing recorded" (Garmin often returns an empty shell). */
  empty?: (json: unknown) => boolean;
};
export type SnapshotEndpoint = Base & { scope: "snapshot"; path: () => string };
export type GarminEndpoint = RangeEndpoint | DayEndpoint | SnapshotEndpoint;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** The calendar date an item belongs to, from the field names Garmin uses. */
export function dateOf(item: unknown): string | null {
  if (!isObject(item)) return null;
  for (const key of ["calendarDate", "summaryDate", "date", "mealDate"]) {
    const v = item[key];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

/** One row per item, keyed by its date. Items without a date are dropped. */
function byDate(items: unknown): DayRow[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const date = dateOf(item);
    return date ? [{ date, data: item }] : [];
  });
}

/** For endpoints that can hold several items a day: one row per date with { items }. */
function groupedByDate(items: unknown): DayRow[] {
  const groups = new Map<string, unknown[]>();
  for (const row of byDate(items)) groups.set(row.date, [...(groups.get(row.date) ?? []), row.data]);
  return [...groups].map(([date, list]) => ({ date, data: { items: list } }));
}

function field(json: unknown, key: string): unknown {
  return isObject(json) ? json[key] : undefined;
}

export function isEmptyAnswer(json: unknown): boolean {
  if (json === null || json === undefined) return true;
  if (Array.isArray(json)) return json.length === 0;
  if (isObject(json)) return Object.keys(json).length === 0;
  return false;
}

export const GARMIN_ENDPOINTS: GarminEndpoint[] = [
  {
    kind: "hrv",
    label: "HRV summary",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/hrv-service/hrv/daily/${s}/${e}`,
    split: (json) => byDate(field(json, "hrvSummaries")),
  },
  {
    kind: "sleep",
    label: "Sleep summary",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${s}&endDate=${e}`,
    split: byDate,
  },
  {
    kind: "daily",
    label: "Daily summary",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/usersummary-service/v2/dailysummaries?startDate=${s}&endDate=${e}`,
    split: (json) => byDate(field(json, "data")),
  },
  {
    kind: "steps",
    label: "Steps",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/usersummary-service/stats/steps/daily/${s}/${e}`,
    split: byDate,
  },
  {
    kind: "stress",
    label: "Stress",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/usersummary-service/stats/stress/daily/${s}/${e}`,
    split: byDate,
  },
  {
    kind: "hydration",
    label: "Hydration",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/usersummary-service/stats/hydration/daily/${s}/${e}`,
    split: byDate,
  },
  {
    kind: "weight",
    label: "Weight (daily)",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/weight-service/weight/range/${s}/${e}?includeAll=true`,
    split: (json) => byDate(field(json, "dailyWeightSummaries")),
  },
  {
    kind: "weight_entries",
    label: "Weight entries",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/weight-service/weight/all/${s}/${e}`,
    split: groupedByDate,
  },
  {
    kind: "weight_goal",
    label: "Weight goal",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/goal-service/goal/user/effective/weightgoal/${s}/${e}`,
    // One answer for the whole range: kept under its last day, and only when a goal is set.
    split: (json, _s, e) => (Array.isArray(field(json, "userGoals")) && (field(json, "userGoals") as unknown[]).length ? [{ date: e, data: json }] : []),
  },
  {
    kind: "wellness_activity",
    label: "Wellness activities",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/wellnessactivity-service/activity/summary/range/${s}/${e}`,
    split: groupedByDate,
  },
  {
    kind: "body_battery",
    label: "Body battery",
    scope: "range",
    maxDays: 28,
    path: (s, e) => `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${s}&endDate=${e}`,
    split: byDate,
  },
  { kind: "hrv_detail", label: "HRV readings (overnight)", scope: "day", path: (d) => `/hrv-service/hrv/${d}` },
  { kind: "sleep_detail", label: "Sleep detail", scope: "day", path: (d) => `/sleep-service/sleep/dailySleep?date=${d}` },
  {
    kind: "heart_rate",
    label: "Heart rate (all day)",
    scope: "day",
    path: (d) => `/wellness-service/wellness/dailyHeartRate?date=${d}`,
    empty: (json) => !Array.isArray(field(json, "heartRateValues")) || (field(json, "heartRateValues") as unknown[]).length === 0,
  },
  { kind: "spo2", label: "SpO2", scope: "day", path: (d) => `/wellness-service/wellness/daily/spo2acclimation/${d}` },
  { kind: "user_summary", label: "Daily summary (full)", scope: "day", path: (d) => `/usersummary-service/usersummary/daily?calendarDate=${d}` },
  { kind: "fitness_age", label: "Fitness age", scope: "day", path: (d) => `/fitnessage-service/fitnessage/v2/${d}` },
  {
    kind: "food",
    label: "Food log",
    scope: "day",
    path: (d) => `/nutrition-service/food/logs/${d}`,
    empty: (json) => {
      const foods = field(json, "loggedFoodsWithServingSizes");
      return !Array.isArray(foods) || foods.length === 0;
    },
  },
  { kind: "menstrual_summary", label: "Menstrual cycle summary", scope: "day", path: (d) => `/periodichealth-service/menstrualcycle/summary/${d}` },
  {
    kind: "menstrual_day",
    label: "Menstrual cycle day",
    scope: "day",
    path: (d, today) => `/periodichealth-service/menstrualcycle/dayview/${d}?todayDate=${today}`,
  },
  { kind: "profile", label: "Profile settings", scope: "snapshot", path: () => "/userprofile-service/userprofile/settings" },
  { kind: "hr_zones", label: "Heart rate zones", scope: "snapshot", path: () => "/biometric-service/heartRateZones/v2" },
];

export const RANGE_ENDPOINTS = GARMIN_ENDPOINTS.filter((e): e is RangeEndpoint => e.scope === "range");
export const DAY_ENDPOINTS = GARMIN_ENDPOINTS.filter((e): e is DayEndpoint => e.scope === "day");
export const SNAPSHOT_ENDPOINTS = GARMIN_ENDPOINTS.filter((e): e is SnapshotEndpoint => e.scope === "snapshot");

export function endpointLabel(kind: string): string {
  return GARMIN_ENDPOINTS.find((e) => e.kind === kind)?.label ?? kind;
}
