/** Calendar-date helpers for Garmin ranges. Dates are YYYY-MM-DD strings. */

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** Split start..end into pieces of at most maxDays. */
export function chunkRange(start: string, end: string, maxDays: number): [string, string][] {
  const out: [string, string][] = [];
  for (let s = start; s <= end; s = addDays(s, maxDays)) {
    const e = addDays(s, maxDays - 1);
    out.push([s, e < end ? e : end]);
  }
  return out;
}

/** The Monday on or before a date. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/** The calendar date at `now` in an IANA time zone ("Europe/Oslo"); UTC for a missing or unknown zone. */
export function localDate(now: Date, timeZone: string | null): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    } catch {
      // An unknown zone name: fall through to UTC.
    }
  }
  return isoDate(now);
}
