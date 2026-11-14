/**
 * Pure shaping for the phase 2 home widgets (docs/home-widgets-audit.md, 4).
 * Dates are YYYY-MM-DD strings in the user's zone; nothing here reads the
 * clock or formats with Intl, so server and client agree.
 */

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Whole days from `today` to `date`: 0 on the day, negative once it has passed. */
export function daysUntil(today: string, date: string): number {
  return Math.round((utc(date) - utc(today)) / DAY_MS);
}

/** The Monday of the week holding `date`, as epoch ms at UTC midnight. */
function mondayOf(date: string): number {
  const t = utc(date);
  const dow = new Date(t).getUTCDay();
  return t - ((dow + 6) % 7) * DAY_MS;
}

/**
 * Sessions per Monday-to-Sunday week for the last `n` weeks, oldest first;
 * the last entry is the week holding `today`. Days outside the range are left out.
 */
export function weekCounts(days: { date: string; sessionCount: number }[], today: string, n = 8): number[] {
  const out = Array.from({ length: n }, () => 0);
  const current = mondayOf(today);
  for (const d of days) {
    const back = Math.round((current - mondayOf(d.date)) / (7 * DAY_MS));
    if (back >= 0 && back < n) out[n - 1 - back] += d.sessionCount;
  }
  return out;
}

/**
 * Weeks in a row with a session, Monday to Sunday in the user's calendar,
 * counted back from the week holding `today`. A week not trained yet does
 * not break the streak: it starts from last week then.
 */
export function streakWeeks(days: { date: string; sessionCount: number }[], today: string): number {
  const WEEK = 7 * DAY_MS;
  const trained = new Set(days.filter((d) => d.sessionCount > 0 && d.date <= today).map((d) => mondayOf(d.date)));
  let week = mondayOf(today);
  if (!trained.has(week)) week -= WEEK;
  let n = 0;
  while (trained.has(week)) {
    n++;
    week -= WEEK;
  }
  return n;
}

export type WeightSummary = {
  latestKg: number;
  /** Latest minus the first entry in the window; null with fewer than two entries in it. */
  changeKg: number | null;
  lowKg: number;
  highKg: number;
  /** The window's entries, oldest first, for the sparkline. */
  series: number[];
  /** The latest entry's date when it is older than the window, so it is not shown as current; else null. */
  oldDate: string | null;
};

/**
 * The body weight widget's numbers from entries (any order) with their local
 * date: the latest entry, and the change, low, high and series over the last
 * `windowDays` days up to `today`. Null without entries.
 */
export function weightSummary(entries: { kg: number; date: string; at: number }[], today: string, windowDays = 30): WeightSummary | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const latest = sorted[sorted.length - 1];
  const from = utc(today) - (windowDays - 1) * DAY_MS;
  const inWindow = sorted.filter((e) => utc(e.date) >= from && utc(e.date) <= utc(today));
  const series = inWindow.map((e) => e.kg);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    latestKg: r1(latest.kg),
    changeKg: series.length >= 2 ? r1(series[series.length - 1] - series[0]) : null,
    lowKg: r1(series.length ? Math.min(...series) : latest.kg),
    highKg: r1(series.length ? Math.max(...series) : latest.kg),
    series,
    oldDate: utc(latest.date) < from ? latest.date : null,
  };
}

/** One day of the training load series: the day's load, 7-day fatigue (ATL) and form (TSB). */
export type LoadDay = { date: string; load?: number; atl?: number; tsb?: number };

export type LoadSummary = {
  /** Daily load for the `n` days up to `today`, oldest first, rounded; a day without a row is 0. */
  loads: number[];
  /** The 7-day fatigue on the same days, never below 0. */
  fatigue: number[];
  /** Form on the newest day, rounded; null when the newest day is older than yesterday. */
  form: number | null;
  /** The load of the last 7 calendar days, today included. */
  weekLoad: number;
};

/**
 * The Training load widget's numbers from the series' days (any dates, oldest
 * first). The `n` days are built by date, so a missing day is a 0 bar and not
 * a shift of the days after it. A missing day's fatigue is the day before's,
 * less one rest day of a 7-day average (x 6/7); days before the first row take
 * its value. Form is today's state, so it is left out when the newest day
 * with data is older than yesterday. Null when the `n` days hold no load.
 */
export function loadSummary(days: LoadDay[], today: string, n = 28): LoadSummary | null {
  const byDate = new Map(days.filter((d) => d.date <= today).map((d) => [d.date, d]));
  const dates = Array.from({ length: n }, (_, i) => new Date(utc(today) - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  const loads = dates.map((d) => Math.max(0, Math.round(byDate.get(d)?.load ?? 0)));
  if (!loads.some((l) => l > 0)) return null;

  const firstAtl = dates.map((d) => byDate.get(d)?.atl).find((a) => a !== undefined) ?? 0;
  let prev: number | null = null;
  const fatigue = dates.map((d) => {
    const atl = byDate.get(d)?.atl;
    const v: number = atl !== undefined ? atl : prev === null ? firstAtl : prev * (6 / 7);
    prev = v;
    return Math.max(0, v);
  });

  const newest = [...byDate.keys()].sort().at(-1);
  const recent = newest !== undefined && daysUntil(newest, today) <= 1;
  const tsb = newest !== undefined ? byDate.get(newest)?.tsb : undefined;
  return {
    loads,
    fatigue,
    form: recent && tsb !== undefined ? Math.round(tsb) + 0 : null,
    weekLoad: loads.slice(-7).reduce((a, b) => a + b, 0),
  };
}
