/**
 * Programs Schema
 *
 * A "program" is a named workout template that lists exercises and their
 * planned sets (reps, weight, rest). Users can select a program when
 * starting a workout.
 *
 * Tables:
 *  programs            – the named collection (e.g. "Push 1", "Legs 1")
 *  program_exercises   – ordered exercise slots inside a program
 *  program_sets        – individual set blueprints for each exercise slot
 */

import {
    boolean,
    decimal,
    integer,
    pgTable,
    serial,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import { exerciseTypeEnum, exercises } from "./exercises";
import { trainingCycles } from "./training-cycles";
import { users } from "./users";

// -------------------------------------------------------------------
// programs
// -------------------------------------------------------------------
export const programs = pgTable("programs", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  // Set when a cycle generator (e.g. the triathlon plan) creates this program
  // for a specific cycle. Cascades on cycle delete so generated programs are
  // cleaned up instead of cluttering the Programs list. Null for standalone
  // programs the user built themselves — those are never auto-deleted.
  createdByCycleId: integer("created_by_cycle_id").references(
    () => trainingCycles.id,
    { onDelete: "cascade" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// -------------------------------------------------------------------
// program_exercises  (ordered exercise slots within a program)
// -------------------------------------------------------------------
export const programExercises = pgTable("program_exercises", {
  id: serial("id").primaryKey(),
  programId: integer("program_id")
    .references(() => programs.id, { onDelete: "cascade" })
    .notNull(),
  exerciseId: integer("exercise_id")
    .references(() => exercises.id, { onDelete: "cascade" })
    .notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  notes: text("notes"),
  overloadIncrementKg: decimal("overload_increment_kg", { precision: 4, scale: 2 }),
  overloadIncrementReps: integer("overload_increment_reps").default(0),
  // "none" | "manual" | "weight" | "smart" | "reps" | "time" | "distance"
  progressionMode: text("progression_mode").default("manual"),
  // Which sets have to clear for the *session* to count toward the gate.
  //   all   — every working set (the default, and what a straight-set plan means)
  //   first — the top set drives it, back-offs follow
  //   last  — the last working set drives it
  //   set   — each set banks its own count, judged alone
  //
  // Progression used to be keyed on exercise + set number with no session-level
  // question at all, so on 4x12 each set banked its own count and the plan could
  // ratchet to 62.5 / 60 / 60 / 60. That is scope "set", and nothing lands on it
  // by default: existing exercises take the "all" default, which visibly holds
  // exercises that were quietly progressing off one set.
  progressionScope: text("progression_scope").notNull().default("all"),
  // How many qualifying sessions inside the consensus window are needed before
  // a bump is suggested. Null = inherit REQUIRED_HITS from progression.ts, so
  // the shared default stays in one place instead of being copied per row.
  progressionRequiredHits: integer("progression_required_hits"),
  // What moves when the gate is met. This is the axis the engine reads;
  // progressionMode above is kept for one release so a client or an export
  // written before the axes still round-trips, and nothing reads it.
  //   none     — no suggestions, no chips, no dots
  //   manual   — proposes nothing, but still shows what you did last time
  //   load     — add kg
  //   reps     — add reps at the same load
  //   double   — climb the reps inside the range, then convert them into load
  //   duration — add seconds
  //   distance — add metres
  progressionAdvance: text("progression_advance").notNull().default("manual"),
  // What happens when the gate keeps not being met.
  //   hold    — nothing; the plan stands
  //   backoff — cut the load once the misses run long enough
  progressionRegress: text("progression_regress").notNull().default("backoff"),
  // How far a back-off cuts, and how many consecutive non-clearing sessions it
  // waits for. Only read when progressionRegress is "backoff". The defaults are
  // DELOAD_FACTOR and DELOAD_THRESHOLD from progression.ts, expressed per row.
  progressionBackoffPct: integer("progression_backoff_pct").notNull().default(10),
  progressionBackoffAfter: integer("progression_backoff_after").notNull().default(3),
  // What a low pre-workout readiness score does to a suggestion.
  //   ignore — nothing; the suggestion stands
  //   hold   — downgrade an advance to held
  //   reduce — propose a back-off instead
  progressionReadiness: text("progression_readiness").notNull().default("hold"),
  // When the judging rules last changed (scope, gate, advance, regress, the
  // rep range or an effort cap). Sessions logged before it are dropped from the
  // window, because they were judged under a rule that no longer applies:
  // without this, changing a setting silently re-judges history and the dot
  // count moves for reasons the lifter cannot see. Null = never changed, so
  // the whole window counts. Increments and the plan opt-in do not stamp it —
  // they change what an advance writes, not what counts as a clear.
  progressionConfigAt: timestamp("progression_config_at"),
  // Opt-in: accepting a suggestion also rewrites this slot's planned sets, so
  // the next session opens at the new numbers instead of the old ones. Off
  // keeps the historical behaviour — a suggestion only overrides the live
  // session and the plan never moves.
  progressionApplyToPlan: boolean("progression_apply_to_plan")
    .notNull()
    .default(false),
  // Per-program override of the exercise's intrinsic type — e.g. a compound
  // bench press used as accessory work in this program. Null = inherit the
  // exercise's default (resolved type = this ?? exercise.exerciseType).
  exerciseType: text("exercise_type", { enum: exerciseTypeEnum }),
});

// -------------------------------------------------------------------
// program_sets  (planned set blueprint for an exercise slot)
// -------------------------------------------------------------------
export const programSets = pgTable("program_sets", {
  id: serial("id").primaryKey(),
  programExerciseId: integer("program_exercise_id")
    .references(() => programExercises.id, { onDelete: "cascade" })
    .notNull(),
  setNumber: integer("set_number").notNull(),
  // For rep-based sets
  targetReps: integer("target_reps"),
  // Rep range for double progression. Both null = a fixed target, which is
  // every set that predates this. When set, target_reps is the prescription
  // *today* and moves between the bounds: it climbs to what was achieved as
  // the lifter clears, and drops back to the minimum when the load goes up.
  // Reps only — a range has no meaning for a plank or a run (E-5 in
  // docs/progression-revamp-plan.md).
  repRangeMin: integer("rep_range_min"),
  repRangeMax: integer("rep_range_max"),
  weightKg: decimal("weight_kg", { precision: 6, scale: 2 }),
  // For time-based sets (seconds)
  durationSeconds: integer("duration_seconds"),
  // Opt-in prep time (seconds) before a timed set's countdown starts (e.g. getting
  // into a handstand). Null = no delay. Never included in the logged work duration.
  startDelaySeconds: integer("start_delay_seconds"),
  // For running/cardio sets (meters)
  distanceMeters: integer("distance_meters"),
  // Periodized endurance: the peak (race-prep) distance this set ramps toward.
  // Null = not periodized. The active cycle scales distanceMeters from this each week.
  peakDistanceMeters: integer("peak_distance_meters"),
  // Periodized endurance (time mode): the peak (race-prep) duration this set ramps
  // toward, in seconds. Null = duration not periodized. Set when a periodized set is
  // switched to Time mode; the active cycle scales durationSeconds from this each week.
  peakDurationSeconds: integer("peak_duration_seconds"),
  // For running: treadmill incline (whole percent, 0-30)
  inclinePercent: integer("incline_percent"),
  // For running: target heart rate zone (1-5)
  targetHeartRateZone: integer("target_heart_rate_zone"),
  // Rest after this set (seconds)
  restTimeSeconds: integer("rest_time_seconds").notNull().default(0),
  // "working" | "warmup" — non-working sets are excluded from progression suggestions.
  setType: text("set_type").notNull().default("working"),
  // Prescribed Reps In Reserve for this set (the intensity cap, e.g. 2 = "stop with
  // ~2 reps left"). Guidance shown when logging; the athlete logs actual RIR separately.
  // For a range like "2–3 RIR" we store the stricter floor (2). Null = no prescription.
  targetRir: integer("target_rir"),
  // Structural role for phase-aware periodization. "work" = a hard interval rep
  // whose zone/rest the active cycle swaps by phase (base→tempo, build→threshold,
  // peak→VO₂). Null = a steady/warmup/cooldown set that only volume-scales.
  sessionRole: text("session_role"),
});
