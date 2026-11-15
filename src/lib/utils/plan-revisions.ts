/**
 * Pure rules of the revision layer (docs/plans/revisions.md, section 2): how
 * snapshots compare and read as text, how an MCP set list matches the stored
 * sets, what a restore keeps, and when a queued write conflicts. The database
 * side is src/lib/plan-revisions.ts.
 */

import type { ThresholdKind } from "@/db/schema/athlete-profile";
import type { PlanWriter } from "@/db/schema/plan-revisions";
import { PHASE_TYPE_LABELS, dayLabel, shortDay } from "@/lib/utils/seasons";
import { THRESHOLD_LABEL, formatThreshold } from "@/lib/utils/thresholds";

export type Row = { id: number } & Record<string, unknown>;
export type ExerciseSnap = Row & { exerciseName?: string | null; sets: Row[] };
export type ProgramSnapshot = { v: 1; program: Row; exercises: ExerciseSnap[] };
export type SlotSnap = Row & { programName?: string | null };
export type CycleSnapshot = { v: 1; cycle: Row; slots: SlotSnap[] };
/** A coach memory entry (docs/plans/ai-coach.md, 2.5). */
export type MemorySnapshot = { v: 1; memory: Row };
/** The athlete profile, one threshold value, one injury (docs/plans/athlete-profile.md, 2.2). */
export type AthleteSnapshot = { v: 1; athlete: Row };
export type ThresholdSnapshot = { v: 1; threshold: Row };
export type InjurySnapshot = { v: 1; injury: Row };
/** A library workout and a sick period (docs/plans/workouts-and-compliance.md, 4.5). */
export type WorkoutSnapshot = { v: 1; workout: Row };
export type IllnessSnapshot = { v: 1; illness: Row };
/** The inputs of one race-day plan (docs/plans/nutrition-and-race-day.md, 3). */
export type RacePlanSnapshot = { v: 1; race_plan: Row };
/**
 * A season with its races, and its phases for the history text
 * (docs/plans/seasons.md, 2.3). A restore never moves the phases.
 */
export type PhaseSnap = { cycleId: number; name: string; phaseOrder: number | null; phaseType: string | null };
export type SeasonSnapshot = { v: 1; season: Row; races: Row[]; phases: PhaseSnap[] };
/** One planned (dated) session (docs/plans/sessions.md, 7). */
export type PlannedSessionSnapshot = { v: 1; session: Row; programName: string | null };
export type PlanSnapshot =
  | PlannedSessionSnapshot
  | ProgramSnapshot
  | CycleSnapshot
  | MemorySnapshot
  | AthleteSnapshot
  | ThresholdSnapshot
  | InjurySnapshot
  | WorkoutSnapshot
  | IllnessSnapshot
  | RacePlanSnapshot
  | SeasonSnapshot;

export const isProgramSnapshot = (s: PlanSnapshot): s is ProgramSnapshot => "program" in s;
export const isCycleSnapshot = (s: PlanSnapshot): s is CycleSnapshot => "cycle" in s;
export const isMemorySnapshot = (s: PlanSnapshot): s is MemorySnapshot => "memory" in s;
export const isAthleteSnapshot = (s: PlanSnapshot): s is AthleteSnapshot => "athlete" in s;
export const isThresholdSnapshot = (s: PlanSnapshot): s is ThresholdSnapshot => "threshold" in s;
export const isInjurySnapshot = (s: PlanSnapshot): s is InjurySnapshot => "injury" in s;
export const isWorkoutSnapshot = (s: PlanSnapshot): s is WorkoutSnapshot => "workout" in s && !("session" in s);
export const isIllnessSnapshot = (s: PlanSnapshot): s is IllnessSnapshot => "illness" in s;
export const isRacePlanSnapshot = (s: PlanSnapshot): s is RacePlanSnapshot => "race_plan" in s;

const illnessDates = (r: Row) => `${r.startedOn} to ${r.endedOn ?? "now"}`;

const INJURY_AREA_TEXT = (area: unknown) => String(area ?? "other").replace("_", " ");
export const isSeasonSnapshot = (s: PlanSnapshot): s is SeasonSnapshot => "season" in s;
export const isPlannedSessionSnapshot = (s: PlanSnapshot): s is PlannedSessionSnapshot => "session" in s;

// A rotation override names no number: its rotationPosition counts every
// session of the block, while the session sheet numbers the slots ("position
// 2 of 5"), and the slot count is not in the snapshot.
const sessionWhat = (s: PlannedSessionSnapshot) => s.session.label ?? s.programName ?? "Session";
const sessionTitle = (s: PlannedSessionSnapshot) => {
  const what = sessionWhat(s);
  return s.session.date ? `${what} on ${shortDay(String(s.session.date))}` : `${what} in the rotation`;
};

/**
 * One change to a dated session on its cycle's history, joined to the session
 * it is about ("Squat day on Wed 4 Nov, moved from ..."). A skip names it
 * after the verb, with its reason last ("Skipped Long ride on Sun 22 Nov (Work
 * trip)"). A move names it itself ("Moved Long ride from Sun 22 Nov to Sat 21
 * Nov"). A line that names the session already stays as it is.
 */
export function sessionChangeLine(name: string, change: string): string {
  if (change.startsWith(`Added ${name}`) || change.startsWith(`Skipped ${name}`) || change.startsWith("Moved ")) return change;
  if (change === "Skipped" || change.startsWith("Skipped (")) return `Skipped ${name}${change.slice("Skipped".length)}`;
  return `${name}, ${change.charAt(0).toLowerCase()}${change.slice(1)}`;
}

/** The name an object goes by in the history and the AI changes feed. */
export function snapshotName(s: PlanSnapshot): string {
  if (isPlannedSessionSnapshot(s)) return sessionTitle(s);
  if (isProgramSnapshot(s)) return String(s.program.name);
  if (isCycleSnapshot(s)) return String(s.cycle.name);
  if (isAthleteSnapshot(s)) return "Athlete profile";
  if (isThresholdSnapshot(s)) return THRESHOLD_LABEL[s.threshold.kind as ThresholdKind] ?? "Threshold";
  if (isInjurySnapshot(s)) {
    const side = s.injury.side ? `${s.injury.side} ` : "";
    return `Injury: ${side}${INJURY_AREA_TEXT(s.injury.area)}`;
  }
  if (isSeasonSnapshot(s)) return String(s.season.name);
  if (isWorkoutSnapshot(s)) return `Workout: ${String(s.workout.name)}`;
  if (isIllnessSnapshot(s)) return `Sick period from ${String(s.illness.startedOn)}`;
  if (isRacePlanSnapshot(s)) return "Race plan";
  const text = String(s.memory.text);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

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

/** A Plan field on the history page: its label, and how a value reads (plain text when absent). */
type PlanField = { label: string; value?: (v: unknown) => string };

const date: PlanField["value"] = (v) => dayLabel(String(v));
const weeks: PlanField["value"] = (v) => `${v} week${Number(v) === 1 ? "" : "s"}`;
const days: PlanField["value"] = (v) => `${v} day${Number(v) === 1 ? "" : "s"}`;

// The words of the cycle setup form (src/components/features/CreateCycleForm.tsx).
const SCHEDULE_TEXT: Record<string, string> = { day_of_week: "Same days each week", rotation: "Rotation" };
const END_TEXT: Record<string, string> = { none: "Just stop", deload: "Deload week", new_cycle: "Start a new cycle", rest: "Rest period" };
const RACE_DISTANCE_TEXT: Record<string, string> = { full: "Ironman", half: "70.3" };

const CYCLE_FIELDS: Record<string, PlanField> = {
  name: { label: "Name" },
  durationWeeks: { label: "Length", value: weeks },
  scheduleType: { label: "Schedule", value: (v) => SCHEDULE_TEXT[String(v)] ?? String(v) },
  goal: { label: "Goal" },
  athleteLevel: { label: "Level" },
  raceDate: { label: "Race date", value: date },
  raceDistance: { label: "Race distance", value: (v) => RACE_DISTANCE_TEXT[String(v)] ?? String(v) },
  status: { label: "Status" },
  startDate: { label: "Start date", value: date },
  endAction: { label: "When it ends", value: (v) => END_TEXT[String(v)] ?? String(v) },
  endMessage: { label: "Note to future self" },
  adaptationPct: { label: "Volume adjustment", value: (v) => `${v}%` },
  scheduledStartDate: { label: "Scheduled start", value: date },
  durationDays: { label: "Length in days", value: days },
  phaseOrder: { label: "Phase position" },
  phaseType: { label: "Phase type", value: (v) => phaseTypeText(String(v)) ?? "" },
};

const SEASON_FIELDS: Record<string, PlanField> = {
  name: { label: "Name" },
  goal: { label: "Goal" },
  startDate: { label: "Start", value: date },
  endDate: { label: "End", value: date },
  nextGoal: { label: "Next goal" },
};

const RACE_FIELDS: Record<string, PlanField> = {
  name: { label: "name" },
  raceDate: { label: "date", value: date },
  discipline: { label: "kind" },
  distance: { label: "distance" },
  distanceMeters: { label: "distance in metres" },
  priority: { label: "priority" },
};

/** One value change as a sentence: "Label set to X", "Label cleared" or "Label changed from X to Y". */
function changeLine(what: string, from: unknown, to: unknown): string {
  const none = (v: unknown) => v == null || v === "";
  if (none(from)) return `${what} set to ${to}`;
  if (none(to)) return `${what} cleared`;
  return `${what} changed from ${from} to ${to}`;
}

const phaseTypeText = (v: string | null) => (v == null ? null : (PHASE_TYPE_LABELS[v as keyof typeof PHASE_TYPE_LABELS] ?? v));

/**
 * Plan field changes as sentences, with no colon ("Start date set to 31 Oct
 * 2026", "Length changed from 8 weeks to 10 weeks"). `prefix` names the part a
 * field belongs to ('Race "Haugesund" date changed ...').
 */
function planFieldLines(prefix: string, fields: Record<string, PlanField>, before: Row, after: Row): string[] {
  const out: string[] = [];
  for (const [field, { label, value }] of Object.entries(fields)) {
    if (sameValue(before[field], after[field])) continue;
    const what = `${prefix}${label}`;
    if (field === "endMessage") {
      out.push(`${what} changed`);
      continue;
    }
    const text = (v: unknown) => (v == null || v === "" ? null : value ? value(v) : String(v));
    out.push(changeLine(what, text(before[field]), text(after[field])));
  }
  return out;
}

const MEMORY_FIELDS: Record<string, string> = {
  kind: "kind",
  entryDate: "date",
  active: "in use",
};

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ATHLETE_FIELDS: Record<string, string> = {
  enduranceLevel: "Experience",
  availableDays: "Days",
  hoursPerWeek: "Hours a week",
  longestDayMinutes: "Longest day",
  longDay: "Long day",
  strengthGoal: "Strength goal",
  interviewCompletedAt: "Interview",
};

function athleteValue(field: string, v: unknown): string {
  if (v == null) return "none";
  if (field === "availableDays" && Array.isArray(v)) return v.length ? v.map((d) => DAYS[Number(d)] ?? d).join(" ") : "none";
  if (field === "longDay") return DAYS[Number(v)] ?? String(v);
  if (field === "longestDayMinutes") return `${Math.floor(Number(v) / 60)}:${String(Number(v) % 60).padStart(2, "0")} h`;
  if (field === "hoursPerWeek") return `${Number(v)} h`;
  if (field === "strengthGoal") return String(v).replace("_", " ");
  if (field === "interviewCompletedAt") return "finished";
  return String(v);
}

const INJURY_FIELDS: Record<string, string> = {
  area: "area",
  side: "side",
  status: "status",
  startedOn: "since",
  endedOn: "until",
};

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
  if (isPlannedSessionSnapshot(after)) {
    const prev = before && isPlannedSessionSnapshot(before) ? before : null;
    const a = after.session;
    if (!prev) return [a.status === "skipped" ? `Skipped ${sessionTitle(after)}` : `Added ${sessionTitle(after)}`];
    const b = prev.session;
    const out: string[] = [];
    const moved = !sameValue(b.date, a.date);
    if (moved) out.push(`Moved ${sessionWhat(after)} from ${shortDay(String(b.date))} to ${shortDay(String(a.date))}`);
    if (!sameValue(b.position, a.position) && sameValue(b.date, a.date)) out.push(changeLine("Order in the day", b.position, a.position));
    if (!sameValue(b.programId, a.programId)) out.push(changeLine("Program", prev.programName, after.programName));
    if (!sameValue(b.label ?? null, a.label ?? null)) out.push(changeLine("Label", b.label, a.label));
    if (!sameValue(b.notes ?? null, a.notes ?? null)) out.push("Notes changed");
    if (canonical(b.workout ?? null) !== canonical(a.workout ?? null)) {
      const name = (w: unknown) => (w && typeof w === "object" ? String((w as { name?: unknown }).name ?? "workout") : null);
      out.push(a.workout == null ? `Workout ${name(b.workout)} cleared` : b.workout == null ? `Workout set to ${name(a.workout)}` : `Workout changed from ${name(b.workout)} to ${name(a.workout)}`);
    }
    if (!sameValue(b.priority ?? null, a.priority ?? null)) out.push(changeLine("Priority", b.priority ?? "default", a.priority ?? "default"));
    if (!sameValue(b.brickParentId ?? null, a.brickParentId ?? null)) out.push(a.brickParentId == null ? "Brick unlinked" : "Linked as a brick");
    if (!sameValue(b.garminActivityId ?? null, a.garminActivityId ?? null)) out.push(a.garminActivityId == null ? "Garmin activity unlinked" : "Garmin activity picked");
    // A missed session moved to a coming day is planned again by the move: one change, one line (J8-04).
    if (!sameValue(b.status, a.status) && !(moved && b.status === "missed" && a.status === "planned")) {
      out.push(
        a.status === "skipped"
          ? `Skipped${a.skipReason ? ` (${a.skipReason})` : ""}`
          : a.status === "missed"
            ? `Confirmed missed${a.missedReason ? ` (${a.missedReason})` : ""}`
            : "Planned again",
      );
    }
    if (!sameValue(b.touchedAt ?? null, a.touchedAt ?? null) && a.touchedAt == null) out.push("Back to the template");
    if (!sameValue(b.deletedAt ?? null, a.deletedAt ?? null)) out.push(a.deletedAt ? "Removed" : "Restored");
    return out;
  }
  if (isAthleteSnapshot(after)) {
    const prev = before && isAthleteSnapshot(before) ? before.athlete : null;
    const out: string[] = [];
    for (const [field, label] of Object.entries(ATHLETE_FIELDS)) {
      const a = athleteValue(field, after.athlete[field]);
      if (!prev) {
        if (after.athlete[field] != null) out.push(`${label}: ${a}`);
        continue;
      }
      const b = athleteValue(field, prev[field]);
      if (a !== b) out.push(`${label} ${b} → ${a}`);
    }
    if (prev && !sameValue(prev.deletedAt ?? null, after.athlete.deletedAt ?? null)) {
      out.push(after.athlete.deletedAt ? "Cleared" : "Restored");
    }
    return prev || out.length ? out : ["Created the athlete profile"];
  }
  if (isThresholdSnapshot(after)) {
    const t = after.threshold;
    const kind = t.kind as ThresholdKind;
    const text = (r: Row) => `${formatThreshold(kind, Number(r.value))} on ${r.measuredOn}`;
    const prev = before && isThresholdSnapshot(before) ? before.threshold : null;
    if (!prev) return [`Added ${THRESHOLD_LABEL[kind]} ${text(t)} (${t.source})`];
    const out: string[] = [];
    if (!sameValue(prev.value, t.value) || !sameValue(prev.measuredOn, t.measuredOn)) out.push(`${text(prev)} → ${text(t)}`);
    if (!sameValue(prev.source, t.source)) out.push(`source ${prev.source} → ${t.source}`);
    if (!sameValue(prev.notes ?? null, t.notes ?? null)) out.push("notes changed");
    if (!sameValue(prev.deletedAt ?? null, t.deletedAt ?? null)) out.push(t.deletedAt ? "Deleted" : "Restored");
    return out;
  }
  if (isInjurySnapshot(after)) {
    const prev = before && isInjurySnapshot(before) ? before.injury : null;
    if (!prev) return [`Added ${snapshotName(after).toLowerCase()} (${after.injury.status})`];
    const out = fieldLines("", INJURY_FIELDS, prev, after.injury);
    if (!sameValue(prev.description, after.injury.description)) out.push("description changed");
    if (!sameValue(prev.avoid ?? null, after.injury.avoid ?? null)) out.push("what to avoid changed");
    if (!sameValue(prev.deletedAt ?? null, after.injury.deletedAt ?? null)) out.push(after.injury.deletedAt ? "Deleted" : "Restored");
    return out;
  }
  if (isWorkoutSnapshot(after)) {
    const prev = before && isWorkoutSnapshot(before) ? before.workout : null;
    const a = after.workout;
    if (!prev) return [`Added workout "${a.name}"`];
    const out: string[] = [];
    if (!sameValue(prev.name, a.name)) out.push(`Name ${prev.name} → ${a.name}`);
    if (canonical(prev.workout) !== canonical(a.workout)) out.push("Steps changed");
    if (!sameValue(prev.priority ?? null, a.priority ?? null)) out.push(`Priority ${prev.priority ?? "default"} → ${a.priority ?? "default"}`);
    if (!sameValue(prev.deletedAt ?? null, a.deletedAt ?? null)) out.push(a.deletedAt ? "Deleted" : "Restored");
    return out;
  }
  if (isIllnessSnapshot(after)) {
    const prev = before && isIllnessSnapshot(before) ? before.illness : null;
    const a = after.illness;
    if (!prev) return [`Sick period ${illnessDates(a)}`];
    const out: string[] = [];
    if (!sameValue(prev.startedOn, a.startedOn) || !sameValue(prev.endedOn ?? null, a.endedOn ?? null)) out.push(`Sick period ${illnessDates(prev)} → ${illnessDates(a)}`);
    if (!sameValue(prev.severity ?? null, a.severity ?? null)) out.push(`Severity ${prev.severity ?? "not given"} → ${a.severity ?? "not given"}`);
    if (!sameValue(prev.notes ?? null, a.notes ?? null)) out.push("notes changed");
    if (!sameValue(prev.deletedAt ?? null, a.deletedAt ?? null)) out.push(a.deletedAt ? "Deleted" : "Restored");
    return out;
  }
  if (isRacePlanSnapshot(after)) {
    const prev = before && isRacePlanSnapshot(before) ? before.race_plan : null;
    const a = after.race_plan;
    if (!prev) return ["Created the race plan"];
    const out: string[] = [];
    const was = (prev.plan ?? {}) as Record<string, unknown>;
    const now = (a.plan ?? {}) as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
      if (!sameValue(was[k] ?? null, now[k] ?? null)) out.push(`${k} ${was[k] ?? "not set"} → ${now[k] ?? "not set"}`);
    }
    if (!sameValue(prev.deletedAt ?? null, a.deletedAt ?? null)) out.push(a.deletedAt ? "Deleted" : "Restored");
    return out;
  }
  if (isSeasonSnapshot(after)) {
    const prev = before && isSeasonSnapshot(before) ? before : null;
    if (!prev) return [`Created season "${after.season.name}"`];
    const out = planFieldLines("", SEASON_FIELDS, prev.season, after.season);
    if (!sameValue(prev.season.replanFlaggedAt ?? null, after.season.replanFlaggedAt ?? null)) {
      out.push(after.season.replanFlaggedAt ? after.season.replanReason ? `Flagged for a re-plan (${after.season.replanReason})` : "Flagged for a re-plan" : "Marked as re-planned");
    }
    const prevRaces = new Map(prev.races.map((r) => [r.id, r]));
    const nextIds = new Set(after.races.map((r) => r.id));
    for (const r of after.races) {
      const old = prevRaces.get(r.id);
      if (!old) out.push(`Added ${r.priority} race "${r.name}" on ${dayLabel(String(r.raceDate))}`);
      else out.push(...planFieldLines(`Race "${old.name}" `, RACE_FIELDS, old, r));
    }
    for (const r of prev.races) if (!nextIds.has(r.id)) out.push(`Removed race "${r.name}"`);
    const prevPhases = new Map(prev.phases.map((p) => [p.cycleId, p]));
    const nextPhaseIds = new Set(after.phases.map((p) => p.cycleId));
    for (const p of after.phases) {
      const old = prevPhases.get(p.cycleId);
      if (!old) out.push(`Phase "${p.name}" added`);
      else {
        if (old.phaseOrder !== p.phaseOrder) out.push(`Phase "${p.name}" moved from position ${old.phaseOrder} to ${p.phaseOrder}`);
        if (old.phaseType !== p.phaseType) out.push(changeLine(`Phase "${p.name}" type`, phaseTypeText(old.phaseType), phaseTypeText(p.phaseType)));
      }
    }
    for (const p of prev.phases) if (!nextPhaseIds.has(p.cycleId)) out.push(`Phase "${p.name}" removed`);
    return out;
  }
  if (isMemorySnapshot(after)) {
    const prev = before && isMemorySnapshot(before) ? before : null;
    if (!prev) return [`Added ${after.memory.kind} "${snapshotName(after)}"`];
    const out = fieldLines("", MEMORY_FIELDS, prev.memory, after.memory);
    if (!sameValue(prev.memory.text, after.memory.text)) out.push(`Text "${snapshotName(prev)}" → "${snapshotName(after)}"`);
    if (!sameValue(prev.memory.deletedAt ?? null, after.memory.deletedAt ?? null)) {
      out.push(after.memory.deletedAt ? "Deleted" : "Restored");
    }
    return out;
  }
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
      out.push(...fieldLines(`${label}, `, EXERCISE_FIELDS, old, e));
      const oldSets = new Map(old.sets.map((s) => [s.id, s]));
      const newIds = new Set(e.sets.map((s) => s.id));
      for (const s of e.sets) {
        const was = oldSets.get(s.id);
        if (!was) out.push(`${label}, added set ${s.setNumber}`);
        else out.push(...fieldLines(`${label}, set ${was.setNumber}, `, SET_FIELDS, was, s, true));
      }
      for (const s of old.sets) if (!newIds.has(s.id)) out.push(`${label}, removed set ${s.setNumber}`);
    }
    for (const e of prev.exercises) if (!nextEx.has(e.id)) out.push(`Removed ${exerciseLabel(e)}`);
    return out;
  }
  const prev = before && isCycleSnapshot(before) ? before : null;
  if (!prev) return [`Created "${after.cycle.name}"`];
  const out = planFieldLines("", CYCLE_FIELDS, prev.cycle, after.cycle);
  if (!sameValue(prev.cycle.seasonId, after.cycle.seasonId)) {
    out.push(prev.cycle.seasonId == null ? "Added to a season" : after.cycle.seasonId == null ? "Taken out of its season" : "Moved to another season");
  }
  // Slots match on their day (a day's second and third sessions by number,
  // docs/plans/sessions.md, 3.1) or their order index.
  const slotKey = (s: SlotSnap) => (s.dayOfWeek != null ? `d${s.dayOfWeek}.${s.daySlot ?? 1}` : `o${s.orderIndex}`);
  // Where a slot is, in words. A rotation slot shows its place from 1, as the
  // session sheet does: order indexes may start at 0 or have gaps.
  const placeIn = (slots: SlotSnap[]) => {
    const order = slots.filter((s) => s.dayOfWeek == null).sort((a, b) => Number(a.orderIndex ?? 0) - Number(b.orderIndex ?? 0));
    return (s: SlotSnap) =>
      s.dayOfWeek != null
        ? `${DAYS[Number(s.dayOfWeek)] ?? `day ${s.dayOfWeek}`}${Number(s.daySlot ?? 1) > 1 ? `, session ${s.daySlot}` : ""}`
        : `position ${order.indexOf(s) + 1}`;
  };
  const placeBefore = placeIn(prev.slots);
  const placeAfter = placeIn(after.slots);
  const onOrAt = (s: SlotSnap, place: string) => (s.dayOfWeek != null ? `on ${place}` : `at ${place}`);
  const slotText = (s: SlotSnap) => s.label ?? s.programName ?? (s.programId == null ? "rest" : `program ${s.programId}`);
  const prevSlots = new Map(prev.slots.map((s) => [slotKey(s), s]));
  const nextSlots = new Map(after.slots.map((s) => [slotKey(s), s]));
  for (const [key, s] of nextSlots) {
    const old = prevSlots.get(key);
    const place = placeAfter(s);
    if (!old) out.push(`Added ${slotText(s)} ${onOrAt(s, place)}`);
    else if (
      !sameValue(old.programId, s.programId) ||
      !sameValue(old.label, s.label) ||
      !sameValue(old.autoComplete, s.autoComplete) ||
      !sameValue(old.notes, s.notes)
    ) {
      out.push(
        slotText(old) === slotText(s)
          ? `${slotText(s)} ${onOrAt(s, place)} changed`
          : `${place.charAt(0).toUpperCase()}${place.slice(1)} changed from ${slotText(old)} to ${slotText(s)}`,
      );
    }
  }
  for (const [key, s] of prevSlots) if (!nextSlots.has(key)) out.push(`Removed ${slotText(s)} from ${placeBefore(s)}`);
  return out;
}

// ── Restore (2.5, 2.6, owner decision 1) ─────────────────────────────────────

/** Planned session fields a restore never writes back: identity and where the template put it. */
export const PLANNED_SESSION_KEPT = [
  "id",
  "userId",
  "cycleId",
  "slotId",
  "templateDate",
  "rotationPosition",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;
/** Memory fields a restore never writes back. */
export const MEMORY_KEPT = ["id", "userId", "createdAt", "updatedAt", "deletedAt"] as const;
/** Fields a restore of a one-row object (athlete profile, threshold, injury) never writes back. */
/** `orphanedAt` (race plans) follows the race, never a revision. */
export const ROW_KEPT = [...MEMORY_KEPT, "orphanedAt"] as const;
/** Season fields a restore never writes back (the re-plan flag is recomputed). */
export const SEASON_KEPT = ["id", "userId", "createdAt", "updatedAt", "deletedAt", "replanFlaggedAt", "replanReason", "replanRaceIds"] as const;
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
  "scheduledStartDate",
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

/**
 * What happened to one set after the workout's base revision, by whom: the
 * last writer of each field, and who removed the set if it is gone. A
 * conflict is only another writer's change. The lifter's own writes during the
 * workout (a carried weight, a target changed in the set editor, a deleted
 * set) and the engine's are the lifter's plan, not someone else's
 * (docs/plans/revisions.md, 2.7).
 */
export function setChangesSince(
  base: ProgramSnapshot,
  history: { writer: PlanWriter; snapshot: ProgramSnapshot }[],
  setId: number,
  fields: string[],
): { lastWriter: Record<string, PlanWriter>; removedBy: PlanWriter | null } {
  let prev = findSet(base, setId);
  const lastWriter: Record<string, PlanWriter> = {};
  let removedBy: PlanWriter | null = null;
  for (const h of history) {
    const cur = findSet(h.snapshot, setId);
    if (prev && !cur) removedBy = h.writer;
    if (!prev && cur) removedBy = null;
    if (prev && cur) {
      for (const f of fields) if (!sameValue(prev[f], cur[f])) lastWriter[f] = h.writer;
    }
    prev = cur;
  }
  return { lastWriter, removedBy };
}

/** Writers whose change to a field the workout's flush must not overwrite. */
export const OTHER_WRITERS: ReadonlySet<PlanWriter> = new Set(["assistant"]);

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
