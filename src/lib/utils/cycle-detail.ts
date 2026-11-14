/**
 * Pure helpers for the cycle detail screen (docs/plans/plan-tab-redesign.md,
 * P2): the block's weeks for the week switcher, date words, and the rotation
 * order with its next, skipped and done marks.
 */

import type { AnswerSession } from "@/components/features/answer-session";
import { addDaysStr, dowOf } from "@/lib/utils/planned-sessions";
import type { MoveSuggestion } from "@/lib/utils/session-compliance";
import { shortDay } from "@/lib/utils/seasons";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type BlockWeek = { from: string; to: string };

/** One dated session of a weekday cycle as the detail shows it. */
export type DetailSession = {
  id: number;
  date: string;
  position: number;
  name: string;
  label: string | null;
  notes: string | null;
  /** A structured workout's length, such as "60 min" (endurance only). */
  summary: string | null;
  /** The program's first exercises, such as "Squat, Bench press, Row". */
  exercises: string | null;
  programId: number | null;
  status: "planned" | "done" | "missed" | "skipped";
  touched: boolean;
  templateDate: string | null;
  /** Endurance only: a key session, and a run linked to the ride before it. */
  key: boolean;
  brick: boolean;
  /** Endurance only: set on a past session nobody has answered yet. */
  answer: AnswerSession | null;
  /** Endurance only: a missed key session's suggested day, as home offers it (D19). */
  moveTo?: MoveSuggestion | null;
};

/**
 * The line under the cycle name: "8 weeks · Rotation · Week 3 of 6". The
 * length comes first, as on the Plan list row ("4 weeks · Same days each
 * week"); a rotation adds its week, a weekday cycle shows it in the switcher.
 */
export function cycleSubLine(scheduleType: "day_of_week" | "rotation", length: string, currentWeek: number | null, totalWeeks: number): string {
  const rotation = scheduleType === "rotation";
  return [length, rotation ? "Rotation" : "Same days each week", rotation && currentWeek ? `Week ${currentWeek} of ${totalWeeks}` : null].filter(Boolean).join(" · ");
}

/** A row opens the session sheet, "Did you do it?", or nothing (done, rest, a past skip). */
export function rowAction(s: Pick<DetailSession, "status" | "date" | "answer">, today: string): "answer" | "sheet" | null {
  if (s.answer) return "answer";
  if (s.status === "done") return null;
  if (s.status === "skipped") return s.date >= today ? "sheet" : null;
  return "sheet";
}

/** True when a session sits on another day than its template day. */
export function isMoved(s: Pick<DetailSession, "date" | "templateDate">): boolean {
  return s.templateDate != null && s.templateDate !== s.date;
}

/**
 * A session's state when it is not just planned, then "Moved from Tue" or
 * "Changed" when the user changed this one day: "Missed · Moved from Tue".
 * A skip and a Missed answer also touch the row; Skipped and Missed say
 * enough. Null for a plain planned session. The row and the session sheet's
 * header line both show it.
 */
export function sessionState(s: Pick<DetailSession, "status" | "answer" | "date" | "touched" | "templateDate">): string | null {
  const state = s.answer ? "Did you do it?" : s.status === "done" ? "Done" : s.status === "skipped" ? "Skipped" : s.status === "missed" ? "Missed" : null;
  const change =
    s.status === "skipped"
      ? null
      : isMoved(s)
        ? `Moved from ${weekdayShort(s.templateDate!)}`
        : s.touched && s.templateDate != null && s.status !== "missed"
          ? "Changed"
          : null;
  return [state, change].filter(Boolean).join(" · ") || null;
}

/** The words under a session's name: its state (sessionState), then what it holds. */
export function sessionSub(s: Pick<DetailSession, "status" | "summary" | "exercises" | "answer" | "date" | "touched" | "templateDate">): string {
  return [sessionState(s), s.summary ?? s.exercises ?? ""].filter(Boolean).join(" · ");
}

type DaySlotLike = { dayOfWeek?: number | null; programId?: number | null; workoutId?: number | null; label?: string | null };

/**
 * The labels of weekdays (1 = Monday) whose slots hold no program and no
 * workout but carry a name of their own, such as "Mobility". A plain "Rest"
 * label is left out: those days read Rest anyway.
 */
export function dayLabels(slots: DaySlotLike[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const mine = slots.filter((s) => s.dayOfWeek === day);
    if (mine.length === 0 || mine.some((s) => s.programId != null || s.workoutId != null)) continue;
    const names = mine.map((s) => s.label?.trim()).filter((l): l is string => !!l && l.toLowerCase() !== "rest");
    if (names.length) out[day] = names.join(" · ");
  }
  return out;
}

/** The label of `date`'s weekday from `dayLabels`, if it has one. */
export function dayLabelOn(labels: Record<number, string> | undefined, date: string): string | null {
  return labels?.[dowOf(date)] ?? null;
}

/** The block's weeks of 7 days from its first day; the last one ends on the block's last day. */
export function blockWeeks(start: string, lengthDays: number): BlockWeek[] {
  const weeks: BlockWeek[] = [];
  for (let offset = 0; offset < lengthDays; offset += 7) {
    weeks.push({ from: addDaysStr(start, offset), to: addDaysStr(start, Math.min(offset + 7, lengthDays) - 1) });
  }
  return weeks;
}

/** The index of the week that holds `date`: the first week before the block, the last after it. */
export function weekIndexOf(weeks: BlockWeek[], date: string): number {
  if (weeks.length === 0 || date < weeks[0].from) return 0;
  const i = weeks.findIndex((w) => date >= w.from && date <= w.to);
  return i === -1 ? weeks.length - 1 : i;
}

/** The days of a week, first to last. */
export function weekDays(week: BlockWeek): string[] {
  const out: string[] = [];
  for (let d = week.from; d <= week.to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

function parts(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return { date: d.getUTCDate(), month: d.getUTCMonth(), weekday: d.getUTCDay() };
}

/** "16 Nov". */
export function dayMonth(day: string): string {
  const p = parts(day);
  return `${p.date} ${MONTH_SHORT[p.month]}`;
}

/** "Mon". */
export function weekdayShort(day: string): string {
  return WEEKDAY_SHORT[parts(day).weekday];
}

/** "16–22 Nov", or "30 Nov – 6 Dec" across two months. */
export function weekRangeLabel(week: BlockWeek): string {
  const a = parts(week.from);
  const b = parts(week.to);
  if (a.month === b.month) return `${a.date}–${b.date} ${MONTH_SHORT[b.month]}`;
  return `${dayMonth(week.from)} – ${dayMonth(week.to)}`;
}

/** "Done Tue" in the last 6 days, else "Done 9 Nov". */
export function doneLabel(day: string, today: string): string {
  return day >= addDaysStr(today, -6) ? `Done ${weekdayShort(day)}` : `Done ${dayMonth(day)}`;
}

/** "Today", or "Mon 16 Nov". */
export function sessionDayLabel(day: string, today: string): string {
  return day === today ? "Today" : shortDay(day);
}

type SetLike = { targetReps: number | null; repRangeMin: number | null; repRangeMax: number | null; durationSeconds: number | null };

/** A lift's sets in short: "4 × 6–8", "3 × 8", "3 × 0:45"; "3 sets" when the sets differ. */
export function setsShort(sets: SetLike[]): string {
  if (sets.length === 0) return "";
  const one = (s: SetLike) => {
    if (s.durationSeconds != null) return `${Math.floor(s.durationSeconds / 60)}:${String(s.durationSeconds % 60).padStart(2, "0")}`;
    if (s.repRangeMin != null && s.repRangeMax != null) return `${s.repRangeMin}–${s.repRangeMax}`;
    return s.targetReps != null ? String(s.targetReps) : null;
  };
  const tokens = sets.map(one);
  return tokens[0] != null && tokens.every((t) => t === tokens[0]) ? `${sets.length} × ${tokens[0]}` : `${sets.length} sets`;
}

export type RotationSlotLike ={ id: number; orderIndex: number | null; programId: number | null; label: string | null; programName: string | null };

/** One day of the rotation walk: a rotation cycle's planned session view. */
export type RotationWalkDay = {
  date: string;
  slotId: number | null;
  rotationPosition: number | null;
  programId: number | null;
  programName: string | null;
  status: "planned" | "done" | "missed" | "skipped";
};

export type RotationRow = {
  slotId: number;
  /** 1-based place in the order. */
  n: number;
  name: string;
  programId: number | null;
  rest: boolean;
  mark: "next" | "skipped" | "swapped" | "done" | null;
  /** The coming turn runs another program than the slot's, also when it is the next one. */
  swapped: boolean;
  /** The slot's next walk day from today on: what skip and change act on. */
  upcoming: RotationWalkDay | null;
  lastDone: string | null;
};

/**
 * The rotation order as the detail shows it: each slot with its next walk day
 * from today on, the cycle's next session, and the day it was last done.
 */
export function rotationRows(slots: RotationSlotLike[], walk: RotationWalkDay[], today: string): RotationRow[] {
  const ordered = [...slots].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const next = walk.find((d) => d.date >= today && d.status === "planned") ?? null;
  return ordered.map((slot, i) => {
    const upcoming = walk.find((d) => d.slotId === slot.id && d.date >= today && (d.status === "planned" || d.status === "skipped")) ?? null;
    const done = walk.filter((d) => d.slotId === slot.id && d.status === "done");
    const lastDone = done.length ? done[done.length - 1].date : null;
    const rest = slot.programId == null;
    // The row shows the coming position's program. A swapped one is marked as
    // such, never with the day this slot was last done: that was another session.
    const swapped = upcoming?.status === "planned" && upcoming.programId !== slot.programId;
    const mark: RotationRow["mark"] =
      upcoming && next && upcoming.rotationPosition === next.rotationPosition
        ? "next"
        : upcoming?.status === "skipped"
          ? "skipped"
          : swapped
            ? "swapped"
            : lastDone
              ? "done"
              : null;
    return {
      slotId: slot.id,
      n: i + 1,
      name: rest ? (slot.label ?? "Rest") : (upcoming?.programName ?? slot.programName ?? slot.label ?? "Session"),
      programId: rest ? null : (upcoming?.programId ?? slot.programId),
      rest,
      mark,
      swapped,
      upcoming: rest ? null : upcoming,
      lastDone,
    };
  });
}
