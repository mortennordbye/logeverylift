import { db } from "@/db";
import { liveCycles, liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { exercises, garminActivities, garminActivityMetrics, garminActivityStreams, garminConnections, garminDailyMetrics, garminDays, garminFuelLogs, programExercises, programSets, programs, trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { ActivityMetrics } from "./analytics/activity";
import { sessionZoneMessage } from "./analytics/thresholds";
import { lttbIndices, takeIndices } from "./charts/downsample";
import { bodyBatteryDay, type BodyBatteryDay, type DailyMetrics } from "./analytics/daily";
import { insightsFor, type Insight } from "./analytics/insights";
import { sessionInsights } from "./analytics/session-insights";
import type { CorrelationDay } from "./analytics/correlations";
import { addDays, isoDate, mondayOf } from "./dates";
import { garminToday } from "./today";

export { garminToday };
import { TRACKS, type PmcPoint, type Track } from "./analytics/pmc";
import { SPORTS, isIndoor, sportOf, type Sport } from "./analytics/sport";
import type { LoadSeries } from "./charts/load";
import { projectPmc, type Projection } from "./analytics/projection";
import { efPoints, thresholdHistory, type EfPoint, type TrendActivity } from "./analytics/trends";
import { compareBricks, pacingGuide, taperStart, type BrickComparison, type FuelSession, type PacingGuide, type RunSummary } from "./analytics/race";
import type { Efforts } from "./analytics/efforts";
import type { Decoupling } from "./analytics/decoupling";
import type { RatingContext } from "./analytics/norms";
import { HRV_STATUS_LABEL, bodySignal, rollingMean, intensityWeek, parseFitnessAge, raceStatus, type BodySignal, type FitnessAge, type IntensityWeek, type CycleForRace, type RaceDistance, type RaceStatus } from "./analytics/overview";
import {
  RAMP_WINDOW_DAYS,
  demandsChecklist,
  findBricks,
  meanSpeeds,
  plannedHours,
  weeklyVolume,
  type Brick,
  type DemandRow,
  type Endurance,
  type PlannedSet,
  type VolumeActivity,
  type VolumeWeek,
} from "./analytics/demands";

/**
 * Reads for the Garmin page's Server Components. Each takes a userId the
 * page already resolved with requireSession(); every query filters by it.
 */

const r1 = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n * 10) / 10 : 0);

/** The daily series for the Load tab, as columns. Only the JSON paths the tab uses are read. */
export async function getLoadSeries(userId: string): Promise<{ series: LoadSeries; computedAt: string | null }> {
  const rows = await db
    .select({
      day: garminDailyMetrics.day,
      pmc: sql<Record<Track, PmcPoint>>`${garminDailyMetrics.metrics}->'pmc'`,
      bands: sql<{ low: number; mid: number; high: number }>`${garminDailyMetrics.metrics}->'bands'`,
      calibrating: sql<boolean>`(${garminDailyMetrics.metrics}->>'calibrating')::boolean`,
    })
    .from(garminDailyMetrics)
    .where(eq(garminDailyMetrics.userId, userId))
    .orderBy(asc(garminDailyMetrics.day));
  const [conn] = await db
    .select({ computedAt: garminConnections.metricsComputedAt })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId));

  const tracks = Object.fromEntries(TRACKS.map((t) => [t, { ctl: [] as number[], atl: [] as number[], tsb: [] as number[] }])) as LoadSeries["tracks"];
  const loads = Object.fromEntries(SPORTS.map((s) => [s, [] as number[]])) as Record<Sport, number[]>;
  const series: LoadSeries = { dates: [], calibrating: [], tracks, loads, bands: { low: [], mid: [], high: [] } };
  for (const row of rows) {
    series.dates.push(row.day);
    series.calibrating.push(Boolean(row.calibrating));
    for (const t of TRACKS) {
      const p = row.pmc?.[t];
      tracks[t].ctl.push(r1(p?.ctl));
      tracks[t].atl.push(r1(p?.atl));
      tracks[t].tsb.push(r1(p?.tsb));
    }
    for (const s of SPORTS) loads[s].push(r1(row.pmc?.[s]?.load));
    series.bands.low.push(Math.round(row.bands?.low ?? 0));
    series.bands.mid.push(Math.round(row.bands?.mid ?? 0));
    series.bands.high.push(Math.round(row.bands?.high ?? 0));
  }
  return { series, computedAt: conn?.computedAt?.toISOString() ?? null };
}

// ── Today ───────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Garmin's "2026-11-05T00:00:00.0" local or GMT strings as epoch ms (read as UTC). */
const wall = (v: unknown): number | null => (typeof v === "string" ? Date.parse(`${v.replace(" ", "T").replace(/\.\d+$/, "")}Z`) : null);

export type TodayActivity = { id: number; name: string; sport: Sport; start: number; end: number; load: number | null; avgHr: number | null };

export type TodayData = {
  date: string;
  /** Oldest and newest dates with any daily metrics, for the day picker. */
  firstDate: string | null;
  lastDate: string | null;
  /** The timeline window in local wall-clock ms (written as UTC): the evening before to midnight. */
  window: [number, number];
  hr: { t: number[]; bpm: (number | null)[] };
  spo2: { t: number[]; value: number[] };
  hrvNight: { t: number[]; ms: number[] };
  sleep: { start: number; end: number; seconds: number | null; deep: number | null; light: number | null; rem: number | null; awake: number | null; score: number | null; needS: number | null } | null;
  restingHr: number | null;
  activities: TodayActivity[];
  summary: {
    steps: number | null;
    activeKcal: number | null;
    intensityMin: number | null;
    stressAvg: number | null;
    stress: { rest: number; low: number; medium: number; high: number } | null;
    bbHigh: number | null;
    bbLow: number | null;
    bbAtWake: number | null;
    bbCharged: number | null;
    bbDrained: number | null;
    respiration: number | null;
  };
  metrics: DailyMetrics | null;
  /** Garmin's body battery key levels and the events that moved it, for the day. */
  bodyBattery: BodyBatteryDay | null;
  strip: { date: string; readiness: number | null; load: number }[];
  insights: Insight[];
};

/** The newest date with Garmin day data, or today. */
export async function latestGarminDate(userId: string): Promise<string> {
  const [row] = await db
    .select({ d: sql<string | null>`max(${garminDays.calendarDate})::text` })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), inArray(garminDays.kind, ["heart_rate", "sleep", "hrv"])));
  return row?.d ?? new Date().toISOString().slice(0, 10);
}

export async function getTodayData(userId: string, date: string): Promise<TodayData> {
  const prev = addDays(date, -1);
  const rows = await db
    .select({ date: garminDays.calendarDate, kind: garminDays.kind, data: garminDays.data })
    .from(garminDays)
    .where(
      and(
        eq(garminDays.userId, userId),
        inArray(garminDays.calendarDate, [prev, date]),
        inArray(garminDays.kind, ["heart_rate", "hrv_detail", "spo2", "sleep", "user_summary", "body_battery"]),
      ),
    );
  const get = (d: string, kind: string) => (rows.find((r) => r.date === d && r.kind === kind)?.data ?? null) as Json | null;

  // Local = GMT + offset, from the day's heart-rate or summary start times.
  const offsetFrom = (j: Json | null) => {
    const local = wall(j?.startTimestampLocal);
    const gmt = wall(j?.startTimestampGMT);
    return local !== null && gmt !== null ? local - gmt : null;
  };
  const offset = offsetFrom(get(date, "heart_rate")) ?? offsetFrom(get(date, "spo2")) ?? offsetFrom(get(prev, "heart_rate")) ?? 0;
  const window: [number, number] = [Date.parse(`${prev}T18:00:00Z`), Date.parse(`${addDays(date, 1)}T00:00:00Z`)];
  const inWindow = (t: number) => t >= window[0] && t <= window[1];

  const hr = { t: [] as number[], bpm: [] as (number | null)[] };
  for (const d of [prev, date]) {
    const values = get(d, "heart_rate")?.heartRateValues;
    if (!Array.isArray(values)) continue;
    for (const pair of values as [number, number | null][]) {
      const t = pair[0] + offset;
      if (inWindow(t) && !hr.t.includes(t)) {
        hr.t.push(t);
        hr.bpm.push(num(pair[1]));
      }
    }
  }

  const spo2 = { t: [] as number[], value: [] as number[] };
  for (const pair of (get(date, "spo2")?.spO2HourlyAverages ?? []) as [number, number][]) {
    const t = pair[0] + offset;
    if (inWindow(t) && num(pair[1])) {
      spo2.t.push(t);
      spo2.value.push(pair[1]);
    }
  }

  const hrvNight = { t: [] as number[], ms: [] as number[] };
  for (const r of (get(date, "hrv_detail")?.hrvReadings ?? []) as Json[]) {
    const t = wall(r.readingTimeLocal);
    const v = num(r.hrvValue);
    if (t !== null && v !== null) {
      hrvNight.t.push(t);
      hrvNight.ms.push(v);
    }
  }

  const s = get(date, "sleep");
  const sleepStart = num(s?.sleepStartTimestampLocal);
  const sleepEnd = num(s?.sleepEndTimestampLocal);
  const scores = (s?.sleepScores ?? {}) as Json;
  const need = num((s?.sleepNeed as Json | undefined)?.actual);
  const sleep =
    sleepStart && sleepEnd
      ? {
          start: sleepStart,
          end: sleepEnd,
          seconds: num(s?.sleepTimeSeconds),
          deep: num(s?.deepSleepSeconds),
          light: num(s?.lightSleepSeconds),
          rem: num(s?.remSleepSeconds),
          awake: num(s?.awakeSleepSeconds),
          score: num((scores.overall as Json | undefined)?.value),
          needS: need !== null ? need * 60 : null,
        }
      : null;

  const activityRows = await db
    .select({ id: garminActivities.garminActivityId, start: garminActivities.startTimeLocal, data: garminActivities.data, sport: garminActivityMetrics.sport, load: garminActivityMetrics.load })
    .from(garminActivities)
    .leftJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivities.userId), eq(garminActivityMetrics.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(
      and(
        eq(garminActivities.userId, userId),
        gte(garminActivities.startTimeLocal, new Date(window[0])),
        lt(garminActivities.startTimeLocal, new Date(window[1])),
      ),
    )
    .orderBy(asc(garminActivities.startTimeLocal));
  const activities: TodayActivity[] = activityRows.map((a) => {
    const j = (a.data ?? {}) as Json;
    const start = a.start.getTime();
    return {
      id: a.id,
      name: typeof j.activityName === "string" ? j.activityName : "Activity",
      sport: (a.sport ?? "other") as Sport,
      start,
      end: start + (num(j.duration) ?? 0) * 1000,
      load: a.load,
      avgHr: num(j.averageHR),
    };
  });

  const u = get(date, "user_summary") ?? {};
  const stressRest = num(u.restStressDuration);
  const metricRows = await db
    .select({ day: garminDailyMetrics.day, metrics: garminDailyMetrics.metrics })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, addDays(date, -89)), lte(garminDailyMetrics.day, date)))
    .orderBy(asc(garminDailyMetrics.day));
  const series = metricRows.map((r) => r.metrics as DailyMetrics);
  const [bounds] = await db
    .select({ first: sql<string | null>`min(${garminDailyMetrics.day})::text`, last: sql<string | null>`max(${garminDailyMetrics.day})::text` })
    .from(garminDailyMetrics)
    .where(eq(garminDailyMetrics.userId, userId));

  const metrics = series.at(-1)?.date === date ? series.at(-1)! : null;
  const strip = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) => {
    const m = series.find((x) => x.date === d);
    return { date: d, readiness: m?.readiness?.score ?? null, load: m ? Math.round(m.pmc.total.load) : 0 };
  });

  return {
    date,
    firstDate: bounds?.first ?? null,
    lastDate: bounds?.last ?? null,
    window,
    hr,
    spo2,
    bodyBattery: bodyBatteryDay(get(date, "body_battery"), offset),
    hrvNight,
    sleep,
    restingHr: num(get(date, "heart_rate")?.restingHeartRate) ?? num(u.restingHeartRate),
    activities,
    summary: {
      steps: num(u.totalSteps),
      activeKcal: num(u.activeKilocalories),
      intensityMin: num(u.moderateIntensityMinutes) !== null ? (num(u.moderateIntensityMinutes) ?? 0) + 2 * (num(u.vigorousIntensityMinutes) ?? 0) : null,
      stressAvg: num(u.averageStressLevel),
      stress:
        stressRest !== null
          ? { rest: stressRest, low: num(u.lowStressDuration) ?? 0, medium: num(u.mediumStressDuration) ?? 0, high: num(u.highStressDuration) ?? 0 }
          : null,
      bbHigh: num(u.bodyBatteryHighestValue),
      bbLow: num(u.bodyBatteryLowestValue),
      bbAtWake: num(u.bodyBatteryAtWakeTime),
      bbCharged: num(u.bodyBatteryChargedValue),
      bbDrained: num(u.bodyBatteryDrainedValue),
      respiration: num(u.avgWakingRespirationValue),
    },
    metrics,
    strip,
    insights: metrics ? insightsFor(series) : [],
  };
}

// ── Sleep ───────────────────────────────────────────────────────────────────

export type SleepNightRow = {
  date: string;
  start: number | null;
  end: number | null;
  seconds: number | null;
  needS: number | null;
  deep: number | null;
  light: number | null;
  rem: number | null;
  awake: number | null;
  score: number | null;
};

export type SleepTabData = {
  nights: SleepNightRow[];
  /** Daily series for the same dates (HRV, resting HR, debt, regularity, timing). */
  days: (Pick<DailyMetrics, "date" | "hrv" | "restingHr" | "sleepDebtS" | "regularity" | "timing"> & { load: number })[];
  stress: { date: string; rest: number; low: number; medium: number; high: number }[];
};

export async function getSleepData(userId: string, days = 90): Promise<SleepTabData> {
  const end = await latestGarminDate(userId);
  const start = addDays(end, -(days - 1));
  const rows = await db
    .select({ date: garminDays.calendarDate, kind: garminDays.kind, data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), gte(garminDays.calendarDate, start), lte(garminDays.calendarDate, end), inArray(garminDays.kind, ["sleep", "user_summary"])))
    .orderBy(asc(garminDays.calendarDate));
  const metricRows = await db
    .select({ metrics: garminDailyMetrics.metrics })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, start), lte(garminDailyMetrics.day, end)))
    .orderBy(asc(garminDailyMetrics.day));

  const nights: SleepNightRow[] = rows
    .filter((r) => r.kind === "sleep")
    .map((r) => {
      const j = (r.data ?? {}) as Json;
      const need = num((j.sleepNeed as Json | undefined)?.actual);
      return {
        date: r.date,
        start: num(j.sleepStartTimestampLocal),
        end: num(j.sleepEndTimestampLocal),
        seconds: num(j.sleepTimeSeconds),
        needS: need !== null ? need * 60 : null,
        deep: num(j.deepSleepSeconds),
        light: num(j.lightSleepSeconds),
        rem: num(j.remSleepSeconds),
        awake: num(j.awakeSleepSeconds),
        score: num(((j.sleepScores as Json | undefined)?.overall as Json | undefined)?.value),
      };
    });
  const stress = rows
    .filter((r) => r.kind === "user_summary")
    .map((r) => {
      const j = (r.data ?? {}) as Json;
      return { date: r.date, rest: num(j.restStressDuration) ?? 0, low: num(j.lowStressDuration) ?? 0, medium: num(j.mediumStressDuration) ?? 0, high: num(j.highStressDuration) ?? 0 };
    })
    .filter((s) => s.rest + s.low + s.medium + s.high > 0);
  return {
    nights,
    days: metricRows.map((r) => {
      const m = r.metrics as DailyMetrics;
      return { date: m.date, hrv: m.hrv, restingHr: m.restingHr, sleepDebtS: m.sleepDebtS, regularity: m.regularity, timing: m.timing, load: r1(m.pmc.total.load) };
    }),
    stress,
  };
}

// ── Activities ──────────────────────────────────────────────────────────────

export type ActivityListRow = {
  id: number;
  name: string;
  typeKey: string;
  sport: Sport;
  start: number;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  load: number | null;
  loadMethod: string | null;
  hrPreview: (number | null)[];
  /** Garmin flagged a personal record in this activity. */
  pr: boolean;
};

export type ActivitiesData = {
  calendar: { date: string; load: number; sport: Sport | null }[];
  list: ActivityListRow[];
};

export async function getActivitiesData(userId: string, limit = 120): Promise<ActivitiesData> {
  const days = await db
    .select({ day: garminDailyMetrics.day, pmc: sql<Record<string, PmcPoint>>`${garminDailyMetrics.metrics}->'pmc'` })
    .from(garminDailyMetrics)
    .where(eq(garminDailyMetrics.userId, userId))
    .orderBy(asc(garminDailyMetrics.day));
  const calendar = days.map((d) => {
    let main: Sport | null = null;
    let best = 0;
    for (const s of SPORTS) {
      const l = d.pmc?.[s]?.load ?? 0;
      if (l > best) {
        best = l;
        main = s;
      }
    }
    return { date: d.day, load: Math.round(d.pmc?.total?.load ?? 0), sport: main };
  });

  const rows = await db
    .select({
      id: garminActivities.garminActivityId,
      typeKey: garminActivities.activityType,
      start: garminActivities.startTimeLocal,
      data: garminActivities.data,
      sport: garminActivityMetrics.sport,
      load: garminActivityMetrics.load,
      loadMethod: garminActivityMetrics.loadMethod,
      hrPreview: sql<(number | null)[] | null>`${garminActivityMetrics.metrics}->'hrPreview'`,
    })
    .from(garminActivities)
    .leftJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivities.userId), eq(garminActivityMetrics.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(eq(garminActivities.userId, userId))
    .orderBy(desc(garminActivities.startTimeLocal))
    .limit(limit);
  return {
    calendar,
    list: rows.map((r) => {
      const j = (r.data ?? {}) as Json;
      return {
        id: r.id,
        name: typeof j.activityName === "string" ? j.activityName : r.typeKey.replaceAll("_", " "),
        typeKey: r.typeKey,
        sport: (r.sport ?? sportOf(r.typeKey)) as Sport,
        start: r.start.getTime(),
        durationS: num(j.duration),
        distanceM: num(j.distance),
        avgHr: num(j.averageHR),
        load: r.load,
        loadMethod: r.loadMethod,
        hrPreview: r.hrPreview ?? [],
        pr: j.isPR === true,
      };
    }),
  };
}

export type ActivityDetail = {
  id: number;
  name: string;
  typeKey: string;
  sport: Sport;
  start: number;
  summary: Json;
  metrics: ActivityMetrics | null;
  /** Columnar, cut to at most MAX_POINTS at the same indices. t in seconds from start. */
  streams: Partial<Record<string, (number | null)[]>>;
  laps: Json[];
  sets: Json[];
  hrZoneFloors: number[] | null;
  matchedSessionId: number | null;
  /** Carbohydrate and fluid the user logged for this session. */
  fuel: { carbsG: number | null; fluidMl: number | null } | null;
  /** Garmin's stamina in % at the start and end, and its lowest point (activity detail summaryDTO). */
  stamina: { start: number; end: number; min: number | null } | null;
  /** Garmin's activity detail summary (summaryDTO): feel, RPE, recovery HR, compliance, temperature. */
  dto: Json | null;
};

const MAX_POINTS = 3000;

export async function getActivityDetail(userId: string, id: number): Promise<ActivityDetail | null> {
  const [a] = await db
    .select({
      id: garminActivities.garminActivityId,
      typeKey: garminActivities.activityType,
      start: garminActivities.startTimeLocal,
      data: garminActivities.data,
      dto: sql<Json | null>`${garminActivities.detail}->'summaryDTO'`,
    })
    .from(garminActivities)
    .where(and(eq(garminActivities.userId, userId), eq(garminActivities.garminActivityId, id)));
  if (!a) return null;
  const [m] = await db
    .select({ metrics: garminActivityMetrics.metrics, day: garminActivityMetrics.day })
    .from(garminActivityMetrics)
    .where(and(eq(garminActivityMetrics.userId, userId), eq(garminActivityMetrics.garminActivityId, id)));
  const [s] = await db
    .select({ streams: garminActivityStreams.streams, laps: garminActivityStreams.laps, sets: garminActivityStreams.sets, timeInZone: garminActivityStreams.timeInZone })
    .from(garminActivityStreams)
    .where(and(eq(garminActivityStreams.userId, userId), eq(garminActivityStreams.garminActivityId, id)));

  let streams = (s?.streams ?? {}) as Record<string, (number | null)[]>;
  if (streams.t && streams.t.length > MAX_POINTS) streams = takeIndices(streams, lttbIndices(streams.t, streams.hr ?? streams.power ?? streams.speed ?? streams.t, MAX_POINTS));

  // A strength activity matched to a LogEveryLift session (daily metrics entries).
  let matchedSessionId: number | null = null;
  if (m?.day) {
    const [d] = await db
      .select({ entries: sql<{ id: number; matchedSessionId?: number }[]>`${garminDailyMetrics.metrics}->'entries'` })
      .from(garminDailyMetrics)
      .where(and(eq(garminDailyMetrics.userId, userId), eq(garminDailyMetrics.day, m.day)));
    matchedSessionId = d?.entries?.find((e) => e.id === id)?.matchedSessionId ?? null;
  }

  const [fuel] = await db
    .select({ carbsG: garminFuelLogs.carbsG, fluidMl: garminFuelLogs.fluidMl })
    .from(garminFuelLogs)
    .where(and(eq(garminFuelLogs.userId, userId), eq(garminFuelLogs.garminActivityId, id)));

  const zone = sessionZoneMessage(s?.timeInZone);
  const highs = Array.isArray(zone?.hrZoneHighBoundary) ? (zone!.hrZoneHighBoundary as number[]) : null;
  const j = (a.data ?? {}) as Json;
  return {
    id: a.id,
    name: typeof j.activityName === "string" ? j.activityName : a.typeKey.replaceAll("_", " "),
    typeKey: a.typeKey,
    sport: sportOf(a.typeKey),
    start: a.start.getTime(),
    summary: j,
    metrics: (m?.metrics ?? null) as ActivityMetrics | null,
    streams,
    laps: (s?.laps ?? []) as Json[],
    sets: (s?.sets ?? []) as Json[],
    hrZoneFloors: highs && highs.length >= 6 ? highs.slice(0, 5) : null,
    matchedSessionId,
    fuel: fuel ?? null,
    stamina: staminaOf(a.dto),
    dto: a.dto ?? null,
  };
}

function staminaOf(dto: Json | null): ActivityDetail["stamina"] {
  const start = num(dto?.beginPotentialStamina);
  const end = num(dto?.endPotentialStamina);
  if (start === null || end === null) return null;
  const min = num(dto?.minAvailableStamina);
  return { start: Math.round(start), end: Math.round(end), min: min === null ? null : Math.round(min) };
}

// ── Overview ────────────────────────────────────────────────────────────────

export type ActiveCycle = CycleForRace & { id: number };

/** The user's active training cycle, with its race fields. */
export async function getActiveCycle(userId: string): Promise<ActiveCycle | null> {
  const [c] = await db
    .select({
      id: trainingCycles.id,
      name: trainingCycles.name,
      startDate: trainingCycles.startDate,
      durationWeeks: trainingCycles.durationWeeks,
      goal: trainingCycles.goal,
      athleteLevel: trainingCycles.athleteLevel,
      raceDate: trainingCycles.raceDate,
      raceDistance: trainingCycles.raceDistance,
    })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), liveCycles))
    .orderBy(desc(trainingCycles.createdAt))
    .limit(1);
  return c ?? null;
}

export type BodyKey =
  | "sleep"
  | "sleepScore"
  | "hrv"
  | "restingHr"
  | "respiration"
  | "bodyBattery"
  | "vo2max"
  | "fitnessAge"
  | "weight"
  | "deepSleep"
  | "remSleep"
  | "sleepStress"
  | "awakeCount"
  | "spo2"
  | "sleepHr"
  | "steps"
  | "stress"
  | "sedentary"
  | "muscleMass"
  | "floors"
  | "distance"
  | "activeTime"
  | "calories"
  | "altitude"
  | "boneMass"
  | "bodyWater"
  | "bodyFat";

export type OverviewData = {
  date: string;
  cycleId: number | null;
  race: RaceStatus | null;
  readiness: DailyMetrics["readiness"];
  strip: { date: string; readiness: number | null }[];
  insights: Insight[];
  body: Record<BodyKey, BodySignal>;
  /** Which of Garmin's two VO2 max values the tile shows. */
  vo2Sport: "run" | "bike";
  /** Garmin's own HRV status word for the day ("Balanced"), and its 7-day average. */
  hrvStatus: { label: string; weeklyAvg: number | null; nightHigh: number | null } | null;
  /** Intensity minutes this week against the goal set in Garmin. */
  intensity: IntensityWeek;
  /** What the tiles' population ratings need (analytics/norms.ts). */
  rating: RatingContext;
  /** The newest night's stages in seconds, with Garmin's optimal share (%) per stage. */
  night: NightStages | null;
  /** Steps on each of the last 7 complete days (null for a day with none), and the Garmin step goal. */
  stepsWeek: { date: string; steps: number | null }[];
  stepGoal: number | null;
  /** Garmin's floors goal, and resting calories on the last complete day. */
  floorGoal: number | null;
  bmr: number | null;
  /** Fitness, fatigue and form for the last 42 days, all sports. */
  pmc: { dates: string[]; ctl: number[]; atl: number[]; tsb: number[]; calibrating: boolean };
  last: (ActivityListRow & { decoupling: ActivityMetrics["decoupling"] }) | null;
};

const daysAgo = (date: string, n: number) => addDays(date, -n);

export async function getOverviewData(userId: string, nowArg?: string): Promise<OverviewData> {
  // Body data is shown for the newest Garmin day; the race counts from today where the user is.
  // Reads that do not depend on each other run together.
  const [now, date] = await Promise.all([nowArg ?? garminToday(userId), latestGarminDate(userId)]);
  const metricRowsQ = db
    .select({ metrics: garminDailyMetrics.metrics })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, daysAgo(date, 89)), lte(garminDailyMetrics.day, date)))
    .orderBy(asc(garminDailyMetrics.day));

  const dayRowsQ = db
    .select({ date: garminDays.calendarDate, kind: garminDays.kind, data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), gte(garminDays.calendarDate, daysAgo(date, 120)), lte(garminDays.calendarDate, date), inArray(garminDays.kind, ["user_summary", "weight", "sleep", "fitness_age", "hrv", "steps"])))
    .orderBy(asc(garminDays.calendarDate));
  const points = (kind: string, pick: (j: Json) => number | null) =>
    dayRows.flatMap((r) => {
      if (r.kind !== kind) return [];
      const v = pick((r.data ?? {}) as Json);
      return v === null ? [] : [{ date: r.date, value: v }];
    });

  // Garmin's VO2 max from the watch files (fit.ts, vo2MaxFromMessage), one point per activity day.
  const vo2RowsQ = db
    .select({ day: garminActivityMetrics.day, sport: garminActivityMetrics.sport, vo2: sql<number | null>`(${garminActivityStreams.session}->>'garminVo2Max')::float` })
    .from(garminActivityStreams)
    .innerJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivityStreams.userId), eq(garminActivityMetrics.garminActivityId, garminActivityStreams.garminActivityId)),
    )
    .where(and(eq(garminActivityStreams.userId, userId), gte(garminActivityMetrics.day, daysAgo(date, 180)), sql`${garminActivityStreams.session}->>'garminVo2Max' is not null`))
    .orderBy(asc(garminActivityMetrics.day));
  const profileQ = db.select({ gender: users.gender, birthYear: users.birthYear }).from(users).where(eq(users.id, userId));
  const [metricRows, dayRows, vo2Rows, [profile], cycle] = await Promise.all([metricRowsQ, dayRowsQ, vo2RowsQ, profileQ, getActiveCycle(userId)]);
  const series = metricRows.map((r) => r.metrics as DailyMetrics);
  const today = series.at(-1)?.date === date ? series.at(-1)! : null;

  // Running VO2 max when the user runs with a watch that has one; else the cycling one.
  const vo2Sport: "run" | "bike" = vo2Rows.some((r) => r.sport === "run") ? "run" : "bike";
  const vo2ByDay = new Map(vo2Rows.flatMap((r) => (r.vo2 !== null && r.sport === vo2Sport ? [[r.day, r.vo2] as const] : [])));

  const from = (pick: (m: DailyMetrics) => number | null) =>
    series.flatMap((m) => {
      const v = pick(m);
      return v === null || v === undefined ? [] : [{ date: m.date, value: v }];
    });
  const hrvBand: [number, number] | null = today?.hrv.bandLow != null && today.hrv.bandHigh != null ? [today.hrv.bandLow, today.hrv.bandHigh] : null;
  const body: Record<BodyKey, BodySignal> = {
    sleep: bodySignal(from((m) => (m.sleepSeconds !== null ? m.sleepSeconds / 3600 : null)), date, { days: 90, fresh: 14 }),
    hrv: bodySignal(from((m) => m.hrv.ms), date, { band: hrvBand, days: 90, fresh: 14 }),
    restingHr: bodySignal(from((m) => m.restingHr.bpm), date, { days: 90, fresh: 14 }),
    vo2max: bodySignal([...vo2ByDay].map(([d, v]) => ({ date: d, value: v })), date, { days: 90 }),
    sleepScore: bodySignal(points("sleep", (j) => num(((j.sleepScores as Json | undefined)?.overall as Json | undefined)?.value)), date, { days: 90, fresh: 14 }),
    respiration: bodySignal(points("sleep", (j) => num(j.averageRespirationValue)), date, { days: 90, fresh: 14 }),
    bodyBattery: bodySignal(points("user_summary", (j) => num(j.bodyBatteryAtWakeTime) ?? num(j.bodyBatteryHighestValue)), date, { days: 90, fresh: 14 }),
    fitnessAge: bodySignal(points("fitness_age", (j) => parseFitnessAge(j)?.age ?? null), date, { days: 90 }),
    weight: bodySignal(
      points("weight", (j) => {
        const w = num((j.latestWeight as Json | undefined)?.weight);
        return w !== null ? Math.round(w / 100) / 10 : null;
      }),
      date,
      { days: 90 },
    ),
    ...sleepQualitySignals(points, date),
    ...dayToDaySignals(points, date),
  };

  const hrvToday = dayRows.find((r) => r.kind === "hrv" && r.date === date)?.data as Json | undefined;
  const hrvLabel = typeof hrvToday?.status === "string" ? (HRV_STATUS_LABEL[hrvToday.status] ?? null) : null;
  const summaries = dayRows.flatMap((r) => (r.kind === "user_summary" ? [{ date: r.date, data: (r.data ?? {}) as Json }] : []));

  // Ratings: sex and age from the profile (age falls back to Garmin's), Garmin's HRV baseline, the newest weigh-in.
  const latest = (kind: string) => dayRows.findLast((r) => r.kind === kind)?.data as Json | undefined;
  const chronologicalAge = num(latest("fitness_age")?.chronologicalAge);
  const baseline = hrvToday?.baseline as Json | undefined;
  const [lowUpper, balancedLow, balancedUpper, weeklyAvg] = [num(baseline?.lowUpper), num(baseline?.balancedLow), num(baseline?.balancedUpper), num(hrvToday?.weeklyAvg)];
  const weigh = latest("weight")?.latestWeight as Json | undefined;
  const bmi = num(weigh?.bmi);
  const rating: RatingContext = {
    sex: profile?.gender === "male" || profile?.gender === "female" ? profile.gender : null,
    age: profile?.birthYear ? Number(date.slice(0, 4)) - profile.birthYear : chronologicalAge,
    hrvBaseline: lowUpper !== null && balancedLow !== null && balancedUpper !== null && weeklyAvg !== null ? { lowUpper, balancedLow, balancedUpper, weeklyAvg } : null,
    bodyFat: num(weigh?.bodyFat),
    bmi: bmi !== null ? Math.round(bmi * 10) / 10 : null,
    chronologicalAge,
    sleepRanges: sleepRanges(latest("sleep")),
  };
  const stepsByDate = new Map(points("steps", (j) => num(j.totalSteps)).map((p) => [p.date, p.value]));
  const stepsWeek = Array.from({ length: 7 }, (_, i) => addDays(date, i - 7)).map((d) => ({ date: d, steps: stepsByDate.get(d) ?? null }));

  const recent = series.slice(-42);
  const [lastRow] = await db
    .select({
      id: garminActivities.garminActivityId,
      typeKey: garminActivities.activityType,
      start: garminActivities.startTimeLocal,
      data: garminActivities.data,
      sport: garminActivityMetrics.sport,
      load: garminActivityMetrics.load,
      loadMethod: garminActivityMetrics.loadMethod,
      metrics: garminActivityMetrics.metrics,
    })
    .from(garminActivities)
    .innerJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivities.userId), eq(garminActivityMetrics.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(eq(garminActivities.userId, userId))
    .orderBy(desc(garminActivities.startTimeLocal))
    .limit(1);
  let last: OverviewData["last"] = null;
  if (lastRow) {
    const j = (lastRow.data ?? {}) as Json;
    const m = lastRow.metrics as ActivityMetrics;
    last = {
      id: lastRow.id,
      name: typeof j.activityName === "string" ? j.activityName : lastRow.typeKey.replaceAll("_", " "),
      typeKey: lastRow.typeKey,
      sport: lastRow.sport as Sport,
      start: lastRow.start.getTime(),
      durationS: num(j.duration),
      distanceM: num(j.distance),
      avgHr: num(j.averageHR),
      load: lastRow.load,
      loadMethod: lastRow.loadMethod,
      hrPreview: m.hrPreview ?? [],
      pr: j.isPR === true,
      decoupling: m.decoupling ?? null,
    };
  }

  return {
    date,
    cycleId: cycle?.id ?? null,
    race: raceStatus(cycle, now),
    readiness: today?.readiness ?? null,
    strip: Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) => ({ date: d, readiness: series.find((x) => x.date === d)?.readiness?.score ?? null })),
    insights: today ? insightsFor(series) : [],
    body,
    vo2Sport,
    hrvStatus: hrvLabel ? { label: hrvLabel, weeklyAvg: num(hrvToday?.weeklyAvg), nightHigh: num(hrvToday?.lastNight5MinHigh) } : null,
    intensity: intensityWeek(summaries, date, mondayOf(date)),
    rating,
    night: await withSpo2Avg(userId, date, nightStages(dayRows.findLast((r) => r.kind === "sleep") ?? null)),
    stepsWeek,
    stepGoal: points("user_summary", (j) => num(j.dailyStepGoal)).at(-1)?.value ?? null,
    floorGoal: points("user_summary", (j) => num(j.userFloorsAscendedGoal)).at(-1)?.value ?? null,
    bmr: points("user_summary", (j) => num(j.bmrKilocalories)).filter((p) => p.date < date).at(-1)?.value ?? null,
    pmc: {
      dates: recent.map((m) => m.date),
      ctl: recent.map((m) => r1(m.pmc.total.ctl)),
      atl: recent.map((m) => r1(m.pmc.total.atl)),
      tsb: recent.map((m) => r1(m.pmc.total.tsb)),
      calibrating: recent.at(-1)?.calibrating ?? true,
    },
    last,
  };
}

type PointsOf = (kind: string, pick: (j: Json) => number | null) => { date: string; value: number }[];
const sleepScore = (j: Json, key: string) => ((j.sleepScores as Json | undefined)?.[key] ?? undefined) as Json | undefined;

/** Garmin's sleep summary per night: stage shares, stress, wake-ups, SpO2 and heart rate while asleep. */
function sleepQualitySignals(points: PointsOf, date: string) {
  const opts = { days: 90, fresh: 14 };
  return {
    deepSleep: bodySignal(points("sleep", (j) => num(sleepScore(j, "deepPercentage")?.value)), date, opts),
    remSleep: bodySignal(points("sleep", (j) => num(sleepScore(j, "remPercentage")?.value)), date, opts),
    sleepStress: bodySignal(points("sleep", (j) => num(j.avgSleepStress)), date, opts),
    awakeCount: bodySignal(points("sleep", (j) => num(j.awakeCount)), date, opts),
    spo2: bodySignal(points("sleep", (j) => num(j.averageSpO2Value)), date, opts),
    sleepHr: bodySignal(points("sleep", (j) => num(j.avgHeartRate)), date, opts),
  };
}

/**
 * Daily summary signals from complete days only: the newest Garmin day is
 * usually today, still filling up. Steps are a 7-day average, from the steps
 * range endpoint: Garmin's per-day summary sometimes comes back empty for a
 * day the steps endpoint has.
 */
function dayToDaySignals(points: PointsOf, date: string) {
  const done = (ps: { date: string; value: number }[]) => ps.filter((p) => p.date < date);
  const opts = { days: 90, fresh: 14 };
  return {
    steps: bodySignal(rollingMean(done(points("steps", (j) => num(j.totalSteps)))), date, opts),
    stress: bodySignal(done(points("user_summary", (j) => {
      const v = num(j.averageStressLevel);
      return v !== null && v >= 0 ? v : null;
    })), date, opts),
    sedentary: bodySignal(done(points("user_summary", (j) => (num(j.sedentarySeconds) !== null ? Math.round((num(j.sedentarySeconds)! / 3600) * 10) / 10 : null))), date, opts),
    muscleMass: bodySignal(points("weight", (j) => {
      const g = num((j.latestWeight as Json | undefined)?.muscleMass);
      return g !== null ? Math.round(g / 100) / 10 : null;
    }), date, { days: 90 }),
    floors: bodySignal(done(points("user_summary", (j) => (num(j.floorsAscended) !== null ? Math.round(num(j.floorsAscended)!) : null))), date, opts),
    distance: bodySignal(done(points("user_summary", (j) => (num(j.totalDistanceMeters) !== null ? Math.round(num(j.totalDistanceMeters)! / 100) / 10 : null))), date, opts),
    activeTime: bodySignal(
      done(points("user_summary", (j) => {
        const a = num(j.activeSeconds);
        const h = num(j.highlyActiveSeconds);
        return a === null && h === null ? null : Math.round(((a ?? 0) + (h ?? 0)) / 60);
      })),
      date,
      opts,
    ),
    calories: bodySignal(done(points("user_summary", (j) => num(j.totalKilocalories))), date, opts),
    altitude: bodySignal(done(points("user_summary", (j) => (num(j.averageMonitoringEnvironmentAltitude) !== null ? Math.round(num(j.averageMonitoringEnvironmentAltitude)!) : null))), date, opts),
    boneMass: bodySignal(points("weight", (j) => {
      const g = num((j.latestWeight as Json | undefined)?.boneMass);
      return g !== null ? Math.round(g / 100) / 10 : null;
    }), date, { days: 90 }),
    bodyWater: bodySignal(points("weight", (j) => num((j.latestWeight as Json | undefined)?.bodyWater)), date, { days: 90 }),
    bodyFat: bodySignal(points("weight", (j) => num((j.latestWeight as Json | undefined)?.bodyFat)), date, { days: 90 }),
  };
}

export type NightStages = {
  date: string;
  deepS: number;
  lightS: number;
  remS: number;
  awakeS: number;
  optimal: { deep: [number, number] | null; light: [number, number] | null; rem: [number, number] | null };
  /** Garmin's codes for the night: its feedback and its insight on what shaped it. */
  feedback: string | null;
  insight: string | null;
  /** Tonight's sleep need in minutes, and Garmin's recommended bedtime (minutes after midnight). */
  nextNeedMin: number | null;
  bedtime: [number, number] | null;
  /** Garmin's breathing variations rating (NONE, LOW, ...). */
  breathing: string | null;
  lowestSpO2: number | null;
  /** Garmin's 7-day average SpO2 (spo2 endpoint). */
  spo2Avg7: number | null;
  napS: number;
  /** Sleep timing against Garmin's best window for you (ALIGNED, BEHIND, ...). */
  alignment: string | null;
};

function nightStages(row: { date: string; data: unknown } | null): NightStages | null {
  const j = (row?.data ?? null) as Json | null;
  if (!row || !j) return null;
  const [deepS, lightS, remS, awakeS] = [num(j.deepSleepSeconds), num(j.lightSleepSeconds), num(j.remSleepSeconds), num(j.awakeSleepSeconds)];
  if (deepS === null || lightS === null || remS === null) return null;
  const range = (key: string): [number, number] | null => {
    const p = sleepScore(j, key);
    const a = num(p?.optimalStart);
    const b = num(p?.optimalEnd);
    return a !== null && b !== null ? [a, b] : null;
  };
  const next = j.nextSleepNeed as Json | undefined;
  const [bedStart, bedEnd] = [num(next?.recommendedBedtimeStartMins), num(next?.recommendedBedtimeEndMins)];
  const naps = Array.isArray(j.dailyNapDTOS) ? (j.dailyNapDTOS as Json[]) : [];
  const alignment = (j.sleepAlignment as Json | undefined)?.status;
  return {
    date: row.date,
    deepS,
    lightS,
    remS,
    awakeS: awakeS ?? 0,
    optimal: { deep: range("deepPercentage"), light: range("lightPercentage"), rem: range("remPercentage") },
    feedback: typeof j.sleepScoreFeedback === "string" ? j.sleepScoreFeedback : null,
    insight: typeof j.sleepScoreInsight === "string" ? j.sleepScoreInsight : null,
    nextNeedMin: num(next?.actual),
    bedtime: bedStart !== null && bedEnd !== null ? [bedStart, bedEnd] : null,
    breathing: typeof j.breathingDisruptionSeverity === "string" ? j.breathingDisruptionSeverity : null,
    lowestSpO2: num(j.lowestSpO2Value),
    spo2Avg7: null,
    napS: naps.reduce((t, n) => t + (num(n.napTimeSec) ?? 0), 0),
    alignment: typeof alignment === "string" ? alignment : null,
  };
}

/** Adds Garmin's 7-day SpO2 average from the newest spo2 row, read on its own: those rows carry hourly arrays. */
async function withSpo2Avg(userId: string, date: string, night: NightStages | null): Promise<NightStages | null> {
  if (!night) return null;
  const [row] = await db
    .select({ avg: sql<number | null>`(${garminDays.data}->>'lastSevenDaysAvgSpO2')::float8` })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "spo2"), lte(garminDays.calendarDate, date), sql`${garminDays.data}->>'lastSevenDaysAvgSpO2' is not null`))
    .orderBy(desc(garminDays.calendarDate))
    .limit(1);
  return { ...night, spo2Avg7: row?.avg ?? null };
}

/** Garmin's optimal ranges from the newest night's sleep score parts. */
function sleepRanges(j: Json | undefined): RatingContext["sleepRanges"] {
  if (!j) return null;
  const range = (key: string): [number, number] | null => {
    const p = sleepScore(j, key);
    const a = num(p?.optimalStart);
    const b = num(p?.optimalEnd);
    return a !== null && b !== null ? [a, b] : null;
  };
  return { deep: range("deepPercentage"), rem: range("remPercentage"), awakeMax: range("awakeCount")?.[1] ?? null };
}

// ── Volume, race demands and the plan ───────────────────────────────────────

export type VolumeData = {
  today: string;
  /** 52 Monday-start weeks to this week. */
  weeks: VolumeWeek[];
  bricks: Brick[];
  distance: RaceDistance;
  /** True when no race distance is set and the checklist assumes a full Ironman. */
  distanceAssumed: boolean;
  checklist: DemandRow[];
  /** Planned hours per sport this week from the active cycle, or null without one. */
  planned: Record<Endurance, number> | null;
};

/** Planned endurance sets for one week of a day-of-week cycle (rotation cycles have no fixed week). */
async function plannedSets(cycleId: number): Promise<PlannedSet[] | null> {
  const [c] = await db.select({ scheduleType: trainingCycles.scheduleType }).from(trainingCycles).where(and(eq(trainingCycles.id, cycleId), liveCycles));
  if (c?.scheduleType !== "day_of_week") return null;
  const rows = await db
    .select({ discipline: exercises.discipline, durationS: programSets.durationSeconds, distanceM: programSets.distanceMeters })
    .from(trainingCycleSlots)
    .innerJoin(programs, and(eq(programs.id, trainingCycleSlots.programId), livePrograms))
    .innerJoin(programExercises, and(eq(programExercises.programId, trainingCycleSlots.programId), liveProgramExercises))
    .innerJoin(programSets, and(eq(programSets.programExerciseId, programExercises.id), liveProgramSets))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), sql`${trainingCycleSlots.dayOfWeek} is not null`, sql`${exercises.discipline} is not null`));
  return rows.map((r) => ({ discipline: r.discipline as Endurance, durationS: r.durationS, distanceM: r.distanceM }));
}

export async function getVolumeData(userId: string, todayArg?: string): Promise<VolumeData> {
  const today = todayArg ?? (await garminToday(userId));
  const from = addDays(mondayOf(today), -51 * 7);
  const rows = await db
    .select({
      id: garminActivities.garminActivityId,
      typeKey: garminActivities.activityType,
      start: garminActivities.startTimeLocal,
      data: garminActivities.data,
      sport: garminActivityMetrics.sport,
      startMs: sql<number | null>`(${garminActivityMetrics.metrics}->>'startMs')::float8`,
      endMs: sql<number | null>`(${garminActivityMetrics.metrics}->>'endMs')::float8`,
    })
    .from(garminActivities)
    .leftJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivities.userId), eq(garminActivityMetrics.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(and(eq(garminActivities.userId, userId), gte(garminActivities.startTimeLocal, new Date(`${from}T00:00:00Z`))));
  const activities: VolumeActivity[] = rows.map((r) => {
    const j = (r.data ?? {}) as Json;
    return {
      id: r.id,
      sport: (r.sport ?? sportOf(r.typeKey)) as Sport,
      day: isoDate(r.start),
      startMs: r.startMs,
      endMs: r.endMs,
      durationS: num(j.duration) ?? 0,
      distanceM: num(j.distance),
      indoor: isIndoor(r.typeKey),
    };
  });

  const rampRows = await db
    .select({ ramp: sql<number | null>`(${garminDailyMetrics.metrics}->>'ramp')::float8` })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, addDays(today, -(RAMP_WINDOW_DAYS - 1)))));

  const cycle = await getActiveCycle(userId);
  const distance: RaceDistance = cycle?.raceDistance ?? "full";
  const sets = cycle ? await plannedSets(cycle.id) : null;
  const recent = activities.filter((a) => a.day >= addDays(today, -55));
  return {
    today,
    weeks: weeklyVolume(activities, from, today),
    bricks: findBricks(activities),
    distance,
    distanceAssumed: !cycle?.raceDistance,
    checklist: demandsChecklist({ activities, distance, today, ramps: rampRows.map((r) => r.ramp) }),
    planned: sets ? plannedHours(sets, meanSpeeds(recent)) : null,
  };
}

/** The race and the fitness projection to it, from the Training tab's series. Null without an active cycle. */
export async function getRaceProjection(userId: string, series: LoadSeries, todayArg?: string): Promise<{ race: RaceStatus; projection: Projection | null } | null> {
  const today = todayArg ?? (await garminToday(userId));
  const cycle = await getActiveCycle(userId);
  const race = raceStatus(cycle, today);
  if (!cycle?.startDate || !race) return null;
  const n = series.dates.length;
  if (!n) return { race, projection: null };
  const last = n - 1;
  const t = series.tracks.total;
  const daily = series.dates.map((_, i) => SPORTS.reduce((s, sp) => s + (series.loads[sp][i] ?? 0), 0));
  const projection = projectPmc({
    today: series.dates[last],
    raceDay: race.raceDay,
    ctl: t.ctl[last],
    atl: t.atl[last],
    last7: daily.slice(-7),
    cycle: { startDate: cycle.startDate, durationWeeks: cycle.durationWeeks, goal: cycle.goal, athleteLevel: cycle.athleteLevel },
    peakCtl: Math.max(0, ...t.ctl.slice(-90)),
  });
  return { race, projection };
}

// ── Trends ──────────────────────────────────────────────────────────────────

export type TrendsData = {
  today: string;
  acts: TrendActivity[];
  /**
   * Garmin's VO2 max from the watch files, one point per day and sport. Garmin
   * keeps a running and a cycling VO2 max; a ride file carries the cycling one
   * once the watch has one from power.
   */
  garminVo2: { day: string; value: number; sport: "run" | "bike" }[];
  weight: { day: string; kg: number }[];
  /** Garmin's newest fitness age and what would lower it, and the age week by week. */
  fitnessAge: (FitnessAge & { date: string; history: { day: string; age: number }[] }) | null;
};

export async function getTrendsData(userId: string, todayArg?: string): Promise<TrendsData> {
  const today = todayArg ?? (await garminToday(userId));
  const rows = await db
    .select({
      id: garminActivityMetrics.garminActivityId,
      day: garminActivityMetrics.day,
      sport: garminActivityMetrics.sport,
      efforts: sql<Efforts | null>`${garminActivityMetrics.metrics}->'efforts'`,
      decoupling: sql<Decoupling | null>`${garminActivityMetrics.metrics}->'decoupling'`,
      indoor: sql<boolean | null>`(${garminActivityMetrics.metrics}->>'indoor')::boolean`,
      durationS: sql<number | null>`(${garminActivityMetrics.metrics}->>'durationS')::float8`,
      lthr: sql<number | null>`(${garminActivityMetrics.metrics}->'thresholds'->>'lthr')::float8`,
      maxHr: sql<number | null>`(${garminActivityMetrics.metrics}->'thresholds'->>'maxHr')::float8`,
    })
    .from(garminActivityMetrics)
    .where(and(eq(garminActivityMetrics.userId, userId), sql`${garminActivityMetrics.metrics} ? 'efforts'`))
    .orderBy(asc(garminActivityMetrics.day));
  const acts: TrendActivity[] = rows.map((r) => ({
    id: r.id,
    day: r.day,
    sport: r.sport as Sport,
    indoor: Boolean(r.indoor),
    durationS: r.durationS,
    efforts: r.efforts!,
    decoupling: r.decoupling,
    watchLthr: r.lthr,
    watchMaxHr: r.maxHr,
  }));

  const vo2Rows = await db
    .select({ day: garminActivityMetrics.day, sport: garminActivityMetrics.sport, vo2: sql<number>`max((${garminActivityStreams.session}->>'garminVo2Max')::float8)` })
    .from(garminActivityStreams)
    .innerJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivityStreams.userId), eq(garminActivityMetrics.garminActivityId, garminActivityStreams.garminActivityId)),
    )
    .where(and(eq(garminActivityStreams.userId, userId), inArray(garminActivityMetrics.sport, ["run", "bike"]), sql`${garminActivityStreams.session}->>'garminVo2Max' is not null`))
    .groupBy(garminActivityMetrics.day, garminActivityMetrics.sport)
    .orderBy(asc(garminActivityMetrics.day));

  const weightRows = await db
    .select({ day: garminDays.calendarDate, kg: sql<number | null>`(${garminDays.data}->'latestWeight'->>'weight')::float8 / 1000` })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "weight")))
    .orderBy(asc(garminDays.calendarDate));

  const ageRows = await db
    .select({ day: garminDays.calendarDate, data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "fitness_age"), lte(garminDays.calendarDate, today)))
    .orderBy(asc(garminDays.calendarDate));
  const ages = ageRows.flatMap((r) => {
    const f = parseFitnessAge(r.data as Json);
    return f ? [{ day: r.day, f }] : [];
  });
  const newestAge = ages.at(-1);

  return {
    today,
    acts,
    fitnessAge: newestAge
      ? { ...newestAge.f, date: newestAge.day, history: ages.filter((a, i) => a.day === mondayOf(a.day) || i === ages.length - 1).map((a) => ({ day: a.day, age: a.f.age })) }
      : null,
    garminVo2: vo2Rows.map((r) => ({ day: r.day, value: r.vo2, sport: r.sport as "run" | "bike" })),
    weight: weightRows.flatMap((r) => (r.kg ? [{ day: r.day, kg: Math.round(r.kg * 10) / 10 }] : [])),
  };
}

// ── Race page ───────────────────────────────────────────────────────────────

export type RaceData = {
  today: string;
  cycleId: number;
  race: RaceStatus;
  taperStart: string | null;
  series: LoadSeries;
  projection: Projection | null;
  volume: VolumeData;
  pacing: PacingGuide;
  /** Which LTHR the pacing guide used: the app's estimate or the watch's. */
  lthrSource: "estimate" | "watch" | null;
  bricks: BrickComparison[];
  fuel: FuelSession[];
  heat: EfPoint[];
};

/** Mean of a stream array stored in jsonb, in SQL, so the streams never leave the database. */
const streamMean = (key: string) =>
  sql<number | null>`(select avg(v::float8) from jsonb_array_elements_text(${garminActivityStreams.streams}->${key}) v where v <> 'null')`;

export async function getRaceData(userId: string, todayArg?: string): Promise<RaceData | null> {
  const today = todayArg ?? (await garminToday(userId));
  const cycle = await getActiveCycle(userId);
  const race = raceStatus(cycle, today);
  if (!cycle?.startDate || !race) return null;
  const [{ series }, volume, trends] = await Promise.all([getLoadSeries(userId), getVolumeData(userId, today), getTrendsData(userId, today)]);
  const rp = await getRaceProjection(userId, series, today);

  const th = thresholdHistory(trends.acts, addDays(today, -6), today).at(-1);
  const watchLthr = [...trends.acts].reverse().find((a) => a.watchLthr)?.watchLthr ?? null;
  const lthrRun = th?.lthrRun ?? null;
  const pacing = pacingGuide({ distance: volume.distance, ftp: th?.ftp ?? null, cs: th?.cs ?? null, lthrBike: th?.lthrBike ?? watchLthr, lthrRun: lthrRun ?? watchLthr });

  // Runs with mean speed and HR, for bricks against fresh runs.
  const runRows = await db
    .select({ id: garminActivities.garminActivityId, start: garminActivities.startTimeLocal, typeKey: garminActivities.activityType, data: garminActivities.data })
    .from(garminActivities)
    .where(and(eq(garminActivities.userId, userId), gte(garminActivities.startTimeLocal, new Date(`${addDays(today, -400)}T00:00:00Z`))));
  const runs: RunSummary[] = runRows.flatMap((r) => {
    const j = (r.data ?? {}) as Json;
    const speed = num(j.averageSpeed);
    const hr = num(j.averageHR);
    const durationS = num(j.duration);
    return sportOf(r.typeKey) === "run" && !isIndoor(r.typeKey) && speed && hr && durationS ? [{ id: r.id, day: isoDate(r.start), speed, hr, durationS }] : [];
  });
  const brickIds = new Set(volume.bricks.map((b) => b.runId));
  const bricks = compareBricks(
    runs.filter((r) => brickIds.has(r.id)),
    runs.filter((r) => !brickIds.has(r.id) && r.durationS >= 1200),
  );

  // Long sessions for the fuel and fluid log: an hour or more, last year.
  const fuelRows = await db
    .select({
      id: garminActivities.garminActivityId,
      start: garminActivities.startTimeLocal,
      typeKey: garminActivities.activityType,
      data: garminActivities.data,
      // The FIT stream when it has temperature, else Garmin's summary average.
      temperature: sql<number | null>`coalesce(${streamMean("temperature")}, (${garminActivities.detail}->'summaryDTO'->>'averageTemperature')::float8)`,
      carbsG: garminFuelLogs.carbsG,
      fluidMl: garminFuelLogs.fluidMl,
    })
    .from(garminActivities)
    .leftJoin(
      garminActivityStreams,
      and(eq(garminActivityStreams.userId, garminActivities.userId), eq(garminActivityStreams.garminActivityId, garminActivities.garminActivityId)),
    )
    .leftJoin(garminFuelLogs, and(eq(garminFuelLogs.userId, garminActivities.userId), eq(garminFuelLogs.garminActivityId, garminActivities.garminActivityId)))
    .where(
      and(
        eq(garminActivities.userId, userId),
        gte(garminActivities.startTimeLocal, new Date(`${addDays(today, -364)}T00:00:00Z`)),
        sql`(${garminActivities.data}->>'duration')::float8 >= 3600`,
      ),
    )
    .orderBy(desc(garminActivities.startTimeLocal));
  const fuel: FuelSession[] = fuelRows
    .map((r) => {
      const j = (r.data ?? {}) as Json;
      return {
        id: r.id,
        day: isoDate(r.start),
        name: typeof j.activityName === "string" ? j.activityName : r.typeKey.replaceAll("_", " "),
        sport: sportOf(r.typeKey),
        durationS: num(j.duration) ?? 0,
        sweatMl: num(j.waterEstimated),
        temperature: r.temperature !== null ? Math.round(r.temperature * 10) / 10 : null,
        carbsG: r.carbsG,
        fluidMl: r.fluidMl,
      };
    })
    .filter((f) => f.sport === "bike" || f.sport === "run" || f.sport === "swim");

  return {
    today,
    cycleId: cycle.id,
    race,
    taperStart: taperStart(cycle.startDate, cycle.durationWeeks),
    series,
    projection: rp?.projection ?? null,
    volume,
    pacing,
    lthrSource: lthrRun ? "estimate" : watchLthr ? "watch" : null,
    bricks,
    fuel,
    heat: efPoints(trends.acts).filter((p) => p.temperature !== null),
  };
}

// ── Session insights and correlations ───────────────────────────────────────

/** The session, threshold and race insights for today (session-insights.ts). */
export async function getSessionInsights(userId: string, volume: VolumeData, todayArg?: string): Promise<Insight[]> {
  const today = todayArg ?? (await garminToday(userId));
  const [trends, { series }] = await Promise.all([getTrendsData(userId, today), getLoadSeries(userId)]);
  const rp = await getRaceProjection(userId, series, today);
  const th = thresholdHistory(trends.acts, addDays(today, -6), today).at(-1);
  const yesterday = series.dates.indexOf(addDays(today, -1));
  return sessionInsights({
    today,
    acts: trends.acts,
    lthrEstimate: th?.lthrRun ?? null,
    watchLthr: [...trends.acts].reverse().find((a) => a.sport === "run" && a.watchLthr)?.watchLthr ?? null,
    strengthYesterday: yesterday >= 0 ? series.loads.strength[yesterday] : null,
    checklist: volume.checklist,
    daysToRace: rp?.race.raceSet ? rp.race.daysToRace : null,
    projection: rp?.projection ?? null,
  });
}

/** Inputs for "what moves my HRV", one row per day of the daily series. */
export async function getCorrelationDays(userId: string): Promise<CorrelationDay[]> {
  const rows = await db
    .select({
      date: garminDailyMetrics.day,
      hrvMs: sql<number | null>`(${garminDailyMetrics.metrics}->'hrv'->>'ms')::float8`,
      hrvMean7: sql<number | null>`(${garminDailyMetrics.metrics}->'hrv'->>'mean7')::float8`,
      sleepS: sql<number | null>`(${garminDailyMetrics.metrics}->>'sleepSeconds')::float8`,
      debtS: sql<number | null>`(${garminDailyMetrics.metrics}->>'sleepDebtS')::float8`,
      regularity: sql<number | null>`(${garminDailyMetrics.metrics}->>'regularity')::float8`,
      load: sql<number | null>`(${garminDailyMetrics.metrics}->'pmc'->'total'->>'load')::float8`,
      strength: sql<number | null>`(${garminDailyMetrics.metrics}->'pmc'->'strength'->>'load')::float8`,
      highS: sql<number | null>`(${garminDailyMetrics.metrics}->'bands'->>'high')::float8`,
    })
    .from(garminDailyMetrics)
    .where(eq(garminDailyMetrics.userId, userId))
    .orderBy(asc(garminDailyMetrics.day));
  const runs = await db
    .select({ day: garminActivityMetrics.day, decoupling: sql<Decoupling | null>`${garminActivityMetrics.metrics}->'decoupling'` })
    .from(garminActivityMetrics)
    .where(and(eq(garminActivityMetrics.userId, userId), eq(garminActivityMetrics.sport, "run")));
  const runByDay = new Map<string, Extract<Decoupling, { valid: true }>>();
  for (const r of runs) if (r.decoupling?.valid) runByDay.set(r.day, r.decoupling);
  return rows.map((r) => {
    const run = runByDay.get(r.date);
    return {
      date: r.date,
      hrvMs: r.hrvMs,
      hrvMean7: r.hrvMean7,
      sleepH: r.sleepS !== null ? r.sleepS / 3600 : null,
      sleepDebtH: r.debtS !== null ? r.debtS / 3600 : null,
      regularity: r.regularity,
      load: r.load,
      highMin: r.highS !== null ? r.highS / 60 : null,
      strengthLoad: r.strength,
      runEf: run?.ef ?? null,
      decoupling: run?.pct ?? null,
    };
  });
}
