/**
 * Dates and counts in a line of UI text, kept on one line: "Mon 14 Dec",
 * "28 Dec" and "5 Sep 2027", "week 3 of 6" and "90 days" get non-breaking
 * spaces, and a range dash or a "·" separator stays with the word before it
 * ("9 Nov –" then "27 Dec"; "Base ·" then "16 Nov"), so no line starts with
 * one. A narrow screen then breaks a line between dates and parts, never
 * inside one. For display only: the words are the same.
 */

const NBSP = "\u00a0";
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const WEEKDAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
const UNIT = "(?:days?|weeks?|wk|months?|min|h|km|m|kg|sessions?)";

const WEEKDAY_DAY = new RegExp(`\\b(${WEEKDAY}) (?=\\d{1,2}\\b)`, "g");
const DAY_MONTH = new RegExp(`\\b(\\d{1,2}) (?=${MONTH}\\b)`, "g");
const MONTH_YEAR = new RegExp(`\\b(${MONTH}) (?=\\d{4}\\b)`, "g");
/** "week 3", "Position 2", "Phase 1". */
const WORD_NUMBER = /\b(week|Week|position|Position|phase|Phase) (?=\d)/g;
/** "3 of 6". */
const OF = /\b(\d+) of (\d+)\b/g;
/** "90 days", "8 wk", "2 h". */
const NUMBER_UNIT = new RegExp(`\\b(\\d+) (?=${UNIT}\\b)`, "g");
const DASH = / (?=[–-] )/g;
const DOT = / (?=· )/g;

export function keepDates(text: string): string {
  return text
    .replace(WEEKDAY_DAY, `$1${NBSP}`)
    .replace(DAY_MONTH, `$1${NBSP}`)
    .replace(MONTH_YEAR, `$1${NBSP}`)
    .replace(WORD_NUMBER, `$1${NBSP}`)
    .replace(OF, `$1${NBSP}of${NBSP}$2`)
    .replace(NUMBER_UNIT, `$1${NBSP}`)
    .replace(DASH, NBSP)
    .replace(DOT, NBSP);
}
