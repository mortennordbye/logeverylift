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

export type GeneratedSession = {
  slotId: number;
  templateDate: string;
  date: string;
  position: number;
  programId: number;
  label: string | null;
  notes: string | null;
  autoComplete: boolean;
};

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
    if (s.dayOfWeek == null || s.programId == null) continue;
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
        programId: s.programId!,
        label: s.label,
        notes: s.notes,
        autoComplete: s.autoComplete,
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
};

export type RegenerationPlan = {
  update: { id: number; fields: Partial<GeneratedSession> }[];
  insert: GeneratedSession[];
  remove: number[];
};

export const templateKey = (slotId: number | null, templateDate: string | null) => `${slotId}|${templateDate}`;

/**
 * The T7 rules (3.4). `block` is the block's days [start, end), or null when
 * the cycle has no dates any more (an unscheduled draft, or a completed one
 * from `today` on). Past and done rows never change. Touched and added rows
 * keep their changes, unless the block no longer holds their date. Untouched
 * future rows follow the template, matched by (slot, template date), so a
 * kept row keeps its id. Missing past rows are made only when `includePast`
 * (the first generation, or a new start date).
 */
export function regenerationPlan(params: {
  existing: ExistingRow[];
  generated: GeneratedSession[];
  today: string;
  block: { start: string; end: string } | null;
  includePast: boolean;
}): RegenerationPlan {
  const { existing, generated, today, block, includePast } = params;
  if (block == null) {
    // No dates any more: the sessions from today on go; the past stays.
    return { update: [], insert: [], remove: existing.filter((r) => !r.done && (r.date == null || r.date >= today)).map((r) => r.id) };
  }
  const inBlock = (d: string | null) => d != null && block != null && d >= block.start && d < block.end;
  const gen = new Map(generated.map((g) => [templateKey(g.slotId, g.templateDate), g]));
  const plan: RegenerationPlan = { update: [], insert: [], remove: [] };
  const kept = new Set<string>();

  for (const r of existing) {
    if (r.done) {
      kept.add(templateKey(r.slotId, r.templateDate));
      continue;
    }
    const past = r.date != null && r.date < today;
    if (r.touched || r.templateDate == null) {
      // A changed or added session stays while its date is in the block; a
      // past one stays for the history.
      if (inBlock(r.date) || (past && block != null && r.date! >= block.start)) kept.add(templateKey(r.slotId, r.templateDate));
      else plan.remove.push(r.id);
      continue;
    }
    if (past) {
      if (block != null && r.date! >= block.start) kept.add(templateKey(r.slotId, r.templateDate));
      else plan.remove.push(r.id);
      continue;
    }
    const g = gen.get(templateKey(r.slotId, r.templateDate));
    if (!g || !inBlock(g.date)) {
      plan.remove.push(r.id);
      continue;
    }
    kept.add(templateKey(r.slotId, r.templateDate));
    const fields: Partial<GeneratedSession> = {};
    if (r.date !== g.date) fields.date = g.date;
    if (r.position !== g.position) fields.position = g.position;
    if (r.programId !== g.programId) fields.programId = g.programId;
    if (r.label !== g.label) fields.label = g.label;
    if (r.notes !== g.notes) fields.notes = g.notes;
    if (r.autoComplete !== g.autoComplete) fields.autoComplete = g.autoComplete;
    if (Object.keys(fields).length) plan.update.push({ id: r.id, fields });
  }

  for (const [k, g] of gen) {
    if (kept.has(k)) continue;
    if (!inBlock(g.date)) continue;
    if (g.date < today && !includePast) continue;
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
