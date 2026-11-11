import { db } from "@/db";
import { garminActivities, garminActivityMetrics, garminConnections, garminDailyMetrics, garminDays } from "@/db/schema";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { DailyMetrics } from "./analytics/daily";
import { insightsFor, type Insight } from "./analytics/insights";
import { addDays } from "./dates";
import { TRACKS, type PmcPoint, type Track } from "./analytics/pmc";
import { SPORTS, type Sport } from "./analytics/sport";
import type { LoadSeries } from "./charts/load";

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
