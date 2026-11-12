/**
 * Pure rules of the revision layer (docs/plans/revisions.md, section 2): how
 * snapshots compare and read as text, how an MCP set list matches the stored
 * sets, what a restore keeps, and when a queued write conflicts. The database
 * side is src/lib/plan-revisions.ts.
 */

import type { PlanWriter } from "@/db/schema/plan-revisions";

export type Row = { id: number } & Record<string, unknown>;
export type ExerciseSnap = Row & { exerciseName?: string | null; sets: Row[] };
export type ProgramSnapshot = { v: 1; program: Row; exercises: ExerciseSnap[] };
export type SlotSnap = Row & { programName?: string | null };
export type CycleSnapshot = { v: 1; cycle: Row; slots: SlotSnap[] };
export type PlanSnapshot = ProgramSnapshot | CycleSnapshot;

export const isProgramSnapshot = (s: PlanSnapshot): s is ProgramSnapshot => "program" in s;

// ── Comparing ────────────────────────────────────────────────────────────────

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

/**
 * A stable text form: keys sorted and dates as ISO strings, so a snapshot read
 * back from jsonb (which reorders keys) equals the one built from rows.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sameSnapshot(a: PlanSnapshot | null, b: PlanSnapshot | null): boolean {
  return canonical(a) === canonical(b);
}

/** Two stored field values are the same value (a decimal string equals its number). */
export function sameValue(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    return v;
  };
  return n(a) === n(b);
}

// ── Matching an MCP set list to the stored sets (2.3) ────────────────────────

export type SetMatch<T> =
  | { error: string }
  | { updates: { id: number; input: T }[]; inserts: T[]; deletes: number[] };

/**
 * Which stored set each input set updates. An input with an id updates that
 * set; one without an id updates the unclaimed set at the same set number;
 * the rest are new. A stored set nobody claims is deleted (soft). Ids never
 * change, so logged rows keep their link.
 */
export function matchSets<T extends { id?: number; setNumber: number }>(
  live: { id: number; setNumber: number }[],
  input: T[],
): SetMatch<T> {
  const liveIds = new Set(live.map((s) => s.id));
  const claimed = new Set<number>();
  const updates: { id: number; input: T }[] = [];
  const unmatched: T[] = [];
  for (const s of input) {
    if (s.id == null) {
      unmatched.push(s);
      continue;
    }
    if (!liveIds.has(s.id)) return { error: `Set ${s.id} is not a set of this exercise` };
    if (claimed.has(s.id)) return { error: `Set ${s.id} is named twice` };
    claimed.add(s.id);
    updates.push({ id: s.id, input: s });
  }
  const inserts: T[] = [];
  for (const s of unmatched) {
    const same = live.find((l) => l.setNumber === s.setNumber && !claimed.has(l.id));
    if (same) {
      claimed.add(same.id);
      updates.push({ id: same.id, input: s });
    } else {
      inserts.push(s);
    }
  }
  const deletes = live.filter((l) => !claimed.has(l.id)).map((l) => l.id);
  return { updates, inserts, deletes };
}

// ── Reading a change as text ─────────────────────────────────────────────────

const SET_FIELDS: Record<string, string> = {
  targetReps: "reps",
  weightKg: "weight",
  durationSeconds: "duration",
  distanceMeters: "distance",
  restTimeSeconds: "rest",
  repRangeMin: "rep range min",
  repRangeMax: "rep range max",
  targetRir: "RIR",
  targetHeartRateZone: "HR zone",
  inclinePercent: "incline",
  startDelaySeconds: "start delay",
  peakDistanceMeters: "peak distance",
  peakDurationSeconds: "peak duration",
  setType: "type",
  sessionRole: "role",
  setNumber: "position",
};

const UNITS: Record<string, string> = {
  weightKg: " kg",
  durationSeconds: " s",
  distanceMeters: " m",
  restTimeSeconds: " s",
  peakDistanceMeters: " m",
  peakDurationSeconds: " s",
  inclinePercent: "%",
  startDelaySeconds: " s",
};

const show = (field: string, v: unknown) => {
  if (v == null || v === "") return "none";
  const num = typeof v === "string" && !Number.isNaN(Number(v)) ? Number(v) : v;
  return `${num}${UNITS[field] ?? ""}`;
};

const EXERCISE_FIELDS: Record<string, string> = {
  exerciseId: "exercise",
  notes: "notes",
  orderIndex: "order",
  progressionAdvance: "progression",
  progressionScope: "progression scope",
  progressionRegress: "back-off rule",
  progressionBackoffPct: "back-off size",
  progressionBackoffAfter: "back-off wait",
  progressionReadiness: "readiness rule",
  progressionRequiredHits: "sessions to progress",
  progressionApplyToPlan: "apply to plan",
  progressionSuppressEffortPrompt: "effort prompt",
  overloadIncrementKg: "weight step",
  overloadIncrementReps: "rep step",
  exerciseType: "exercise type",
  weightStack: "weight stack",
};

const CYCLE_FIELDS: Record<string, string> = {
  name: "name",
  durationWeeks: "weeks",
  scheduleType: "schedule",
  goal: "goal",
  athleteLevel: "level",
  raceDate: "race date",
  raceDistance: "race distance",
  status: "status",
  startDate: "start date",
  endAction: "end action",
  endMessage: "end message",
  adaptationPct: "volume adjustment",
};

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fieldLines(prefix: string, labels: Record<string, string>, before: Row, after: Row, setFields = false): string[] {
  const out: string[] = [];
  for (const [field, label] of Object.entries(labels)) {
    if (sameValue(before[field], after[field])) continue;
    if (field === "notes" || field === "endMessage") {
      out.push(`${prefix}${label} changed`);
      continue;
    }
    const from = setFields ? show(field, before[field]) : String(before[field] ?? "none");
    const to = setFields ? show(field, after[field]) : String(after[field] ?? "none");
    out.push(`${prefix}${label} ${from} → ${to}`);
  }
  return out;
}

function exerciseLabel(e: ExerciseSnap): string {
  return e.exerciseName ?? `Exercise ${e.exerciseId}`;
}

/**
 * The change from one snapshot to the next as short lines ("Bench Press,
 * set 2: weight 60 kg → 62.5 kg"). `before` null means the object was created.
 */
export function diffSnapshots(before: PlanSnapshot | null, after: PlanSnapshot): string[] {
  if (isProgramSnapshot(after)) {
    const prev = before && isProgramSnapshot(before) ? before : null;
    if (!prev) return [`Created "${after.program.name}"`];
    const out: string[] = [];
    if (!sameValue(prev.program.name, after.program.name)) {
      out.push(`Renamed "${prev.program.name}" → "${after.program.name}"`);
    }
    const prevEx = new Map(prev.exercises.map((e) => [e.id, e]));
    const nextEx = new Map(after.exercises.map((e) => [e.id, e]));
    for (const e of after.exercises) {
      const old = prevEx.get(e.id);
      if (!old) {
        out.push(`Added ${exerciseLabel(e)} (${e.sets.length} sets)`);
        continue;
      }
      const label = exerciseLabel(e);
      out.push(...fieldLines(`${label}: `, EXERCISE_FIELDS, old, e));
      const oldSets = new Map(old.sets.map((s) => [s.id, s]));
      const newIds = new Set(e.sets.map((s) => s.id));
      for (const s of e.sets) {
        const was = oldSets.get(s.id);
        if (!was) out.push(`${label}: added set ${s.setNumber}`);
        else out.push(...fieldLines(`${label}, set ${was.setNumber}: `, SET_FIELDS, was, s, true));
      }
      for (const s of old.sets) if (!newIds.has(s.id)) out.push(`${label}: removed set ${s.setNumber}`);
    }
    for (const e of prev.exercises) if (!nextEx.has(e.id)) out.push(`Removed ${exerciseLabel(e)}`);
    return out;
  }
  const prev = before && !isProgramSnapshot(before) ? before : null;
  if (!prev) return [`Created "${after.cycle.name}"`];
  const out = fieldLines("", CYCLE_FIELDS, prev.cycle, after.cycle);
  const slotKey = (s: SlotSnap) =>
    s.dayOfWeek != null ? DAYS[Number(s.dayOfWeek)] ?? `Day ${s.dayOfWeek}` : `Day ${s.orderIndex}`;
  const slotText = (s: SlotSnap) => s.label ?? s.programName ?? (s.programId == null ? "rest" : `program ${s.programId}`);
  const prevSlots = new Map(prev.slots.map((s) => [slotKey(s), s]));
  const nextSlots = new Map(after.slots.map((s) => [slotKey(s), s]));
  for (const [key, s] of nextSlots) {
    const old = prevSlots.get(key);
    if (!old) out.push(`${key}: added ${slotText(s)}`);
    else if (
      !sameValue(old.programId, s.programId) ||
      !sameValue(old.label, s.label) ||
      !sameValue(old.autoComplete, s.autoComplete) ||
      !sameValue(old.notes, s.notes)
    ) {
      out.push(`${key}: ${slotText(old)} → ${slotText(s)}`);
    }
  }
  for (const [key, s] of prevSlots) if (!nextSlots.has(key)) out.push(`${key}: removed ${slotText(s)}`);
  return out;
}

// ── Restore (2.5, 2.6, owner decision 1) ─────────────────────────────────────

/** Program fields a restore never writes back. */
export const PROGRAM_KEPT = ["id", "userId", "createdByCycleId", "createdAt"] as const;
/** Exercise slot fields a restore never writes back (progressionConfigAt is recomputed). */
export const EXERCISE_KEPT = ["id", "programId", "weightStack", "progressionConfigAt"] as const;
/** Cycle fields a restore never writes back: identity and lifecycle, and the sync's output. */
export const CYCLE_KEPT = [
  "id",
  "userId",
  "createdAt",
  "status",
  "startDate",
  "lastSyncedWeek",
  "adaptationPct",
  "adaptationNote",
] as const;

const PROGRESSION_FIELDS = ["targetReps", "weightKg", "durationSeconds", "distanceMeters"] as const;

/** Fields of a restored set that the weekly sync owns, so the restore leaves them for the sync. */
export function syncOwnedSetFields(set: Row): string[] {
  const out: string[] = [];
  const peakDistance = set.peakDistanceMeters != null;
  const peakDuration = set.peakDurationSeconds != null;
  if (peakDistance) out.push("distanceMeters");
  if (peakDuration) out.push("durationSeconds");
  if (set.sessionRole === "work" && (peakDistance || peakDuration)) {
    out.push("targetHeartRateZone", "restTimeSeconds");
  }
  return out;
}

function findSet(snap: ProgramSnapshot, setId: number): Row | undefined {
  for (const e of snap.exercises) {
    const s = e.sets.find((x) => x.id === setId);
    if (s) return s;
  }
  return undefined;
}

/**
 * The writer of the last change to a set's field after the restored revision,
 * or null when nobody changed it. `history` is every revision after the target,
 * oldest first.
 */
export function lastWriterOf(
  target: ProgramSnapshot,
  history: { writer: PlanWriter; snapshot: ProgramSnapshot }[],
  setId: number,
  field: string,
): PlanWriter | null {
  let prev = findSet(target, setId)?.[field];
  let last: PlanWriter | null = null;
  for (const h of history) {
    const value = findSet(h.snapshot, setId)?.[field];
    if (!sameValue(prev, value)) last = h.writer;
    prev = value;
  }
  return last;
}

/**
 * The values a restored set gets: the target's, except fields the sync owns
 * and progression numbers whose last change came from progression, which keep
 * the current value.
 */
export function restoredSetValues(
  targetSet: Row,
  currentSet: Row | undefined,
  target: ProgramSnapshot,
  history: { writer: PlanWriter; snapshot: ProgramSnapshot }[],
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...targetSet };
  delete values.id;
  if (!currentSet) return values;
  for (const field of syncOwnedSetFields(targetSet)) values[field] = currentSet[field];
  const syncOwned = new Set(syncOwnedSetFields(targetSet));
  for (const field of PROGRESSION_FIELDS) {
    if (syncOwned.has(field)) continue;
    if (lastWriterOf(target, history, targetSet.id, field) === "progression") values[field] = currentSet[field];
  }
  return values;
}

// ── Queued write conflicts (2.7) ─────────────────────────────────────────────

/**
 * The fields of a queued write that conflict: changed since the base (current
 * differs from base) and not already at the new value. `base` undefined means
 * the base state is unknown, so every field that is not already at the new
 * value conflicts.
 */
export function queuedWriteConflicts(
  base: Record<string, unknown> | undefined,
  current: Record<string, unknown>,
  write: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const [field, next] of Object.entries(write)) {
    if (next === undefined) continue;
    const c = current[field];
    if (sameValue(c, next)) continue;
    if (base && sameValue(c, base[field])) continue;
    out.push(field);
  }
  return out;
}

// ── Change sets (2.8) ────────────────────────────────────────────────────────

/** An assistant write joins its client's last change set within this window. */
export const ASSISTANT_CHANGE_SET_WINDOW_MS = 30 * 60 * 1000;

export function changeSetFor(
  last: { changeSetId: string | null; createdAt: Date } | null,
  now: Date,
  fresh: () => string,
): string {
  if (last?.changeSetId && now.getTime() - last.createdAt.getTime() < ASSISTANT_CHANGE_SET_WINDOW_MS) {
    return last.changeSetId;
  }
  return fresh();
}

// ── Retention (section 9, owner decision 2) ──────────────────────────────────

export const REVISION_RETENTION_DAYS = 365;
export const DELETED_PLAN_RETENTION_DAYS = 90;
