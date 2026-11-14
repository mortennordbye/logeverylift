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

export type WeightSummary = {
  latestKg: number;
  /** Latest minus the first entry in the window; null with fewer than two entries in it. */
  changeKg: number | null;
  lowKg: number;
  highKg: number;
  /** The window's entries, oldest first, for the sparkline. */
  series: number[];
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
  };
}
