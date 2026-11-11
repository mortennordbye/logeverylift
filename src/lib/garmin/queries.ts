import { db } from "@/db";
import { exercises, garminActivities, garminActivityMetrics, garminActivityStreams, garminConnections, garminDailyMetrics, garminDays, programExercises, programSets, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { ActivityMetrics } from "./analytics/activity";
import { sessionZoneMessage } from "./analytics/thresholds";
import { lttbIndices, takeIndices } from "./charts/downsample";
import type { DailyMetrics } from "./analytics/daily";
import { insightsFor, type Insight } from "./analytics/insights";
import { addDays, isoDate, mondayOf } from "./dates";
import { TRACKS, type PmcPoint, type Track } from "./analytics/pmc";
import { SPORTS, isIndoor, sportOf, type Sport } from "./analytics/sport";
import type { LoadSeries } from "./charts/load";
import { bodySignal, raceStatus, type BodySignal, type CycleForRace, type RaceDistance, type RaceStatus } from "./analytics/overview";
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
        inArray(garminDays.kind, ["heart_rate", "hrv_detail", "spo2", "sleep", "user_summary"]),
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
  days: Pick<DailyMetrics, "date" | "hrv" | "restingHr" | "sleepDebtS" | "regularity" | "timing">[];
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
      return { date: m.date, hrv: m.hrv, restingHr: m.restingHr, sleepDebtS: m.sleepDebtS, regularity: m.regularity, timing: m.timing };
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
};

const MAX_POINTS = 3000;

export async function getActivityDetail(userId: string, id: number): Promise<ActivityDetail | null> {
  const [a] = await db
    .select({ id: garminActivities.garminActivityId, typeKey: garminActivities.activityType, start: garminActivities.startTimeLocal, data: garminActivities.data })
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
  };
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
    .where(and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active")))
    .orderBy(desc(trainingCycles.createdAt))
    .limit(1);
  return c ?? null;
}

export type BodyKey = "sleep" | "hrv" | "restingHr" | "vo2max" | "bodyBattery" | "weight";

export type OverviewData = {
  date: string;
  cycleId: number | null;
  race: RaceStatus | null;
  readiness: DailyMetrics["readiness"];
  strip: { date: string; readiness: number | null }[];
  insights: Insight[];
  body: Record<BodyKey, BodySignal>;
  /** Fitness, fatigue and form for the last 42 days, all sports. */
  pmc: { dates: string[]; ctl: number[]; atl: number[]; tsb: number[]; calibrating: boolean };
  last: (ActivityListRow & { decoupling: ActivityMetrics["decoupling"] }) | null;
};

const daysAgo = (date: string, n: number) => addDays(date, -n);

export async function getOverviewData(userId: string, now = isoDate(new Date())): Promise<OverviewData> {
  // Body data is shown for the newest Garmin day; the race counts from today.
  const date = await latestGarminDate(userId);
  const metricRows = await db
    .select({ metrics: garminDailyMetrics.metrics })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, userId), gte(garminDailyMetrics.day, daysAgo(date, 89)), lte(garminDailyMetrics.day, date)))
    .orderBy(asc(garminDailyMetrics.day));
  const series = metricRows.map((r) => r.metrics as DailyMetrics);
  const today = series.at(-1)?.date === date ? series.at(-1)! : null;

  const dayRows = await db
    .select({ date: garminDays.calendarDate, kind: garminDays.kind, data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), gte(garminDays.calendarDate, daysAgo(date, 120)), lte(garminDays.calendarDate, date), inArray(garminDays.kind, ["user_summary", "weight"])))
    .orderBy(asc(garminDays.calendarDate));
  const points = (kind: string, pick: (j: Json) => number | null) =>
    dayRows.flatMap((r) => {
      if (r.kind !== kind) return [];
      const v = pick((r.data ?? {}) as Json);
      return v === null ? [] : [{ date: r.date, value: v }];
    });

  // Garmin's VO2 max from the watch files (fit.ts, vo2MaxFromMessage), one point per activity day.
  const vo2Rows = await db
    .select({ day: garminActivityMetrics.day, vo2: sql<number | null>`(${garminActivityStreams.session}->>'garminVo2Max')::float` })
    .from(garminActivityStreams)
    .innerJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivityStreams.userId), eq(garminActivityMetrics.garminActivityId, garminActivityStreams.garminActivityId)),
    )
    .where(and(eq(garminActivityStreams.userId, userId), gte(garminActivityMetrics.day, daysAgo(date, 180)), sql`${garminActivityStreams.session}->>'garminVo2Max' is not null`))
    .orderBy(asc(garminActivityMetrics.day));
  const vo2ByDay = new Map(vo2Rows.flatMap((r) => (r.vo2 !== null ? [[r.day, r.vo2] as const] : [])));

  const from = (pick: (m: DailyMetrics) => number | null) =>
    series.flatMap((m) => {
      const v = pick(m);
      return v === null || v === undefined ? [] : [{ date: m.date, value: v }];
    });
  const hrvBand: [number, number] | null = today?.hrv.bandLow != null && today.hrv.bandHigh != null ? [today.hrv.bandLow, today.hrv.bandHigh] : null;
  const body: Record<BodyKey, BodySignal> = {
    sleep: bodySignal(from((m) => (m.sleepSeconds !== null ? m.sleepSeconds / 3600 : null)), date),
    hrv: bodySignal(from((m) => m.hrv.ms), date, { band: hrvBand }),
    restingHr: bodySignal(from((m) => m.restingHr.bpm), date),
    vo2max: bodySignal([...vo2ByDay].map(([d, v]) => ({ date: d, value: v })), date, { days: 90 }),
    bodyBattery: bodySignal(points("user_summary", (j) => num(j.bodyBatteryAtWakeTime) ?? num(j.bodyBatteryHighestValue)), date),
    weight: bodySignal(
      points("weight", (j) => {
        const w = num((j.latestWeight as Json | undefined)?.weight);
        return w !== null ? Math.round(w / 100) / 10 : null;
      }),
      date,
      { days: 90 },
    ),
  };

  const recent = series.slice(-42);
  const cycle = await getActiveCycle(userId);
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
  const [c] = await db.select({ scheduleType: trainingCycles.scheduleType }).from(trainingCycles).where(eq(trainingCycles.id, cycleId));
  if (c?.scheduleType !== "day_of_week") return null;
  const rows = await db
    .select({ discipline: exercises.discipline, durationS: programSets.durationSeconds, distanceM: programSets.distanceMeters })
    .from(trainingCycleSlots)
    .innerJoin(programExercises, eq(programExercises.programId, trainingCycleSlots.programId))
    .innerJoin(programSets, eq(programSets.programExerciseId, programExercises.id))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), sql`${trainingCycleSlots.dayOfWeek} is not null`, sql`${exercises.discipline} is not null`));
  return rows.map((r) => ({ discipline: r.discipline as Endurance, durationS: r.durationS, distanceM: r.distanceM }));
}

export async function getVolumeData(userId: string, today = isoDate(new Date())): Promise<VolumeData> {
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
