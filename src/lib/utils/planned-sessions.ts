/**
 * Dated sessions (docs/plans/sessions.md, sections 3.4 and 4.1), as pure
 * functions: generation from a weekday template, the T7 regeneration rules,
 * and the matcher that links planned sessions to completed workouts.
 *
 * Dates are YYYY-MM-DD strings throughout; string order is date order.
 */

/** Most sessions a weekday cycle day holds (hub decision 4). */
export const MAX_SLOTS_PER_DAY = 3;

/** The largest range list_planned_sessions reads at once. */
export const PLANNED_RANGE_MAX_DAYS = 93;

export type TemplateSlot = {
  id: number;
  dayOfWeek: number | null;
  daySlot: number;
  /** Rotation position of the slot (1, 2, 3 …); null on a weekday cycle. */
  orderIndex?: number | null;
  /** Null for a rest day, or a slot whose program is deleted. */
  programId: number | null;
  label: string | null;
  notes: string | null;
  autoComplete: boolean;
  /** A library workout instead of a program (docs/plans/workouts-and-compliance.md, 5): its JSON, copied into each session. */
  workout?: unknown;
  workoutId?: number | null;
  priority?: "key" | "support" | "optional" | null;
  /** The next slot of the day is the run of a brick. */
  brickWithNext?: boolean;
};

/**
 * The rules for the slots of one weekday (3.1): a rest day is the only slot
 * of its day, and a day's sessions are numbered 1, 2, 3 without gaps.
 * `others` are the day's other slots. Null when the slot may be written.
 */
export function daySlotProblem(params: {
  daySlot: number;
  programId: number | null;
  others: { daySlot: number; programId: number | null }[];
}): string | null {
  const { daySlot, programId, others } = params;
  if (daySlot < 1 || daySlot > MAX_SLOTS_PER_DAY) return `A day holds at most ${MAX_SLOTS_PER_DAY} sessions.`;
  if (programId == null && others.length) return "A rest day holds no other session. Remove the day's other sessions first.";
  if (programId != null && others.some((o) => o.programId == null)) return "This day is a rest day. Remove the rest day first.";
  if (daySlot > 1 && !others.some((o) => o.daySlot === daySlot - 1)) return `Add session ${daySlot - 1} of this day first.`;
  return null;
}

/**
 * One day of the home week strip (review 7): a day with dated sessions has a
 * program dot even when they were declined, as the template's day had before;
 * the count shows only sessions still to do or done. Outside the block, or
 * when the dated sessions could not be read, the template decides.
 */
export function weekDayMarks(params: {
  planned: { status: string }[] | null;
  inBlock: boolean;
  templateHasProgram: boolean;
}): { hasProgram: boolean; count: number } {
  const { planned, inBlock, templateHasProgram } = params;
  if (!inBlock || planned == null) return { hasProgram: templateHasProgram, count: 0 };
  return { hasProgram: planned.length > 0, count: planned.filter((p) => p.status !== "skipped").length };
}

export type GeneratedSession = {
  slotId: number;
  templateDate: string;
  date: string;
  position: number;
  /** Null for a workout session. */
  programId: number | null;
  label: string | null;
  notes: string | null;
  autoComplete: boolean;
  /** Set only for a workout slot (docs/plans/workouts-and-compliance.md, 5). */
  workout?: unknown;
  workoutId?: number | null;
  /** Set only when the slot sets a priority. */
  priority?: "key" | "support" | "optional" | null;
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Add days to a YYYY-MM-DD date. */
export function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + days));
  return x.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function dowOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The Monday of a date's week. */
export function mondayOf(date: string): string {
  return addDaysStr(date, 1 - dowOf(date));
}

/**
 * One session per program slot per day, from `start` for `lengthDays` days.
 * Rest days, and slots whose program is gone, make no session.
 */
export function generateWeekday(start: string, lengthDays: number, slots: TemplateSlot[]): GeneratedSession[] {
  const out: GeneratedSession[] = [];
  const byDay = new Map<number, TemplateSlot[]>();
  for (const s of slots) {
    if (s.dayOfWeek == null || (s.programId == null && s.workout == null)) continue;
    byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) ?? []), s]);
  }
  for (let i = 0; i < lengthDays; i++) {
    const date = addDaysStr(start, i);
    const daySlots = (byDay.get(dowOf(date)) ?? []).sort((a, b) => a.daySlot - b.daySlot || a.id - b.id);
    for (const s of daySlots) {
      out.push({
        slotId: s.id,
        templateDate: date,
        date,
        position: s.daySlot,
        programId: s.programId,
        label: s.label,
        notes: s.notes,
        autoComplete: s.autoComplete,
        ...(s.programId == null && s.workout != null && { workout: s.workout, workoutId: s.workoutId ?? null }),
        ...(s.priority != null && { priority: s.priority }),
      });
    }
  }
  return out;
}

export type ExistingRow = {
  id: number;
  slotId: number | null;
  templateDate: string | null;
  date: string | null;
  position: number;
  programId: number | null;
  label: string | null;
  notes: string | null;
  autoComplete: boolean;
  touched: boolean;
  /** Matched to a completed workout (4.1). */
  done: boolean;
  /** A workout was started for it, done or not: it is never removed. */
  linked?: boolean;
  /** Skipped: it keeps no place in the day's count of three. */
  skipped?: boolean;
  workout?: unknown;
  workoutId?: number | null;
  priority?: "key" | "support" | "optional" | null;
};

export type RegenerationPlan = {
  update: { id: number; fields: Partial<GeneratedSession> }[];
  insert: GeneratedSession[];
  remove: number[];
  /** Template days left out because the day already holds three sessions. */
  capped: string[];
};

export const templateKey = (slotId: number | null, templateDate: string | null) => `${slotId}|${templateDate}`;

/**
 * The T7 rules (3.4). `block` is the block's days [start, end), or null when
 * the cycle has no dates any more (an unscheduled draft, or a completed one
 * from `today` on). Done rows, rows a workout was started for, and rows
 * before `editableFrom` never change. Touched and added rows keep their
 * changes, unless the block no longer holds their date; then they go, and
 * their template day is not filled again. Untouched rows from `editableFrom`
 * on follow the template, matched by (slot, template date), so a kept row
 * keeps its id. `editableFrom` is the Monday of the current week (hub
 * decision, docs/plans/sessions.md, section 20): this week's past days
 * follow a template edit, as they did before dated sessions. Missing earlier
 * rows are made only when `includePast` (the first generation, or a new start
 * date). No day gets more than three sessions that are not skipped.
 */
export function regenerationPlan(params: {
  existing: ExistingRow[];
  generated: GeneratedSession[];
  today: string;
  block: { start: string; end: string } | null;
  includePast: boolean;
  editableFrom?: string;
  /**
   * Template days (slot|date keys) not to fill: those of sessions the user
   * moved and that a block change then removed, in this run or an earlier one.
   */
  reserved?: ReadonlySet<string>;
}): RegenerationPlan {
  const { existing, generated, today, block, includePast } = params;
  const editableFrom = params.editableFrom && params.editableFrom < today ? params.editableFrom : today;
  const fixed = (r: ExistingRow) => r.done || r.linked === true;
  if (block == null) {
    // No dates any more: the sessions from today on go; the past stays.
    return { update: [], insert: [], remove: existing.filter((r) => !fixed(r) && (r.date == null || r.date >= today)).map((r) => r.id), capped: [] };
  }
  const inBlock = (d: string | null) => d != null && block != null && d >= block.start && d < block.end;
  const gen = new Map(generated.map((g) => [templateKey(g.slotId, g.templateDate), g]));
  const plan: RegenerationPlan = { update: [], insert: [], remove: [], capped: [] };
  const kept = new Set<string>(params.reserved ?? []);
  /** Sessions per day that keep a place in the cap: not skipped, not removed. */
  const perDay = new Map<string, number>();
  const count = (date: string | null) => {
    if (date) perDay.set(date, (perDay.get(date) ?? 0) + 1);
  };

  for (const r of existing) {
    if (fixed(r)) {
      kept.add(templateKey(r.slotId, r.templateDate));
      if (!r.skipped) count(r.date);
      continue;
    }
    const past = r.date != null && r.date < today;
    if (r.touched || r.templateDate == null) {
      // A changed or added session stays while its date is in the block; a
      // past one stays for the history. One that goes leaves its template day
      // empty: the user moved it away from that day.
      kept.add(templateKey(r.slotId, r.templateDate));
      if (inBlock(r.date) || (past && r.date! >= block.start)) {
        if (!r.skipped) count(r.date);
      } else plan.remove.push(r.id);
      continue;
    }
    if (r.date != null && r.date < editableFrom) {
      if (r.date! >= block.start) {
        kept.add(templateKey(r.slotId, r.templateDate));
        if (!r.skipped) count(r.date);
      } else plan.remove.push(r.id);
      continue;
    }
    const g = gen.get(templateKey(r.slotId, r.templateDate));
    if (!g || !inBlock(g.date)) {
      plan.remove.push(r.id);
      continue;
    }
    kept.add(templateKey(r.slotId, r.templateDate));
    if (!r.skipped) count(g.date);
    const fields: Partial<GeneratedSession> = {};
    if (r.date !== g.date) fields.date = g.date;
    if (r.position !== g.position) fields.position = g.position;
    if (r.programId !== g.programId) fields.programId = g.programId;
    if (r.label !== g.label) fields.label = g.label;
    if (r.notes !== g.notes) fields.notes = g.notes;
    if (r.autoComplete !== g.autoComplete) fields.autoComplete = g.autoComplete;
    if (!sameJson(r.workout, g.workout)) {
      fields.workout = g.workout ?? null;
      fields.workoutId = g.workoutId ?? null;
    }
    if ((r.priority ?? null) !== (g.priority ?? null)) fields.priority = g.priority ?? null;
    if (Object.keys(fields).length) plan.update.push({ id: r.id, fields });
  }

  for (const [k, g] of gen) {
    if (kept.has(k)) continue;
    if (!inBlock(g.date)) continue;
    if (g.date < editableFrom && !includePast) continue;
    if ((perDay.get(g.date) ?? 0) >= MAX_SLOTS_PER_DAY) {
      plan.capped.push(g.date);
      continue;
    }
    count(g.date);
    plan.insert.push(g);
  }
  return plan;
}

export type PlannedForMatch = { id: number; date: string; position: number; programId: number | null };
export type CompletedForMatch = {
  id: number;
  date: string;
  intendedDate: string | null;
  programId: number | null;
  plannedSessionId: number | null;
};

/**
 * Link planned sessions to completed workouts (4.1). Per date, in three
 * passes: the workout started for that session; then an unused workout of the
 * same program on that date (its date or the day it makes up); then any
 * unused workout on that date. A workout is used at most once per date, so a
 * make-up clears both its own day and the day it makes up, as before.
 * Returns planned id -> the workout id and the pass that matched it.
 */
export function matchPlanned(
  planned: PlannedForMatch[],
  sessions: CompletedForMatch[],
): Map<number, { sessionId: number; step: 1 | 2 | 3 }> {
  const out = new Map<number, { sessionId: number; step: 1 | 2 | 3 }>();
  const used = new Set<string>(); // `${sessionId}|${date}`
  const onDate = new Map<string, CompletedForMatch[]>();
  for (const s of sessions) {
    for (const d of new Set([s.date, s.intendedDate].filter((x): x is string => x != null))) {
      onDate.set(d, [...(onDate.get(d) ?? []), s]);
    }
  }
  const byDate = new Map<string, PlannedForMatch[]>();
  for (const p of planned) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);

  // Pass 1, everywhere first: a link wins over any fallback on its day.
  for (const p of planned) {
    const s = sessions.find((x) => x.plannedSessionId === p.id);
    if (s) {
      out.set(p.id, { sessionId: s.id, step: 1 });
      used.add(`${s.id}|${p.date}`);
    }
  }
  for (const [date, list] of byDate) {
    const ordered = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
    const candidates = (onDate.get(date) ?? []).slice().sort((a, b) => a.id - b.id);
    const free = (s: CompletedForMatch) => !used.has(`${s.id}|${date}`);
    for (const step of [2, 3] as const) {
      for (const p of ordered) {
        if (out.has(p.id)) continue;
        const s = candidates.find((c) => free(c) && (step === 3 || (c.programId != null && c.programId === p.programId)));
        if (s) {
          out.set(p.id, { sessionId: s.id, step });
          used.add(`${s.id}|${date}`);
        }
      }
    }
  }
  return out;
}
