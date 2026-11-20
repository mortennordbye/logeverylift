/**
 * Workout Sets Table Schema
 *
 * Represents individual sets within a workout session. This is the core data
 * structure for tracking workout performance.
 *
 * Fields:
 * - set_number: Order within the exercise (1, 2, 3, etc.)
 * - target_reps: The planned number of reps (optional, for following programs)
 * - actual_reps: The reps actually completed
 * - weight_kg: Load lifted (use decimal for fractional plates like 2.5kg)
 * - rir: Reps In Reserve — the primary effort input the user logs (0 = to failure,
 *        5 = 5+ reps left). When set, rpe is derived as clamp(10 - rir, 1, 10).
 * - rpe: Rate of Perceived Exertion (1-10 scale, where 10 = absolute max effort).
 *        Derived from rir when rir is provided; kept for legacy rows and downstream logic.
 *        Null when no effort was logged, which is distinct from any effort value.
 * - rest_time_seconds: Rest period after this set
 * - is_completed: Whether the set was finished or skipped
 *
 * RIR ↔ RPE mapping (rpe = 10 - rir):
 * - RIR 0 → RPE 10: Maximum effort, no reps left in reserve
 * - RIR 1 → RPE 9: Could do 1 more rep
 * - RIR 2 → RPE 8: Could do 2 more reps
 * - RIR 3 → RPE 7: Moderate effort, a few reps left
 * - RIR 5+ → RPE ≤5: Comfortable, many reps in reserve
 *
 * Future enhancements for Auto-Deload & PR Detection:
 * - Track RPE trends: If RPE consistently > 9 for same weight, trigger deload
 * - Compare weight × reps to historical maxes for PR detection
 * - Add tempo column (e.g., "3-1-1" for 3s eccentric, 1s pause, 1s concentric)
 * - Add failure_point (sticking point in the rep)
 * - Add estimated_1rm (calculated using Epley or Brzycki formulas)
 */

import {
    boolean,
    decimal,
    index,
    integer,
    jsonb,
    pgTable,
    real,
    serial,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { exercises } from "./exercises";
import { programExercises, programSets } from "./programs";
import { workoutSessions } from "./workout-sessions";

/** How a logged endurance step went (docs/plans/one-program-model.md, 1.2). */
export const STEP_STATUS_VALUES = ["done", "partial", "skipped", "not_done"] as const;

/**
 * Who wrote a result field (docs/plans/bike-ride-logger.md, 4.5). "assistant"
 * is an MCP log_step_results write (step 5): it fills empty, clock or
 * assistant values and never replaces typed or Garmin ones.
 */
// "belt": a treadmill run step's distance and speed from the belt events (docs/plans/run-logger.md, 4.7).
export const RESULT_SOURCES = ["typed", "clock", "garmin", "assistant", "belt"] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];

export const workoutSets = pgTable("workout_sets", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .references(() => workoutSessions.id, { onDelete: "cascade" })
    .notNull(),
  exerciseId: integer("exercise_id")
    .references(() => exercises.id, { onDelete: "cascade" })
    .notNull(),
  // The plan slot this set was logged against. A program may hold the same
  // exercise twice (heavy bench, then a back-off bench), so exerciseId alone
  // does not identify which prescription the row belongs to — keying on it made
  // the second slot's set 1 overwrite the first slot's set 1.
  //
  // Deliberately `set null`, not `cascade` like the two FKs above: removing an
  // exercise from a program must not delete the workouts already logged against
  // it. Everything reading these columns has to tolerate a null.
  programExerciseId: integer("program_exercise_id").references(
    () => programExercises.id,
    { onDelete: "set null" },
  ),
  programSetId: integer("program_set_id").references(() => programSets.id, {
    onDelete: "set null",
  }),
  setNumber: integer("set_number").notNull(),
  // "working" | "warmup", snapshotted from the program set at log time.
  //
  // set_number counts warm-ups, and asking "did every working set clear in the
  // session three weeks ago" by joining back to program_sets reads *today's*
  // plan — wrong the moment a set was added, deleted or reordered. A log has to
  // describe itself.
  setType: text("set_type").notNull().default("working"),
  // How many working sets the plan prescribed for this slot when the set was
  // logged. A skipped set leaves no row, so set_type alone cannot tell "logged
  // 3 of a prescribed 4" from "the prescription was 3" — and that distinction
  // is what decides whether a session counts as cleared or merely unknown.
  //
  // Every row logged for one slot in one session carries the same count, unless
  // the plan changed mid-session, in which case each row carries what was
  // prescribed when it was written. Null on pre-migration rows.
  prescribedWorkingSets: integer("prescribed_working_sets"),
  targetReps: integer("target_reps"),
  actualReps: integer("actual_reps").notNull(),
  weightKg: decimal("weight_kg", { precision: 6, scale: 2 }).notNull(),
  durationSeconds: integer("duration_seconds"),
  distanceMeters: integer("distance_meters"),
  inclinePercent: real("incline_percent"),
  heartRateZone: integer("heart_rate_zone"), // 1-5
  // Reps In Reserve (0 = to failure, 5 = 5+). Primary user-logged effort signal;
  // rpe is derived from it. Nullable for legacy rows logged before RIR existed.
  rir: integer("rir"),
  // 1-10 scale, derived from rir when present. Nullable, and null means the
  // lifter did not say how hard the set was — not "average effort". Tapping a
  // set done used to write a 7 here, which put every logged set inside the
  // confident band and made the progression window saturate; silence records
  // nothing now. Every read has to handle the null rather than default it.
  rpe: integer("rpe"),
  restTimeSeconds: integer("rest_time_seconds").notNull(),
  // Free-text per-set note: "left shoulder twinged", "added belt", "felt easy"
  notes: text("notes"),
  isCompleted: boolean("is_completed").default(true).notNull(),
  // Set was attempted but the target reps weren't reached (an explicit failure,
  // distinct from actualReps < targetReps which can also mean a planned back-off).
  isFailed: boolean("is_failed").default(false).notNull(),
  // Set was hit at the target and felt easy. An explicit "bump me next time"
  // from the lifter: it satisfies the progression consensus gate on its own, so
  // the next session suggests the increment even though the usual two confident
  // hits haven't accumulated. Read by buildSuggestion.
  wasEasy: boolean("was_easy").default(false).notNull(),
  // ── Endurance steps (docs/plans/one-program-model.md, 1.2) ──────────────
  // Null on strength sets and on endurance sets logged before steps existed.
  // done | partial (cut short) | skipped | not_done. A skipped step writes a
  // row with isCompleted false, so planned-vs-done can show it.
  stepStatus: text("step_status", { enum: STEP_STATUS_VALUES }),
  // Time added to the step in the guided player.
  extendedSeconds: integer("extended_seconds"),
  // The measured value of the main target's metric (average W, bpm, m/s, rpm or RPE).
  measuredValue: real("measured_value"),
  avgHr: integer("avg_hr"),
  // Bike ride results per step (docs/plans/bike-ride-logger.md, 4.1 and 4.5).
  avgPower: integer("avg_power"),
  maxHr: integer("max_hr"),
  avgCadence: integer("avg_cadence"),
  // m/s, as pace is stored.
  avgSpeed: real("avg_speed"),
  climbM: integer("climb_m"),
  // Watts the rider moved the target by in ride mode (±50 at most).
  targetOffsetW: integer("target_offset_w"),
  // Where each result field came from: { avgPower: "garmin", durationSeconds: "clock", ... }.
  sources: jsonb("sources").$type<Partial<Record<string, ResultSource>>>(),
  // The step as planned when it was logged: kind, end, targets and the
  // threshold values used, so a later edit, the weekly sync or a retest does
  // not change what this session was asked to do.
  plannedStep: jsonb("planned_step"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_wsets_session").on(t.sessionId),
  // Prevents double-logging the same set (e.g. rapid double-tap on the
  // "complete" button) and makes re-logging an upsert: one row per program set
  // per session.
  //
  // Keyed on the program set rather than its position. Positions move when the
  // sets are reordered or one is deleted mid-workout, and the previous key,
  // (session, plan slot, set_number), let the set that moved into a position
  // overwrite the row of the set that had been logged there.
  uniqueIndex("uniq_wsets_session_program_set").on(t.sessionId, t.programSetId),
  // The same guarantee for rows with no program set, keyed on position since
  // that is all they have: a set deleted from the plan after its write was
  // queued, or pre-migration history. Postgres treats nulls as distinct, so a
  // row with no plan slot at all (an unprogrammed session) is not covered.
  uniqueIndex("uniq_wsets_session_slot_set_unslotted")
    .on(t.sessionId, t.programExerciseId, t.setNumber)
    .where(sql`${t.programSetId} IS NULL`),
  // Retained for the reads still keyed on the exercise (history windows, PR
  // lookups) that the old unique index used to serve.
  index("idx_wsets_session_exercise").on(t.sessionId, t.exerciseId),
]);
