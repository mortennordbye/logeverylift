/**
 * "Today" and the week, in the user's own time zone (decision D14).
 *
 * The server runs in UTC, so a date built with `new Date()` and `setHours(0)`
 * on the server was still yesterday for a user in Oslo after local midnight,
 * and the phone, which dates a logged workout, already said today. Every place
 * that asks "what day is it for this user" goes through here, on the server
 * and in the browser, with the zone stored on the user (`user.time_zone`).
 *
 * A null or unknown zone falls back to the zone of the running code: the
 * server's on the server, the phone's in the browser. That is exactly what
 * happened before the zone existed, so a user with no zone sees no change.
 */

import { parseDateStr, toDateStr } from "@/lib/utils/cycle-position";

/** True when `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (`YYYY-MM-DD`) at `now` in `timeZone`. */
export function localDateStr(now: Date, timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch {
      // An unknown zone name: fall through to the runtime's own zone.
    }
  }
  return toDateStr(now);
}

/**
 * Today in `timeZone` as a local-midnight `Date`: the shape `cycleWeek`, the
 * slot logic and `jsDayToDow(d.getDay())` already take. Only its calendar date
 * means anything; it is not the instant of the user's midnight.
 */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): Date {
  return parseDateStr(localDateStr(now, timeZone));
}

/** The seven dates (`YYYY-MM-DD`), Monday first, of the week holding `dateStr`. */
export function weekDatesOf(dateStr: string): string[] {
  const day = parseDateStr(dateStr);
  const monday = new Date(day);
  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateStr(d);
  });
}

/**
 * "12 Nov, 14:05" in the user's zone (UTC with none). Formatted on the server
 * and passed down as text, so the server and the browser render the same
 * string and hydration cannot disagree about the zone.
 */
export function shortDateTime(at: Date, timeZone: string | null | undefined): string {
  return at.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone ?? "UTC",
  });
}
