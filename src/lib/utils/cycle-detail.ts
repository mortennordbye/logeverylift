/**
 * Pure helpers for the cycle detail screen (docs/plans/plan-tab-redesign.md,
 * P2): the block's weeks for the week switcher, date words, and the rotation
 * order with its next, skipped and done marks.
 */

import type { AnswerSession } from "@/components/features/answer-session";
import { dayMonth } from "@/lib/home/labels";
import { dateLabel } from "@/lib/utils/date-label";
import { addDaysStr, dowOf } from "@/lib/utils/planned-sessions";
import type { MoveSuggestion } from "@/lib/utils/session-compliance";
import { shortDay } from "@/lib/utils/seasons";

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
  /** Why the session was skipped, when the skip gave a reason ("Work trip"). */
  skipReason?: string | null;
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
 * "Back to the template" is offered for a changed day from today on. A skip
 * also touches the row, but a skip alone is not a change: Plan again undoes
 * it, so a skipped session offers the reset only when it was also moved (J5-08).
 */
export function canBackToTemplate(s: Pick<DetailSession, "status" | "date" | "touched" | "templateDate">, today: string): boolean {
  if (!s.touched || s.templateDate == null || s.templateDate < today) return false;
  return s.status !== "skipped" || isMoved(s);
}

/**
 * A session's state when it is not just planned, then "Moved from Tue" or
 * "Changed" when the user changed this one day: "Missed · Moved from Tue".
 * A skip and a Missed answer also touch the row; Skipped and Missed say
 * enough. A skip with a reason gives it: "Skipped · Work trip". Null for a
 * plain planned session. The row and the session sheet's header line both
 * show it.
 */
export function sessionState(s: Pick<DetailSession, "status" | "answer" | "date" | "touched" | "templateDate" | "skipReason">): string | null {
  const reason = s.status === "skipped" && !s.answer ? s.skipReason?.trim() || null : null;
  const state = s.answer ? "Did you do it?" : s.status === "done" ? "Done" : s.status === "skipped" ? "Skipped" : s.status === "missed" ? "Missed" : null;
  const change =
    s.status === "skipped"
      ? null
      : isMoved(s)
        ? `Moved from ${weekdayShort(s.templateDate!)}`
        : s.touched && s.templateDate != null && s.status !== "missed"
          ? "Changed"
          : null;
  return [state, reason, change].filter(Boolean).join(" · ") || null;
}

/** The words under a session's name: its state (sessionState), then what it holds. */
export function sessionSub(s: Pick<DetailSession, "status" | "summary" | "exercises" | "answer" | "date" | "touched" | "templateDate" | "skipReason">): string {
  return [sessionState(s), s.summary ?? s.exercises ?? ""].filter(Boolean).join(" · ");
}

type DaySlotLike = { dayOfWeek?: number | null; programId?: number | null; workoutId?: number | null; label?: string | null; notes?: string | null };

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

/** The notes of the days dayLabels names, by weekday: the labelled day's sheet shows them (J5-11). */
export function dayNotes(slots: DaySlotLike[]): Record<number, string> {
  const labelled = dayLabels(slots);
  const out: Record<number, string> = {};
  for (const day of Object.keys(labelled).map(Number)) {
    const notes = slots
      .filter((s) => s.dayOfWeek === day)
      .map((s) => s.notes?.trim())
      .filter((n): n is string => !!n);
    if (notes.length) out[day] = notes.join("\n");
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

/** "Mon". */
export function weekdayShort(day: string): string {
  return dateLabel(day, "EEE");
}

/** "16–22 Nov", or "30 Nov – 6 Dec" across two months. */
export function weekRangeLabel(week: BlockWeek): string {
  if (week.from.slice(0, 7) === week.to.slice(0, 7)) return `${Number(week.from.slice(8))}–${dayMonth(week.to)}`;
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
  /** Why a skipped position was skipped, when the skip gave a reason. */
  skipReason?: string | null;
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
  /** The slot's own program, which a swapped turn replaced: the sheet names it and swaps back (J3-10). */
  swappedFrom: { programId: number; name: string } | null;
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
  const rows = ordered.map((slot, i) => {
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
      swappedFrom: swapped && slot.programId != null ? { programId: slot.programId, name: slot.programName ?? slot.label ?? "the template" } : null,
      upcoming: rest ? null : upcoming,
      lastDone,
    };
  });
  // A position after Next comes again this round: its done day was last
  // round, so it is not marked done (the hero shows it as still to come).
  const nextAt = rows.findIndex((r) => r.mark === "next");
  return nextAt < 0 ? rows : rows.map((r, i) => (i > nextAt && r.mark === "done" ? { ...r, mark: null } : r));
}

/**
 * The end line of a completed cycle: "ended 30 Oct" when it ran its length,
 * "ended early on 13 Nov" when another start ended it first (J8-09). A block
 * ended early ran up to the day before the start that ended it, and at least
 * its first day. `completedOn` is the day it became completed, in the user's
 * zone, if known.
 */
export function endedLine(startDate: string | null, plannedLast: string | null, today: string, completedOn: string | null): string {
  const early = completedOn != null && plannedLast != null && completedOn <= plannedLast;
  if (!early && plannedLast && plannedLast < today) return `ended ${dayMonth(plannedLast)}`;
  if (!completedOn) return "ended early";
  const before = addDaysStr(completedOn, -1);
  const last = startDate && before < startDate ? startDate : before;
  return `ended early on ${dayMonth(last)}`;
}
