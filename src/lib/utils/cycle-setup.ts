/**
 * The start choice of the new cycle setup (docs/plans/plan-tab-redesign.md, P3):
 * Today, Next Monday, Pick a date, or After current cycle. Days are
 * `YYYY-MM-DD` in the user's time zone, worked out on the server. Also the
 * choices that the setup form and the edit form share.
 */

import { addDays, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";

export type StartChoice = "today" | "monday" | "date" | "after";

export type StartDays = {
  today: string;
  /** The next Monday after today (a week ahead when today is a Monday). */
  nextMonday: string;
  /** The first day after the running cycle, or null when no cycle runs. */
  afterCurrent: string | null;
  /** The last day a draft can be scheduled for. */
  latest: string;
};

/** The next Monday after `today`; a week ahead when today is a Monday. */
export function nextMonday(today: string): string {
  const d = parseDateStr(today);
  const isoDay = d.getDay() === 0 ? 7 : d.getDay();
  return toDateStr(addDays(d, 8 - isoDay));
}

/** The day a choice starts on; `picked` is the date field's value. */
export function startDayFor(choice: StartChoice, days: StartDays, picked: string): string | null {
  if (choice === "today") return days.today;
  if (choice === "monday") return days.nextMonday;
  if (choice === "after") return days.afterCurrent;
  return /^\d{4}-\d{2}-\d{2}$/.test(picked) ? picked : null;
}

// ── The words the setup and edit forms share ─────────────────────────────────

export type ScheduleType = "day_of_week" | "rotation";
export type EndAction = "none" | "deload" | "new_cycle" | "rest";

/** The lengths offered as chips; any other length goes in the Custom field. */
export const MAIN_LENGTHS = [4, 6, 8, 12];

export const SCHEDULE_MODES: { value: ScheduleType; title: string; sub: string }[] = [
  { value: "day_of_week", title: "Same days each week", sub: "Monday upper, Thursday lower" },
  { value: "rotation", title: "Rotation", sub: "The next session follows the last one. No fixed days." },
];

export const END_ACTIONS: { value: EndAction; label: string }[] = [
  { value: "none", label: "Just stop" },
  { value: "deload", label: "Deload week" },
  { value: "new_cycle", label: "Start a new cycle" },
  { value: "rest", label: "Rest period" },
];

/** The choice that gives `day`, to show a day chosen before (Back from step 2). */
export function choiceFor(day: string, days: StartDays): StartChoice {
  if (day === days.today) return "today";
  if (day === days.afterCurrent) return "after";
  if (day === days.nextMonday) return "monday";
  return "date";
}
