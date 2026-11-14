/**
 * Dates in a line of UI text, kept on one line: "Mon 14 Dec", "28 Dec" and
 * "5 Sep 2027" get non-breaking spaces, and a range dash stays with the date
 * before it ("9 Nov –" then "27 Dec"). A narrow screen then breaks a line
 * between dates, never inside one. For display only: the words are the same.
 */

const NBSP = " ";
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const WEEKDAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";

const WEEKDAY_DAY = new RegExp(`\\b(${WEEKDAY}) (?=\\d{1,2}\\b)`, "g");
const DAY_MONTH = new RegExp(`\\b(\\d{1,2}) (?=${MONTH}\\b)`, "g");
const MONTH_YEAR = new RegExp(`\\b(${MONTH}) (?=\\d{4}\\b)`, "g");
const DASH = / (?=[–-] )/g;

export function keepDates(text: string): string {
  return text
    .replace(WEEKDAY_DAY, `$1${NBSP}`)
    .replace(DAY_MONTH, `$1${NBSP}`)
    .replace(MONTH_YEAR, `$1${NBSP}`)
    .replace(DASH, NBSP);
}
