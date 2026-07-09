/**
 * Cycle position helpers — pure functions over (startDate, slots, sessions, today).
 *
 * Rotation mode rules:
 *   - Each rest slot (programId == null) consumes one calendar day.
 *   - Each active slot waits for a completed session, then consumes one calendar day.
 *   - If an active slot's expected day passes with no completion, the slot stays current
 *     ("repeat" semantics) and the date is recorded in `missed`.
 *
 * Day-of-week mode rules:
 *   - Today's slot = today's weekday slot. Skipped days do NOT carry over.
 *   - `missed` is the set of past N days (bounded by [startDate, today)) where an
 *     active slot was scheduled but no completed session exists.
 */

type SlotLike = {
  id: number;
  dayOfWeek: number | null;
  orderIndex: number | null;
  programId: number | null;
};

const MS_PER_DAY = 86_400_000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_PER_DAY);
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Convert JS day-of-week (0=Sun…6=Sat) to our convention (1=Mon…7=Sun).
 */
export function jsDayToDow(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

export type RotationWalkResult = {
  /** The cycle-relative position; modulo slots.length to find the current slot. */
  position: number;
  /** Active slots whose expected day has passed without a completed session. */
  missed: { date: string; slotIndex: number }[];
};

/**
 * Walk forward from startDate one calendar day at a time, advancing position
 * according to rotation rules.
 *
 * `completedSessionDates` is a sorted-ascending list of ISO date strings (YYYY-MM-DD)
 * representing the dates of completed workout sessions since (>=) startDate.
 *
 * Only one session per day is consumed — extra sessions on the same day are ignored.
 *
 * The walk stops at `today` (today itself is not consumed — it is "what's next").
 */
export function walkRotation(
  startDate: Date,
  slots: SlotLike[],
  completedSessionDates: string[],
  today: Date,
): RotationWalkResult {
  if (slots.length === 0) {
    return { position: 0, missed: [] };
  }

  const start = startOfDay(startDate);
  const end = startOfDay(today);
  const sortedSlots = [...slots].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  );

  // Bucket completed sessions by date — track unconsumed count per date.
  const unconsumedByDate = new Map<string, number>();
  for (const date of completedSessionDates) {
    unconsumedByDate.set(date, (unconsumedByDate.get(date) ?? 0) + 1);
  }

  let position = 0;
  const missed: { date: string; slotIndex: number }[] = [];

  let dayCursor = start;
  while (dayCursor.getTime() < end.getTime()) {
    const slotIndex = position % sortedSlots.length;
    const slot = sortedSlots[slotIndex];
    const dateStr = toDateStr(dayCursor);

    if (slot.programId === null) {
      // Rest slot: consume 1 calendar day automatically.
      position += 1;
      dayCursor = addDays(dayCursor, 1);
    } else {
      // Active slot: needs a completed session on (or before) this day.
      const available = unconsumedByDate.get(dateStr) ?? 0;
      if (available > 0) {
        unconsumedByDate.set(dateStr, available - 1);
        position += 1;
        dayCursor = addDays(dayCursor, 1);
      } else {
        // Missed: record and advance calendar but NOT position (repeat semantics).
        missed.push({ date: dateStr, slotIndex });
        dayCursor = addDays(dayCursor, 1);
      }
    }
  }

  return { position, missed };
}

/**
 * Resolve today's slot + missed list for rotation mode.
 *
 * Returns null `todaySlotId` when slots is empty.
 */
export function resolveRotation(
  startDate: Date,
  slots: SlotLike[],
  completedSessionDates: string[],
  today: Date,
): {
  todaySlotId: number | null;
  missed: { date: string; slotIndex: number; slotId: number }[];
} {
  if (slots.length === 0) {
    return { todaySlotId: null, missed: [] };
  }
  const sortedSlots = [...slots].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  );
  const { position, missed } = walkRotation(startDate, slots, completedSessionDates, today);
  const todaySlot = sortedSlots[position % sortedSlots.length];
  return {
    todaySlotId: todaySlot?.id ?? null,
    missed: missed.map((m) => ({
      date: m.date,
      slotIndex: m.slotIndex,
      slotId: sortedSlots[m.slotIndex].id,
    })),
  };
}

/**
 * Compute missed active workouts for day-of-week mode in the window
 * [max(startDate, today - lookbackDays), today).
 *
 * `completedDatesSet` is a Set of YYYY-MM-DD strings on which the user has a completed session.
 * A slot is "missed" if its `programId` is non-null and no completed session exists for that date.
 */
export function findDayOfWeekMissed(
  startDate: Date,
  slots: SlotLike[],
  completedDatesSet: Set<string>,
  today: Date,
  lookbackDays = 7,
): { date: string; slotId: number }[] {
  const start = startOfDay(startDate);
  const end = startOfDay(today);
  const slotByDow = new Map<number, SlotLike>();
  for (const s of slots) {
    if (s.dayOfWeek != null) slotByDow.set(s.dayOfWeek, s);
  }

  const missed: { date: string; slotId: number }[] = [];
  for (let offset = 1; offset <= lookbackDays; offset++) {
    const d = addDays(end, -offset);
    if (d.getTime() < start.getTime()) break;
    const dow = jsDayToDow(d.getDay());
    const slot = slotByDow.get(dow);
    if (!slot || slot.programId === null) continue; // rest day or unassigned
    const dateStr = toDateStr(d);
    if (!completedDatesSet.has(dateStr)) {
      missed.push({ date: dateStr, slotId: slot.id });
    }
  }
  // Return chronological ascending so UI can show oldest first.
  return missed.reverse();
}
