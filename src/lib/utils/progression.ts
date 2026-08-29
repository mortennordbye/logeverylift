/**
 * Progressive Overload Utilities
 *
 * Pure functions for calculating progressive overload suggestions.
 * No database calls — receives pre-fetched data and returns suggestions.
 *
 * Extracted from getProgressiveSuggestions for testability and reuse.
 */

import { rirFromRpe } from "@/lib/utils/rir";
import type { SetSuggestion } from "@/types/workout";

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Number of recent sessions to consider when evaluating progression readiness.
 * The "window" we look back through, per exercise slot — sessions, not rows for
 * one set number. Enforced by the history query; buildSuggestion judges whatever
 * window it is handed.
 */
export const CONSENSUS_WINDOW = 5;

/**
 * Default number of target-meeting sessions required within CONSENSUS_WINDOW to
 * trigger a weight/rep progression. Prevents one-lucky-session advances.
 *
 * Per-exercise override: programExercises.progressionRequiredHits. Null there
 * means "use this constant", so the default lives in exactly one place.
 */
export const REQUIRED_HITS = 2;

/** Bounds for the per-exercise hit-count override. */
export const MIN_REQUIRED_HITS = 1;
export const MAX_REQUIRED_HITS = CONSENSUS_WINDOW;

/**
 * Number of consecutive session failures required to trigger a deload suggestion.
 * All DELOAD_THRESHOLD most-recent sessions must have missed the target.
 */
export const DELOAD_THRESHOLD = 3;

/**
 * Fraction to reduce weight by when a deload is detected (10% reduction).
 *
 * Per-exercise override: programExercises.progressionBackoffPct, expressed as
 * whole percent. DELOAD_PCT is the same number in the units that column uses,
 * so the shared default lives in one place rather than two that can drift.
 */
export const DELOAD_FACTOR = 0.9;
export const DELOAD_PCT = 10;

/** Bounds for the per-exercise back-off controls. */
export const MIN_BACKOFF_PCT = 5;
export const MAX_BACKOFF_PCT = 25;
export const MIN_BACKOFF_AFTER = 1;
export const MAX_BACKOFF_AFTER = CONSENSUS_WINDOW;


// ─── Input types ────────────────────────────────────────────────────────────

/**
 * Which sets have to clear before the *session* counts toward the gate.
 *
 *   all   — every working set the plan prescribed
 *   first — the first working set (a top set driving its back-offs)
 *   last  — the last working set
 *   set   — each set banks its own count, judged alone
 *
 * Stored on programExercises.progressionScope, defaulting to "all".
 */
export type ProgressionScope = "all" | "first" | "last" | "set";

export const PROGRESSION_SCOPES = ["all", "first", "last", "set"] as const;

/** Narrow an unvalidated column value to a scope, falling back to the default. */
export function toScope(value: string | null | undefined): ProgressionScope {
  return (PROGRESSION_SCOPES as readonly string[]).includes(value ?? "")
    ? (value as ProgressionScope)
    : "all";
}

/**
 * What moves when the gate is met — axis 6, and the axis that replaced
 * `progressionMode`. The mode mixed this question ("which dimension moves")
 * with "what scheme is running", so the app could not tell a fixed 12 reps
 * apart from a 6-8 range even though they are different programmes.
 *
 *   none     — no suggestions at all
 *   manual   — proposes nothing, still reports what you did last time
 *   load     — add kg
 *   reps     — add reps at the same load
 *   double   — climb the reps inside the range, then convert them into load
 *   duration — add seconds
 *   distance — add metres
 *
 * `manual` is on this axis and not in the plan's section 5 list. It has to be:
 * Manual and Off differ only in whether the last session's numbers are shown,
 * and no other column carries that difference.
 */
export type ProgressionAdvance =
  | "none"
  | "manual"
  | "load"
  | "reps"
  | "double"
  | "duration"
  | "distance";

export const PROGRESSION_ADVANCES = [
  "none",
  "manual",
  "load",
  "reps",
  "double",
  "duration",
  "distance",
] as const;

/** Narrow an unvalidated column value to an advance, falling back to manual. */
export function toAdvance(value: string | null | undefined): ProgressionAdvance {
  return (PROGRESSION_ADVANCES as readonly string[]).includes(value ?? "")
    ? (value as ProgressionAdvance)
    : "manual";
}

/** What happens when the gate keeps not being met — axis 7. */
export type ProgressionRegress = "hold" | "backoff";

export const PROGRESSION_REGRESSES = ["hold", "backoff"] as const;

export function toRegress(value: string | null | undefined): ProgressionRegress {
  return value === "hold" ? "hold" : "backoff";
}

/** What a low pre-workout readiness score does to a suggestion — axis 8. */
export type ProgressionReadiness = "ignore" | "hold" | "reduce";

export const PROGRESSION_READINESSES = ["ignore", "hold", "reduce"] as const;

export function toReadiness(
  value: string | null | undefined,
): ProgressionReadiness {
  return (PROGRESSION_READINESSES as readonly string[]).includes(value ?? "")
    ? (value as ProgressionReadiness)
    : "hold";
}

/**
 * Effective reps in reserve for a logged set, or null when the lifter reported
 * nothing.
 *
 * `rir` is what the app logs today; `rpe` is the derived twin kept for rows
 * that predate it. Both null means silence, which is *not* an effort value —
 * reading it as one is the bug phase 1 removed, and an effort cap is precisely
 * the setting that must not do it.
 */
export function loggedRir(set: LoggedSet): number | null {
  if (set.rir != null) return set.rir;
  if (set.rpe != null) return rirFromRpe(set.rpe);
  return null;
}

/**
 * A single logged working set, as one session recorded it.
 * Matches what the DB returns from workoutSets for one plan slot.
 */
export type LoggedSet = {
  setNumber: number;
  actualReps: number;
  targetReps: number | null;
  weightKg: string; // decimal returned as string from Drizzle
  durationSeconds: number | null;
  distanceMeters?: number | null;
  /** Logged effort, or null when the lifter did not report any. */
  rpe: number | null;
  /**
   * Reps left in reserve, as logged. Null when nothing was reported — and the
   * derived `rpe` is then null too. What an effort cap is compared against.
   */
  rir?: number | null;
  /** Lifter marked the set easy — see easyOverride in buildSuggestion. */
  wasEasy?: boolean | null;
};

/**
 * One completed session's work on one exercise slot.
 *
 * The window is a list of these, newest first. It used to be a flat list of
 * rows for a single exerciseId + setNumber, which meant every set of a 4x12
 * banked its own progress and the plan could ratchet apart. "Did the workout
 * clear?" is a question about a session, so a session is the unit.
 */
export type SessionHistory = {
  date: string;
  /** Session feeling. "Tired" softens a miss to unknown — see A6 in the plan. */
  feeling: string | null;
  /** Working sets logged against this slot, ordered by set number. */
  sets: LoggedSet[];
  /**
   * Working sets the plan prescribed for this slot when they were logged,
   * snapshotted per row. A skipped set leaves no row at all, so without this a
   * session that logged 3 of a prescribed 4 is indistinguishable from one that
   * was only ever prescribed 3. Null on rows the phase 0 backfill could not
   * resolve, in which case the count is not checked.
   */
  prescribedWorkingSets: number | null;
};

/** How one session in the window came out. */
export type SessionStatus = "cleared" | "missed" | "unknown";

export type SessionOutcome = {
  date: string;
  status: SessionStatus;
  /**
   * Reps short on the worst deciding set. Only set on a rep-judged miss —
   * duration and distance sets carry no logged target to measure against.
   */
  shortfall?: number;
  /** Working sets logged for this slot in this session. */
  loggedSets: number;
  /** Working sets the plan prescribed at the time. Null when unknown. */
  prescribedSets: number | null;
  /** Session feeling, so the dot detail view can say why a session is inert. */
  feeling: string | null;
  /** Heaviest deciding set. SI-11 compares this against the current load. */
  loadKg: number;
  /** Lowest rep count across the deciding sets — the binding one. */
  minReps: number;
  /** A deciding set carried the lifter's explicit "that was easy" (E-6). */
  wasEasy: boolean;
  /**
   * The targets were met but the effort cap was not: the lifter ground it out
   * with less in reserve than they asked to keep. A real miss, and the only
   * kind the engine can see that has nothing to do with reps.
   */
  effortShort?: boolean;
  /**
   * Why an unknown session is unknown, so the chip can say which.
   *   partial      — fewer working sets logged than the plan prescribed (D-9)
   *   effort       — a cap is prescribed and the deciding set reported none (D-2)
   *   tired        — it fell short on a session the lifter marked Tired (A6)
   *   reconfigured — it predates the last change to the judging rules (E-13)
   */
  unknownReason?: "partial" | "effort" | "tired" | "reconfigured";
};

/**
 * Program set data merged with its parent program exercise settings.
 * Shaped for buildSuggestion input.
 */
export type ProgramSetData = {
  programSetId: number;
  setNumber: number;
  targetReps: number | null;
  durationSeconds: number | null;
  distanceMeters?: number | null;
  exerciseId: number;
  overloadIncrementKg: string | null;
  overloadIncrementReps: number | null;
  /** Axis 6. Null/undefined = "manual". Replaced progressionMode. */
  advance?: string | null;
  /** Axis 7. Null/undefined = "backoff". */
  regress?: string | null;
  /** How far a back-off cuts, in percent. Null/undefined = DELOAD_PCT. */
  backoffPct?: number | null;
  /** Consecutive non-clearing sessions before it fires. Null = DELOAD_THRESHOLD. */
  backoffAfter?: number | null;
  /** Axis 8. Null/undefined = "hold". */
  readiness?: string | null;
  /** "working" | "warmup" — non-working sets get no progression suggestions. */
  setType?: string | null;
  /** Exercise movement pattern — used for adaptive increment sizing. Optional for backwards compatibility. */
  movementPattern?: string | null;
  /** Resolved exercise type (program override ?? exercise default) — refines increment sizing. */
  exerciseType?: string | null;
  /** Exercise name — optional, passed through to the suggestion for insight bucketing. */
  exerciseName?: string;
  /** Per-exercise override of REQUIRED_HITS. Null/undefined = use the constant. */
  requiredHits?: number | null;
  /** Which sets decide whether a session cleared. Null/undefined = "all". */
  scope?: string | null;
  /** Bottom of the rep range. Null/undefined = fixed target, no range. */
  repRangeMin?: number | null;
  /** Top of the rep range. Null/undefined = fixed target, no range. */
  repRangeMax?: number | null;
  /**
   * The prescribed reps-in-reserve floor that decides clearing for this slot —
   * axis 3, already resolved against the scope by the caller (D-8: the set
   * that decides clearing also decides effort, so under scope "all" this is
   * the *last* working set's cap, not this set's). Null = no cap, and the
   * exercise clears on target alone.
   *
   * Named a cap in the UI and the column, but it tests `logged RIR >= this`,
   * so it is a minimum reserve. Do not implement it as a ceiling.
   */
  effortCap?: number | null;
  /**
   * The cycle's peak anchor for this set. When either is present the cycle
   * rewrites that column weekly from the anchor, so progression must never
   * write it: an anchored set is never an advance target (A5).
   */
  peakDurationSeconds?: number | null;
  peakDistanceMeters?: number | null;
  /**
   * When the judging rules last changed, as an ISO date. Sessions logged
   * before it are inert: they were judged under a rule that no longer applies,
   * so counting them would move the dots the moment a lifter touches a setting
   * and nothing they did would explain it (E-13).
   *
   * Inert, not *dropped*. Dropping them empties the window on the first
   * settings change, and an empty window returns no suggestion at all — no
   * chip, no dots, and no "Last: 80kg" either. The lifter would lose the
   * information as a side effect of asking a question about it.
   */
  configChangedAt?: string | null;
};

/**
 * Relevant user profile fields for default increment calculation.
 * Null values mean the user has not set a profile.
 */
export type UserProfile = {
  experienceLevel: string | null;
  goal: string | null;
};

// ─── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Epley 1RM estimation formula.
 * Accurate for 2–12 reps; unreliable above 12. Caller must guard weight > 0.
 */
export function estimate1RM(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

/**
 * Round a value to the nearest multiple of increment.
 * Returns value unchanged when increment is 0.
 */
export function roundToNearest(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.round(value / increment) * increment;
}

/**
 * Compute the effective kg increment using load-zone scaling.
 *
 * Priority:
 *  1. User-configured increment (non-null) — always respected
 *  2. goal=endurance — 1kg regardless of load
 *  3. experienceLevel profile override (beginner=5kg, advanced=1.25kg)
 *  4. Load-zone scaling by movement pattern + current weight
 *
 * Compound movements: squat, hinge (deadlift), push (bench/OHP), pull (rows/pullups)
 */
export function adaptiveIncrementKg(
  storedIncrement: number | null,
  currentWeightKg: number,
  movementPattern: string | null | undefined,
  goal: string | null | undefined,
  experienceLevel?: string | null,
  exerciseType?: string | null,
): number {
  // User has an explicit increment — always respect it
  if (storedIncrement !== null) return storedIncrement;

  // Endurance goal prioritizes small, precise increments regardless of load
  if (goal === "endurance") return 1.0;

  // Profile-based overrides (preserve existing behavior for users with set profiles)
  if (experienceLevel === "beginner") return 5.0;
  if (experienceLevel === "advanced") return 1.25;

  // Prefer the explicit exercise type when set (only "compound" gets large jumps);
  // fall back to the movement-pattern heuristic for unclassified exercises.
  const isCompound =
    exerciseType != null
      ? exerciseType === "compound"
      : ["squat", "hinge", "push", "pull"].includes(movementPattern ?? "");

  // Load-zone increments for users without an experience level set:
  //   < 30kg   — small loads; isolation: 1kg, compound: 2.5kg
  //   30–60kg  — moderate; isolation: 1.25kg, compound: 2.5kg
  //   60–100kg — standard: 2.5kg for both
  //   > 100kg  — heavy; compound: 5kg, isolation stays 2.5kg
  if (currentWeightKg < 30) return isCompound ? 2.5 : 1.0;
  if (currentWeightKg < 60) return isCompound ? 2.5 : 1.25;
  if (currentWeightKg < 100) return 2.5;
  return isCompound ? 5.0 : 2.5;
}

// ─── Clearing a set ─────────────────────────────────────────────────────────

/**
 * Did the set reach its rep target?
 *
 * This is the whole test. There used to be a second gate on top of it — an
 * absolute RPE ladder where 8 counted only with an extra rep and 9-10 never
 * counted, with a missing value read as 7 — and it is retired. It judged every
 * exercise against a threshold nobody had chosen, and it read silence as a
 * moderate effort, so a set the lifter said nothing about counted as evidence.
 *
 * Effort will gate clearing again, but only where a lifter asks for it: a
 * per-set prescribed RIR cap, which is opt-in and compared against what was
 * actually logged. Nothing carries a cap yet.
 */
export function metTargetReps(row: LoggedSet, programTargetReps: number | null): boolean {
  const target = row.targetReps ?? programTargetReps;
  if (target == null) return row.actualReps > 0;
  return row.actualReps >= target;
}

// ─── Session clearance ──────────────────────────────────────────────────────

/** Loads are decimals-as-strings; compare with a tolerance rather than ===. */
const LOAD_EPSILON = 1e-6;

/**
 * The sets that decide whether this session cleared, per the exercise's scope.
 *
 * Returns null when a deciding set has no logged row, which makes the session
 * *unknown* rather than missed (D-9): cutting a workout short says nothing
 * about whether the load is right, and treating it as a failure would deload
 * the lifter for leaving early. Under scope "all" that reduces to exactly
 * D-9's rule, since every prescribed working set is a deciding set.
 *
 * `sets` must be ordered by set number. `prescribedWorkingSets` is what lets a
 * missing trailing set be seen at all — a skipped set leaves no row.
 */
export function decidingSets(
  session: SessionHistory,
  scope: ProgressionScope,
  setNumber: number,
): LoggedSet[] | null {
  const sets = session.sets;
  if (sets.length === 0) return null;
  const prescribed = session.prescribedWorkingSets;
  // Fewer rows than the plan asked for: some working set was skipped, and
  // which one is not recorded. Only the scopes that depend on the trailing
  // sets have to care.
  const short = prescribed != null && sets.length < prescribed;

  switch (scope) {
    case "all":
      return short ? null : sets;
    case "first":
      // A dropped set is almost always a trailing one, and the first set is
      // present, so the top set can still speak for the session.
      return [sets[0]];
    case "last":
      return short ? null : [sets[sets.length - 1]];
    case "set": {
      const own = sets.find((s) => s.setNumber === setNumber);
      return own ? [own] : null;
    }
  }
}

/**
 * Decide one session: cleared, missed, or unknown.
 *
 * `judge` answers "did this set reach what it was prescribed", and returns the
 * shortfall so the dot detail view can say *how* short. Duration and distance
 * sets pass `shortfall: undefined` — nothing logs their target.
 *
 * A "Tired" session that fell short comes out **unknown**, not missed (A6).
 * Self-reported fatigue used to exclude the session from the window entirely,
 * which froze progression and showed stale numbers; its clears now count
 * normally and only its misses are held harmless.
 */
export function evaluateSession(
  session: SessionHistory,
  scope: ProgressionScope,
  setNumber: number,
  judge: (set: LoggedSet) => { cleared: boolean; shortfall?: number },
  effortCap?: number | null,
  configChangedAt?: string | null,
): SessionOutcome {
  const deciding = decidingSets(session, scope, setNumber);
  const base = {
    date: session.date,
    loggedSets: session.sets.length,
    prescribedSets: session.prescribedWorkingSets,
    feeling: session.feeling,
  };

  // E-13, and it is asked before anything else: a session logged under a rule
  // that has since changed cannot answer today's question, whatever it did.
  if (configChangedAt != null && session.date < configChangedAt) {
    return {
      ...base,
      status: "unknown",
      unknownReason: "reconfigured",
      loadKg: maxLoad(session.sets),
      minReps: minReps(session.sets),
      wasEasy: false,
    };
  }

  if (deciding === null) {
    return {
      ...base,
      status: "unknown",
      unknownReason: "partial",
      loadKg: maxLoad(session.sets),
      minReps: minReps(session.sets),
      wasEasy: false,
    };
  }

  const verdicts = deciding.map(judge);
  const targetsMet = verdicts.every((v) => v.cleared);
  const shortfall = verdicts.reduce<number | undefined>(
    (worst, v) =>
      v.shortfall != null && (worst == null || v.shortfall > worst)
        ? v.shortfall
        : worst,
    undefined,
  );

  // D-8: the set the scope already names decides effort too. For every scope
  // but "all" that is the only deciding set; for "all" it is the last working
  // set, where reserve is lowest by design and the reading is strictest.
  const effortRir =
    effortCap != null ? loggedRir(deciding[deciding.length - 1]) : null;
  // D-1: a cap makes clearing stricter. It can never rescue a session that
  // missed its reps, so the target question is asked first.
  const effortMet = effortCap == null || (effortRir != null && effortRir >= effortCap);
  const effortUnknown = effortCap != null && effortRir == null;
  const cleared = targetsMet && effortMet;

  // A6: a Tired session's misses are held harmless — its clears still count and
  // it still supplies the "Last:" numbers. D-2: silence where a cap was asked
  // for is unknown, not a failure. Both land on the same inert status.
  let status: SessionStatus;
  let unknownReason: SessionOutcome["unknownReason"];
  if (cleared) {
    status = "cleared";
  } else if (targetsMet && effortUnknown) {
    status = "unknown";
    unknownReason = "effort";
  } else if (session.feeling === "Tired") {
    status = "unknown";
    unknownReason = "tired";
  } else {
    status = "missed";
  }

  return {
    ...base,
    status,
    ...(unknownReason ? { unknownReason } : {}),
    ...(status === "missed" && shortfall != null ? { shortfall } : {}),
    ...(status === "missed" && targetsMet ? { effortShort: true } : {}),
    loadKg: maxLoad(deciding),
    minReps: minReps(deciding),
    wasEasy: cleared && deciding.some((s) => s.wasEasy === true),
  };
}

function maxLoad(sets: LoggedSet[]): number {
  return sets.reduce((m, s) => Math.max(m, Number(s.weightKg)), 0);
}

function minReps(sets: LoggedSet[]): number {
  if (sets.length === 0) return 0;
  return sets.reduce((m, s) => Math.min(m, s.actualReps), Infinity);
}

/**
 * What a back-off proposes, snapped to the increment grid.
 *
 * Floored at one increment (E-18). Percentage cuts compound, and a lift that
 * keeps missing would otherwise be walked down past an empty bar one 10% step
 * at a time. Callers must not reach here at zero load — there is nothing to
 * back off from, and the answer is to leave the plan alone.
 */
export function backoffWeight(
  baseWeightKg: number,
  pct: number,
  incrementKg: number,
): number {
  const cut = roundToNearest(baseWeightKg * (1 - pct / 100), incrementKg);
  return Math.max(cut, incrementKg > 0 ? incrementKg : cut);
}

/**
 * How many sessions in a row cleared, newest first.
 *
 * Two rules, both load-bearing and both easy to lose:
 *
 * **D-11, consecutive.** A missed session resets the count to zero. "Two full
 * workouts" means two in a row; counting two clears either side of a miss is a
 * different, weaker rule.
 *
 * **D-2 / D-9, unknown is inert.** An unknown session neither counts nor
 * resets. A session you did not finish must not undo progress you banked, or
 * the forgiving reading of a short session becomes a punishment.
 *
 * **SI-11, at this load or heavier.** A clear logged below the current load
 * stops the run. Without it the two clears that earned the last bump stay in
 * the window and immediately earn another, which is the runaway this whole
 * rebuild exists to fix. Not applied to duration and distance, where the load
 * is incidental.
 */
export function countConsecutiveClears(
  outcomes: SessionOutcome[],
  currentLoadKg: number,
  compareLoad: boolean,
): number {
  let count = 0;
  for (const o of outcomes) {
    if (o.status === "unknown") continue;
    if (o.status === "missed") break;
    if (compareLoad && o.loadKg < currentLoadKg - LOAD_EPSILON) break;
    count++;
  }
  return count;
}

/**
 * How many sessions in a row failed to clear, newest first. Unknown sessions
 * are skipped rather than breaking the streak, for the same reason as above.
 */
export function countConsecutiveMisses(outcomes: SessionOutcome[]): number {
  let count = 0;
  for (const o of outcomes) {
    if (o.status === "unknown") continue;
    if (o.status === "cleared") break;
    count++;
  }
  return count;
}

// ─── Rule description ───────────────────────────────────────────────────────

/**
 * One or two plain sentences describing what this exercise's progression will
 * actually do, built from its live axis values. Shown under the preset in the
 * progression sheet, always visible.
 *
 * This sentence is the contract with the lifter. If it cannot be written, the
 * configuration is incoherent and the sheet should not allow it.
 *
 * Returns null for advances that never suggest anything.
 */
export function describeProgressionRule(input: {
  /** Axis 6. */
  advance: string | null;
  incrementKg: number | null;
  incrementReps: number;
  targetReps: number | null;
  requiredHits: number;
  /** Which sets have to clear. Null/undefined = "all". */
  scope?: string | null;
  /** The rep range, for double progression. Both null = a fixed target. */
  repRangeMin?: number | null;
  repRangeMax?: number | null;
  /** Axis 3: the prescribed reps in reserve on the deciding set. Null = none. */
  effortCap?: number | null;
  /** Axis 7 and its two numbers. */
  regress?: string | null;
  backoffPct?: number | null;
  backoffAfter?: number | null;
  /** Axis 8. */
  readiness?: string | null;
  /**
   * The sets carry a cycle anchor, so the training cycle prescribes their
   * duration or distance weekly and progression never writes it (SI-30a).
   * Without this the sentence promises an advance the engine will refuse.
   */
  anchored?: boolean;
}): string | null {
  const { incrementKg, incrementReps, targetReps, requiredHits } = input;
  const advance = toAdvance(input.advance);
  const scope = toScope(input.scope);
  const effortCap = input.effortCap ?? null;
  // "N in a row", not "N of the last 5": a miss resets the count (D-11), and
  // the sentence is the contract with the lifter, so it has to say the rule
  // the engine actually applies.
  const sessions =
    requiredHits <= 1 ? "in a session" : `in ${requiredHits} sessions in a row`;
  // Who has to clear. Progression used to ask this of one set at a time, which
  // is why a 4x12 could bump while its last set kept falling short.
  const subject =
    scope === "first"
      ? "the first set"
      : scope === "last"
        ? "the last set"
        : scope === "set"
          ? "a set"
          : "every set";
  const reps = targetReps != null ? `${targetReps} reps` : "the target reps";
  const kg =
    incrementKg != null && incrementKg > 0 ? `+${incrementKg}kg` : "More weight";
  // Axis 3, and the clause that only appears when a lifter asked for it. An
  // uncapped exercise clears on the target alone (D-1), and saying otherwise
  // would describe a rule the engine is not applying.
  const withReserve =
    effortCap != null
      ? ` with at least ${effortCap} rep${effortCap === 1 ? "" : "s"} in reserve`
      : "";

  // Said before anything else, because it overrides everything after it: the
  // cycle owns these targets and no axis below changes that.
  if (input.anchored && (advance === "duration" || advance === "distance")) {
    return "Your training cycle sets these targets week by week, so progression leaves them alone.";
  }

  let rule: string | null;
  switch (advance) {
    case "load":
      rule = `${kg} once ${subject} hits ${reps}${withReserve} ${sessions}.`;
      break;
    case "double": {
      const { repRangeMin: min, repRangeMax: max } = input;
      // Without a range the scheme has nothing to climb and behaves as load
      // progression, so it says so rather than describing a range it has not
      // got. The picker refuses the pairing; an import can still produce it.
      if (min == null || max == null) {
        rule = `${kg} once ${subject} hits ${reps}${withReserve} ${sessions}.`;
        break;
      }
      rule = `Work ${min} to ${max} reps. Add reps once ${subject} hits the target${withReserve} ${sessions}, then ${incrementKg != null && incrementKg > 0 ? `+${incrementKg}kg` : "more weight"} and back to ${min}.`;
      break;
    }
    case "reps":
      rule = `${incrementReps > 0 ? `+${incrementReps} rep${incrementReps === 1 ? "" : "s"}` : "More reps"} at the same weight once ${subject} hits ${reps}${withReserve} ${sessions}.`;
      break;
    case "duration":
      rule = `+${incrementReps > 0 ? incrementReps : 10}s once ${subject} holds the target duration ${sessions}.`;
      break;
    case "distance":
      rule = `+${(incrementReps > 0 ? incrementReps : 500) / 1000}km once ${subject} covers the target distance ${sessions}.`;
      break;
    default:
      // "none" and "manual" propose nothing, so there is no rule to state.
      return null;
  }

  // Axis 7. Only load-bearing advances can back off — cutting the weight when
  // the reps stall progresses one dimension and regresses another.
  const pct = input.backoffPct ?? DELOAD_PCT;
  const after = input.backoffAfter ?? DELOAD_THRESHOLD;
  if (toRegress(input.regress) === "backoff") {
    rule += ` Back off ${pct}% after ${after} workout${after === 1 ? "" : "s"} short of target.`;
  }

  // Axis 8. "hold" is the default and the behaviour people already have, so it
  // goes unsaid; the two that differ from it are named.
  const readiness = toReadiness(input.readiness);
  if (readiness === "ignore") {
    rule += " Suggests the same whatever your readiness says.";
  } else if (readiness === "reduce") {
    rule += " On a low-readiness day, backs off instead.";
  }

  return rule;
}

// ─── Batch application ──────────────────────────────────────────────────────

/** A suggestion that is actionable and not yet reflected in the set's values. */
export type PendingProgression = {
  setId: number;
  weightKg?: number;
  targetReps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
};

/** The shape pendingProgressions needs from a planned set. Override-aware values. */
export type PendingSetInput = {
  id: number;
  weightKg: string | null;
  targetReps: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  setType?: string | null;
  /**
   * The same set as the *plan* holds it, before any session override.
   *
   * Two different questions are being asked of one set. "Has the lifter already
   * taken this suggestion?" is about today's values, overrides folded in.
   * "Would writing it lower the plan?" is about the blueprint. Answering the
   * second against the override-folded value gets it wrong whenever the lifter
   * has hand-edited today's set: plan 80, today dropped to 70, a 75 suggestion
   * then reads as an increase and quietly rewrites the plan down to 75.
   *
   * Optional: when omitted the set's own values are used, which is correct for
   * any caller that isn't override-folding in the first place.
   */
  planned?: {
    weightKg: string | null;
    targetReps: number | null;
    durationSeconds?: number | null;
    distanceMeters?: number | null;
  };
};

/**
 * Which sets still have a suggestion the lifter hasn't taken, and what applying
 * it would write. Drives the exercise-level "apply to all sets" chip and the
 * payload it sends.
 *
 * Sets are matched on their *current* values (which the caller must pass with
 * any live session override already folded in), so a set counts as pending only
 * while it would actually change. Completed sets are excluded — the number they
 * were logged at is history, not a plan.
 *
 * Only a deload lowers the plan. Every other reason must land strictly above
 * what the plan already holds, measured against `planned` rather than today's
 * possibly-overridden value. Both conditions apply: the first keeps the chip
 * settling to a tick once taken, the second is the floor.
 */
export function pendingProgressions(
  sets: PendingSetInput[],
  suggestions: Record<number, SetSuggestion> | undefined,
  completedSetIds: ReadonlySet<number>,
): PendingProgression[] {
  if (!suggestions) return [];
  const pending: PendingProgression[] = [];

  for (const set of sets) {
    if (completedSetIds.has(set.id)) continue;
    // Warm-ups and other non-working sets never carry progression.
    if (set.setType != null && set.setType !== "working") continue;
    const s = suggestions[set.id];
    if (!s) continue;

    const currentWeight = Number(set.weightKg ?? 0);
    const currentReps = set.targetReps ?? 0;

    // The plan's own values — what a write would be replacing. Falls back to
    // the set itself when the caller isn't override-folding. See `planned`.
    const plan = set.planned ?? set;
    const planWeight = Number(plan.weightKg ?? 0);
    const planReps = plan.targetReps ?? 0;
    const planDuration = plan.durationSeconds ?? 0;
    const planDistance = plan.distanceMeters ?? 0;

    switch (s.reason) {
      case "progressed":
      case "deload": {
        // A suggestion is built from the most recent *logged* weight, so after
        // a lighter session it can land below the planned one. Writing that
        // turns the "↑" chip into a silent downgrade of the programme. Deload
        // is the one exception — backing off is the whole point of it.
        const moves =
          s.reason === "deload"
            ? currentWeight !== s.suggestedWeightKg
            : currentWeight !== s.suggestedWeightKg &&
              s.suggestedWeightKg > planWeight;
        if (moves) {
          pending.push({ setId: set.id, weightKg: s.suggestedWeightKg });
        }
        break;
      }
      // Retry reclaims ground held in a recent session, so it is measured
      // against history — which says nothing about the plan. When the plan
      // already holds the higher number there is nothing to reclaim there, and
      // writing the lower one is the same downgrade a progression would be.
      case "retry":
        if (s.suggestedReps !== undefined) {
          if (s.suggestedReps !== currentReps && s.suggestedReps > planReps) {
            pending.push({ setId: set.id, targetReps: s.suggestedReps });
          }
        } else if (
          currentWeight !== s.suggestedWeightKg &&
          s.suggestedWeightKg > planWeight
        ) {
          pending.push({ setId: set.id, weightKg: s.suggestedWeightKg });
        }
        break;
      // Double progression's reset: the load goes up and the target drops
      // back to the bottom of the range. The two are one move, so the rep
      // write is exempt from the floor the other branches apply — that is
      // `E-1`, and applying the floor here blocks the whole scheme. The floor
      // still guards the *load*: a reset that would land below the planned
      // weight is not a reset, it is a downgrade with the reps thrown in.
      case "reset": {
        if (s.suggestedWeightKg < planWeight) break;
        const entry: PendingProgression = { setId: set.id };
        if (currentWeight !== s.suggestedWeightKg) {
          entry.weightKg = s.suggestedWeightKg;
        }
        if (s.suggestedReps !== undefined && s.suggestedReps !== currentReps) {
          entry.targetReps = s.suggestedReps;
        }
        if (entry.weightKg !== undefined || entry.targetReps !== undefined) {
          pending.push(entry);
        }
        break;
      }
      case "progressed-reps":
        if (
          s.suggestedReps !== undefined &&
          s.suggestedReps !== currentReps &&
          s.suggestedReps > planReps
        ) {
          pending.push({ setId: set.id, targetReps: s.suggestedReps });
        }
        break;
      case "progressed-time":
        if (
          s.suggestedDurationSeconds !== undefined &&
          s.suggestedDurationSeconds !== (set.durationSeconds ?? 0) &&
          s.suggestedDurationSeconds > planDuration
        ) {
          pending.push({
            setId: set.id,
            durationSeconds: s.suggestedDurationSeconds,
          });
        }
        break;
      case "progressed-distance":
        if (
          s.suggestedDistanceMeters !== undefined &&
          s.suggestedDistanceMeters !== (set.distanceMeters ?? 0) &&
          s.suggestedDistanceMeters > planDistance
        ) {
          pending.push({
            setId: set.id,
            distanceMeters: s.suggestedDistanceMeters,
          });
        }
        break;
      default:
        break; // every held* reason, and manual — nothing to take
    }
  }

  return pending;
}

// ─── Core suggestion builder ────────────────────────────────────────────────

/**
 * Build a progressive overload suggestion for one program set.
 *
 * @param sessions The last CONSENSUS_WINDOW completed sessions for this
 *                 exercise slot, newest first, each carrying every working set
 *                 logged in it. Not the last N rows for one set number — the
 *                 gate asks whether the *session* cleared.
 * @param ps       Program set + exercise settings, including the scope that
 *                 says which sets decide that question.
 * @param profile  User profile for default increment fallback. May be null.
 * @param readiness Pre-workout readiness score (1–5). When ≤ 2, a progression
 *                 suggestion is downgraded to "held-readiness".
 * @returns        A SetSuggestion, or null if there is no history to base one on.
 */
export function buildSuggestion(
  sessions: SessionHistory[],
  ps: ProgramSetData,
  profile: UserProfile | null,
  readiness?: number | null,
): SetSuggestion | null {
  const window = sessions.filter((s) => s.sets.length > 0);
  if (window.length === 0) return null;

  const scope = toScope(ps.scope);
  const advance = toAdvance(ps.advance);
  const regress = toRegress(ps.regress);
  const readinessRule = toReadiness(ps.readiness);
  const effortCap = ps.effortCap ?? null;
  const latest = window[0]; // most recent session — used for "Last: 75kg" display

  // This set as the last session logged it. Null when the set is new to the
  // plan: under scope "all" the exercise moves as one, so it takes the
  // exercise's suggestion rather than none at all, falling back to the set the
  // scope reads for its "last time" numbers.
  const latestDeciding = decidingSets(latest, scope, ps.setNumber);
  const reference =
    latest.sets.find((s) => s.setNumber === ps.setNumber) ??
    latestDeciding?.[latestDeciding.length - 1] ??
    latest.sets[latest.sets.length - 1];

  // Two different weights, deliberately.
  //   baseWeight  — what this set actually did last time. A fact, so it is what
  //                 "Last: 60kg" reports and what a back-off is measured from.
  //   currentLoad — what the exercise is working at. Under scope "all" that is
  //                 the *maximum* across the working sets: plans that drifted
  //                 apart (62.5 / 62.5 / 60 / 60) are not re-levelled by the
  //                 migration, so taking the minimum would propose a downgrade
  //                 for set 1 that the plan floor rejects, leaving the whole
  //                 exercise permanently pending. Taking the max levels them up
  //                 on the first advance, which is the plan a lifter wanted.
  const baseWeight = Number(reference.weightKg);
  const currentLoad =
    scope === "all"
      ? latest.sets.reduce((m, s) => Math.max(m, Number(s.weightKg)), 0)
      : baseWeight;

  const incrementKg = adaptiveIncrementKg(
    ps.overloadIncrementKg != null ? Number(ps.overloadIncrementKg) : null,
    currentLoad,
    ps.movementPattern,
    profile?.goal,
    profile?.experienceLevel,
    ps.exerciseType,
  );
  // For "time" mode, overloadIncrementReps encodes seconds increment.
  // (overloadIncrementReps is unused for timed exercises in all other modes.)
  const incrementReps = Number(ps.overloadIncrementReps ?? 0);

  const roundToInc = (kg: number) => roundToNearest(kg, incrementKg);

  // ── Estimated 1RM from the reference set ───────────────────────────────────
  // Display only, and gated on logged effort (SI-D1). Epley on a set the lifter
  // stopped four reps short of failure is not a 1RM estimate, and with effort
  // no longer forged, "nothing logged" now means no estimate rather than an
  // estimate quietly built on an assumed RPE 7.
  const referenceRir = loggedRir(reference);
  const estimated1RM: number | null =
    baseWeight > 0 &&
    reference.actualReps >= 2 &&
    reference.actualReps <= 12 &&
    referenceRir != null &&
    referenceRir <= 3
      ? Math.round(estimate1RM(baseWeight, reference.actualReps) * 10) / 10
      : null;

  // Did a logged set reach the target this mode measures, and by how much did
  // it fall short? Only reps carry a logged target, so only reps report a
  // shortfall — a timed set records what was held, never what was asked for.
  const judge = (r: LoggedSet): { cleared: boolean; shortfall?: number } => {
    if (advance === "duration") {
      const target = ps.durationSeconds ?? r.durationSeconds;
      return { cleared: target != null && (r.durationSeconds ?? 0) >= target };
    }
    if (advance === "distance") {
      const target = ps.distanceMeters ?? r.distanceMeters;
      return { cleared: target != null && (r.distanceMeters ?? 0) >= target };
    }
    if (metTargetReps(r, ps.targetReps)) return { cleared: true };
    const target = r.targetReps ?? ps.targetReps;
    return {
      cleared: false,
      ...(target != null ? { shortfall: target - r.actualReps } : {}),
    };
  };

  // ── Clearance per session, then the gate ───────────────────────────────────
  const outcomes = window.map((sess) =>
    evaluateSession(sess, scope, ps.setNumber, judge, effortCap, ps.configChangedAt),
  );
  const latestOutcome = outcomes[0];
  // Load is incidental to a plank or a run, so the "at this load or heavier"
  // clause only applies where load is the thing being progressed.
  const compareLoad = advance !== "duration" && advance !== "distance";
  // What SI-11 compares against: the load the sets the scope reads are working
  // at, which under scope "all" is the same maximum currentLoad uses.
  const decidingLoad = latestOutcome.loadKg;

  const hitsAchieved = countConsecutiveClears(outcomes, decidingLoad, compareLoad);
  const requiredHits = ps.requiredHits ?? REQUIRED_HITS;
  const hasConsensus = hitsAchieved >= requiredHits;

  // ── "Felt easy" override ──
  // The lifter marked a set easy: an explicit "there was plenty left, bump it".
  // It stands in for the clears the gate hasn't accumulated yet, so the
  // increment is offered next session instead of one or two sessions later.
  //
  // Gated on the *session* having cleared, not just the set (E-6): under scope
  // "all" an easy verdict on set 1 must not carry a session where set 4 fell
  // short. It bypasses the per-exercise gate deliberately — someone who sets
  // the gate to three sessions and then says "this was easy" has answered the
  // question the gate exists to ask.
  const easyOverride = !hasConsensus && latestOutcome.wasEasy;
  const shouldProgress = hasConsensus || easyOverride;

  // ── Back-off detection: `backoffAfter` sessions in a row failed to clear ──
  // Axis 7 decides whether this fires at all, and by how much. It used to be
  // decided by the mode, which meant a rep ladder cut the *weight* when the
  // reps stalled — progressing one dimension and regressing another.
  const backoffPct = ps.backoffPct ?? DELOAD_PCT;
  const backoffAfter = ps.backoffAfter ?? DELOAD_THRESHOLD;
  // A back-off cuts the load, so it needs a load to cut. Duration and distance
  // sets carry a weight only incidentally, and the two advances that suggest
  // nothing have nothing to back off from either.
  const canDeload =
    regress === "backoff" &&
    (advance === "load" || advance === "double" || advance === "reps");
  // Recovering ground (SI-18) asks whether the load or the reps dropped, which
  // is a question about what is being progressed rather than about whether a
  // back-off is configured. The two used to share one flag.
  const canRecover =
    advance === "load" || advance === "double" || advance === "reps";
  const consecutiveMisses = countConsecutiveMisses(outcomes);
  // The guard that must not be dropped. Without it, one rep short on set 4
  // three sessions running deloads all four sets by 10% — the normal state of
  // a 4x12 block, not a stall. It would also make *skipping* set 4 strictly
  // better than grinding it, since a skip is inert and a grind compounds.
  const qualifyingClears = outcomes.filter(
    (o) =>
      o.status === "cleared" &&
      (!compareLoad || o.loadKg >= decidingLoad - LOAD_EPSILON),
  ).length;
  const isStuck =
    canDeload && consecutiveMisses >= backoffAfter && qualifyingClears === 0;

  // ── Sessions until deload warning ──────────────────────────────────────────
  let sessionsUntilDeload: number | null = null;
  if (canDeload) {
    sessionsUntilDeload = isStuck
      ? 0
      : consecutiveMisses === 0
        ? null
        : backoffAfter - consecutiveMisses;
  }

  // ── Shared "basedOn" fields ──
  const basedOn = {
    basedOnWeightKg: baseWeight,
    basedOnReps: reference.actualReps ?? 0,
    basedOnFeeling: latest.feeling ?? "OK",
    basedOnDate: latest.date,
    basedOnRpe: reference.rpe ?? undefined,
    basedOnHitCount: hitsAchieved,
    // Enriched fields
    hitsAchieved,
    hitsRequired: requiredHits,
    sessionsUntilDeload,
    estimated1RM,
    readinessModulated: false,
    exerciseName: ps.exerciseName,
    // The window, session by session, so "why is this not progressing" has an
    // answer on screen instead of requiring a mental model of the engine.
    sessions: outcomes.map((o) => ({
      date: o.date,
      status: o.status,
      ...(o.shortfall != null ? { shortfall: o.shortfall } : {}),
      ...(o.unknownReason ? { unknownReason: o.unknownReason } : {}),
      ...(o.effortShort ? { effortShort: true } : {}),
      loggedSets: o.loggedSets,
      prescribedSets: o.prescribedSets,
      feeling: o.feeling,
    })),
  };

  // ── A back-off takes priority over everything the advance would do ──
  // E-18: repeated cuts must not walk a lift below an empty bar, and at zero
  // load (bodyweight) there is nothing to cut, so it is a no-op rather than a
  // suggestion to lift 0 kg.
  if (isStuck && baseWeight > 0) {
    return {
      suggestedWeightKg: backoffWeight(baseWeight, backoffPct, incrementKg),
      ...basedOn,
      reason: "deload",
    };
  }

  // ── Recovery: last session was lower weight or fewer reps than the one before ─
  // Suggest returning to the previous value before progressing further.
  // Only applies to weight-bearing modes; deload already handled above.
  // Guard: if the weight drop was preceded by consecutive failures (an intentional
  // deload), do NOT suggest going back up immediately.
  //
  // Both sessions must be *known*. An unknown one reports the load and reps of
  // whatever it did log, which under a per-set scope can be a different set
  // entirely — reading a drop out of that would invent a claim the lifter
  // never made.
  if (
    outcomes.length >= 2 &&
    canRecover &&
    latestOutcome.status !== "unknown" &&
    outcomes[1].status !== "unknown"
  ) {
    const prev = outcomes[1];

    if (prev.loadKg > decidingLoad + LOAD_EPSILON) {
      // Weight decreased — only retry if the drop was a one-off, not a deload
      const prevFailStreak = countConsecutiveMisses(outcomes.slice(1));
      const wasIntentionalDeload = prevFailStreak >= backoffAfter - 1;
      if (!wasIntentionalDeload) {
        return {
          suggestedWeightKg: prev.loadKg,
          ...basedOn,
          reason: "retry",
        };
      }
    }

    // Same weight but fewer reps — suggest matching the previous rep count.
    // Measured on the worst set of each session, which is the one that decides
    // clearing.
    //
    // The last clause is not in the rule as originally written, and without it
    // this fires on every ordinary miss. Reclaiming ground only means something
    // when the previous session went *past* the prescription: against a fixed
    // target of 12, a session of 12 followed by one of 10 has nothing to
    // reclaim — the plan already asks for 12, the session simply missed, and
    // relabelling that as "retry 12 reps" hides the miss behind a suggestion
    // the plan floor would refuse to write anyway. This never showed up before
    // because logged reps were always the target, so the branch was unreachable.
    const repTarget = ps.targetReps ?? reference.targetReps;
    if (
      Math.abs(prev.loadKg - decidingLoad) < LOAD_EPSILON &&
      prev.minReps > latestOutcome.minReps &&
      prev.minReps > 0 &&
      (repTarget == null || prev.minReps > repTarget)
    ) {
      return {
        suggestedWeightKg: baseWeight,
        suggestedReps: prev.minReps,
        ...basedOn,
        reason: "retry",
      };
    }
  }

  // ── Build the advance ───────────────────────────────────────────────────────
  // Every branch below asks "should this move" the same way; only *what* moves
  // differs. That is axis 6, and it is the whole reason the mode was split.
  let suggestion: SetSuggestion;

  // A cap was prescribed and the deciding set said nothing about effort. That
  // is a different message from "you have not cleared it enough times", and
  // rendering both as `held` is how the old UI left people guessing.
  const heldReason: SetSuggestion["reason"] =
    latestOutcome.unknownReason === "effort" ? "held-unknown" : "held";
  const held = (weightKg: number): SetSuggestion => ({
    suggestedWeightKg: weightKg,
    ...basedOn,
    reason: heldReason,
  });

  switch (advance) {
    case "none":
      return null;

    case "manual":
      suggestion = { suggestedWeightKg: baseWeight, ...basedOn, reason: "manual" };
      break;

    case "load":
      // Bodyweight exercises (weight=0) can't progress by adding kg — fall back to reps.
      if (currentLoad === 0) {
        const bwTarget = ps.targetReps ?? reference.targetReps;
        if (shouldProgress && incrementReps > 0 && bwTarget != null) {
          suggestion = {
            suggestedWeightKg: 0,
            suggestedReps: bwTarget + incrementReps,
            ...basedOn,
            reason: "progressed-reps",
          };
        } else {
          suggestion = held(0);
        }
        break;
      }
      if (shouldProgress && incrementKg > 0) {
        suggestion = {
          suggestedWeightKg: roundToInc(currentLoad + incrementKg),
          ...basedOn,
          reason: "progressed",
        };
      } else {
        suggestion = held(baseWeight);
      }
      break;

    case "reps": {
      const targetReps = ps.targetReps ?? reference.targetReps;
      // A rep ladder with a range configured stops at the top of it (E-17).
      // Without a range it keeps climbing, which is today's behaviour and its
      // own known gap: 8, 9, 10 … 40, with nothing to convert reps into load.
      const ceiling = ps.repRangeMax ?? null;
      const atCeiling = ceiling != null && targetReps != null && targetReps >= ceiling;
      if (shouldProgress && incrementReps > 0 && targetReps != null && !atCeiling) {
        const next = targetReps + incrementReps;
        suggestion = {
          suggestedWeightKg: baseWeight,
          suggestedReps: ceiling != null ? Math.min(ceiling, next) : next,
          ...basedOn,
          reason: "progressed-reps",
        };
      } else {
        suggestion = held(baseWeight);
      }
      break;
    }

    /**
     * Double progression: climb the reps inside the range, then convert them
     * into load and drop back to the bottom of it.
     *
     * The prescription is `target_reps` as it stands today, which moves between
     * the bounds. Clearing is the same question as everywhere else — every set
     * the scope names met that target — so nothing about the window or the gate
     * changes here; only what an advance *does*.
     */
    case "double": {
      const rangeMin = ps.repRangeMin ?? null;
      const rangeMax = ps.repRangeMax ?? null;
      const target = ps.targetReps ?? reference.targetReps ?? null;

      if (!shouldProgress) {
        suggestion = held(baseWeight);
        break;
      }

      if (rangeMin != null && rangeMax != null && target != null && target < rangeMax) {
        // Below the top of the range, so the reps climb and the load stands.
        // The new target is what the binding set actually did, not one more
        // rep than was asked for: a lifter who already manages the top of the
        // range would otherwise be walked up to it one session at a time,
        // with the prescription permanently lagging what they can do. The
        // one-rep floor keeps it moving when they did exactly the target, and
        // an unfinished session supplies no evidence, so it uses the floor.
        const repStep = incrementReps > 0 ? incrementReps : 1;
        const achieved = latestOutcome.status === "cleared" ? latestOutcome.minReps : 0;
        suggestion = {
          suggestedWeightKg: baseWeight,
          suggestedReps: Math.min(rangeMax, Math.max(target + repStep, achieved)),
          ...basedOn,
          reason: "progressed-reps",
        };
        break;
      }

      // At the top of the range: buy the next range with load. With nothing to
      // add — no increment, or a bodyweight exercise — the exercise holds
      // rather than climbing past the range its owner configured (E-4). The
      // sheet refuses to offer this pairing, so it should be unreachable; the
      // engine still says so rather than inventing an advance.
      if (incrementKg <= 0 || currentLoad === 0) {
        suggestion = {
          suggestedWeightKg: baseWeight,
          ...basedOn,
          reason: "held-no-increment",
        };
        break;
      }
      const resetWeight = roundToInc(currentLoad + incrementKg);
      suggestion =
        rangeMin != null
          ? {
              suggestedWeightKg: resetWeight,
              suggestedReps: rangeMin,
              ...basedOn,
              reason: "reset",
            }
          : // No range at all. The picker writes the mode and the range
            // together, so this is a hand-edited or imported pairing; freezing
            // the exercise would be a worse answer than the load progression
            // the lifter plainly wanted.
            { suggestedWeightKg: resetWeight, ...basedOn, reason: "progressed" };
      break;
    }

    case "duration": {
      const targetDuration = ps.durationSeconds ?? reference.durationSeconds;
      const actualDuration = reference.durationSeconds ?? 0;
      // overloadIncrementReps doubles as seconds increment for this axis;
      // fall back to 10s if not configured.
      const incrementSecs = incrementReps > 0 ? incrementReps : 10;
      const basedOnWithDuration = {
        ...basedOn,
        basedOnDurationSeconds: actualDuration > 0 ? actualDuration : undefined,
      };
      // A5: an anchored set is never an advance target. The cycle rewrites
      // duration_seconds from peak_duration_seconds every week, so a bump here
      // is overwritten at best and fights the periodization at worst.
      if (ps.peakDurationSeconds != null) {
        suggestion = {
          suggestedWeightKg: baseWeight,
          ...basedOnWithDuration,
          reason: "held-anchored",
        };
        break;
      }
      if (targetDuration != null && shouldProgress) {
        // Target + increment, not actual + increment (A5). Beating a 5-minute
        // hold by 40 seconds used to ratchet the plan by 40 seconds, so one
        // good session permanently reset what counted as clearing.
        suggestion = {
          suggestedWeightKg: baseWeight,
          suggestedDurationSeconds: targetDuration + incrementSecs,
          ...basedOnWithDuration,
          reason: "progressed-time",
        };
      } else {
        suggestion = { suggestedWeightKg: baseWeight, ...basedOnWithDuration, reason: heldReason };
      }
      break;
    }

    case "distance": {
      const targetDistance = ps.distanceMeters ?? reference.distanceMeters;
      const actualDistance = reference.distanceMeters ?? 0;
      // overloadIncrementReps doubles as meters increment for this axis;
      // fall back to 500m (+0.5km) if not configured.
      const incrementMeters = incrementReps > 0 ? incrementReps : 500;
      const basedOnWithDistance = {
        ...basedOn,
        basedOnDistanceMeters: actualDistance > 0 ? actualDistance : undefined,
      };
      if (ps.peakDistanceMeters != null) {
        suggestion = {
          suggestedWeightKg: 0,
          ...basedOnWithDistance,
          reason: "held-anchored",
        };
        break;
      }
      if (targetDistance != null && shouldProgress) {
        // Target + increment, for the same reason as duration above: beating a
        // 5 km target by 200 m used to make 5.2 km the new prescription.
        suggestion = {
          suggestedWeightKg: 0,
          suggestedDistanceMeters: targetDistance + incrementMeters,
          ...basedOnWithDistance,
          reason: "progressed-distance",
        };
      } else {
        suggestion = { suggestedWeightKg: 0, ...basedOnWithDistance, reason: heldReason };
      }
      break;
    }
  }

  // ── Readiness modulation: axis 8 ────────────────────────────────────────
  // "reset" is in the list for the same reason as the rest: it raises the
  // load. That it also drops the reps does not make it a lighter day.
  const isAdvance =
    suggestion.reason === "progressed" ||
    suggestion.reason === "progressed-reps" ||
    suggestion.reason === "reset" ||
    suggestion.reason === "progressed-time" ||
    suggestion.reason === "progressed-distance";
  if (readiness != null && readiness <= 2 && readinessRule !== "ignore" && isAdvance) {
    const cleared = {
      ...suggestion,
      suggestedWeightKg: baseWeight,
      suggestedReps: undefined,
      suggestedDurationSeconds: undefined,
      suggestedDistanceMeters: undefined,
      readinessModulated: true,
    };
    suggestion =
      // "reduce" backs off rather than merely holding — E-7 reuses the
      // `backoff` reason code with readinessModulated set, so the chip can say
      // why without every consumer learning a tenth code. Nothing to back off
      // from at zero load, so bodyweight work holds either way.
      readinessRule === "reduce" && baseWeight > 0
        ? {
            ...cleared,
            suggestedWeightKg: backoffWeight(baseWeight, backoffPct, incrementKg),
            reason: "deload",
          }
        : { ...cleared, reason: "held-readiness" };
  }

  // Flag the bump the easy verdict earned, so the UI can say why it fired
  // without two hits behind it. Deliberately after readiness modulation: a
  // low-readiness day still holds the load, easy verdict or not.
  // The prefix test is why the reason family is still named `progressed*`:
  // renaming it to `advanced*` would make this match nothing and silently stop
  // the flag firing, with no type error. `reset` has to be named explicitly
  // because it is an advance that does not share the prefix.
  if (
    easyOverride &&
    (suggestion.reason.startsWith("progressed") || suggestion.reason === "reset")
  ) {
    suggestion = { ...suggestion, easyOverride: true };
  }

  return suggestion;
}
