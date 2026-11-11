/**
 * Sleep debt, regularity and timing (2.11). Windows only: the Personal API
 * has no stage timeline, so short wake periods inside a night are not seen.
 */

export type SleepNight = {
  date: string;
  /** Sleep window in ms (local wall-clock timestamps from Garmin's *Local fields). */
  start: number | null;
  end: number | null;
  sleepSeconds: number | null;
  needSeconds: number | null;
  napSeconds: number | null;
};

const DAY_MS = 86_400_000;

/**
 * Sleep debt in seconds over the last 14 nights: need - actual (naps at half
 * value), older nights weigh 0.85^days ago, a surplus night repays at most 1 h,
 * clamped at zero. Nights must be oldest first; the last is "last night".
 */
export function sleepDebt(nights: SleepNight[]): number | null {
  const recent = nights.slice(-14);
  const usable = recent.filter((n) => n.sleepSeconds !== null && n.needSeconds !== null);
  if (usable.length < 3) return null;
  let debt = 0;
  recent.forEach((n, i) => {
    if (n.sleepSeconds === null || n.needSeconds === null) return;
    const actual = n.sleepSeconds + (n.napSeconds ?? 0) / 2;
    const gap = Math.max(n.needSeconds - actual, -3600);
    debt += gap * 0.85 ** (recent.length - 1 - i);
  });
  return Math.max(0, debt);
}

/**
 * Sleep Regularity Index on windows: the share of minutes whose asleep/awake
 * state matches 24 h later, scaled so chance (50 %) is 0 and perfect is 100.
 * Needs at least 7 nights with windows in the last 14.
 */
export function regularityIndex(nights: SleepNight[]): number | null {
  const windows = nights
    .slice(-14)
    .filter((n): n is SleepNight & { start: number; end: number } => n.start !== null && n.end !== null && n.end > n.start);
  if (windows.length < 7) return null;
  const from = Math.floor(Math.min(...windows.map((w) => w.start)) / 60_000);
  const to = Math.ceil(Math.max(...windows.map((w) => w.end)) / 60_000);
  const asleep = new Uint8Array(to - from + 1);
  for (const w of windows) {
    for (let m = Math.floor(w.start / 60_000); m < Math.ceil(w.end / 60_000); m++) asleep[m - from] = 1;
  }
  let same = 0;
  let total = 0;
  for (let m = 0; m + 1440 < asleep.length; m++) {
    total++;
    if (asleep[m] === asleep[m + 1440]) same++;
  }
  if (total === 0) return null;
  return Math.max(0, Math.min(100, -100 + 200 * (same / total)));
}

/** Minutes past midnight of a wall-clock timestamp. */
function minuteOfDay(ts: number) {
  return ((ts % DAY_MS) + DAY_MS) % DAY_MS / 60_000;
}

/** Circular standard deviation of clock times, in minutes. */
export function clockSpreadMinutes(timestamps: number[]): number | null {
  if (timestamps.length < 3) return null;
  const angles = timestamps.map((ts) => (minuteOfDay(ts) / 1440) * 2 * Math.PI);
  const c = angles.reduce((s, a) => s + Math.cos(a), 0) / angles.length;
  const s = angles.reduce((acc, a) => acc + Math.sin(a), 0) / angles.length;
  const r = Math.min(1, Math.hypot(c, s));
  return (Math.sqrt(-2 * Math.log(Math.max(r, 1e-9))) / (2 * Math.PI)) * 1440;
}

export type SleepTiming = { onsetSpread: number | null; wakeSpread: number | null; socialJetlag: number | null };

/** Onset and wake spread, and weekday against weekend midsleep (social jetlag), in minutes. */
export function sleepTiming(nights: SleepNight[]): SleepTiming {
  const w = nights.slice(-28).filter((n): n is SleepNight & { start: number; end: number } => n.start !== null && n.end !== null);
  const midsleep = (n: { start: number; end: number }) => minuteOfDay((n.start + n.end) / 2);
  // The night of a date ends on that date's morning; Saturday and Sunday mornings are the weekend.
  const isWeekend = (n: SleepNight) => [0, 6].includes(new Date(`${n.date}T00:00:00Z`).getUTCDay());
  const weekend = w.filter(isWeekend).map(midsleep);
  const weekday = w.filter((n) => !isWeekend(n)).map(midsleep);
  const circularMean = (xs: number[]) => {
    const a = xs.map((m) => (m / 1440) * 2 * Math.PI);
    const ang = Math.atan2(a.reduce((s, x) => s + Math.sin(x), 0), a.reduce((s, x) => s + Math.cos(x), 0));
    return (((ang / (2 * Math.PI)) * 1440) % 1440 + 1440) % 1440;
  };
  let socialJetlag: number | null = null;
  if (weekend.length >= 2 && weekday.length >= 3) {
    const diff = Math.abs(circularMean(weekend) - circularMean(weekday));
    socialJetlag = Math.min(diff, 1440 - diff);
  }
  return {
    onsetSpread: clockSpreadMinutes(w.map((n) => n.start)),
    wakeSpread: clockSpreadMinutes(w.map((n) => n.end)),
    socialJetlag,
  };
}
