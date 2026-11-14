/**
 * Date labels with fixed English names, never `toLocaleDateString` or `Intl`.
 *
 * A label rendered on the server and again in the browser must come out the
 * same, or React reports a hydration error (#418) and throws the server HTML
 * away. Locale formatting cannot promise that: Node's ICU writes an en-GB
 * short September as "Sept" and WebKit writes "Sep", and comma placement
 * shifts between ICU versions. These labels are built from fixed parts, so
 * they read the same everywhere.
 *
 * Patterns hold only these tokens, spaces and punctuation; a letter outside a
 * token would be read as one:
 * `yyyy` year, `MMMM` "September", `MMM` "Sep", `d` day of month,
 * `EEEE` "Thursday", `EEE` "Thu", `EEEEE` "T", `HH` and `mm` 24-hour time.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Fields = { year: number; month: number; day: number; weekday: number; hours: number; minutes: number };

/**
 * A `YYYY-MM-DD` string is a calendar date: no zone, read as written. A `Date`
 * is read in the runtime's zone, or in UTC with `utc`.
 */
function fieldsOf(date: string | Date, utc: boolean): Fields {
  if (typeof date === "string") {
    const [year, month, day] = date.split("-").map(Number);
    const at = new Date(Date.UTC(year, month - 1, day));
    return { year, month: month - 1, day, weekday: at.getUTCDay(), hours: 0, minutes: 0 };
  }
  return utc
    ? { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), weekday: date.getUTCDay(), hours: date.getUTCHours(), minutes: date.getUTCMinutes() }
    : { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), weekday: date.getDay(), hours: date.getHours(), minutes: date.getMinutes() };
}

const TOKENS = /yyyy|MMMM|MMM|EEEEE|EEEE|EEE|HH|mm|d/g;

export function dateLabel(date: string | Date, pattern: string, { utc = false }: { utc?: boolean } = {}): string {
  const f = fieldsOf(date, utc);
  return pattern.replace(TOKENS, (token) => {
    switch (token) {
      case "yyyy":
        return String(f.year);
      case "MMMM":
        return MONTHS[f.month];
      case "MMM":
        return MONTHS[f.month].slice(0, 3);
      case "EEEEE":
        return WEEKDAYS[f.weekday][0];
      case "EEEE":
        return WEEKDAYS[f.weekday];
      case "EEE":
        return WEEKDAYS[f.weekday].slice(0, 3);
      case "HH":
        return String(f.hours).padStart(2, "0");
      case "mm":
        return String(f.minutes).padStart(2, "0");
      default:
        return String(f.day);
    }
  });
}
