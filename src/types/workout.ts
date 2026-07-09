/**
 * Workout Type Definitions
 *
 * Central location for all workout-related TypeScript types.
 * These types are inferred from Drizzle schemas to maintain perfect sync
 * between database structure and TypeScript types.
 */

import {
  exercises,
  programExercises,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import type { Discipline } from "@/lib/utils/discipline";

// ============================================================================
// Database Table Types (Inferred from Drizzle Schemas)
// ============================================================================

export type Exercise = typeof exercises.$inferSelect;
export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type Program = typeof programs.$inferSelect;
export type ProgramExercise = typeof programExercises.$inferSelect;
export type ProgramSet = typeof programSets.$inferSelect;

// Program with nested exercises and sets
export type ProgramExerciseWithSets = ProgramExercise & {
  exercise: Exercise;
  programSets: ProgramSet[];
};
export type ProgramWithExercises = Program & {
  programExercises: ProgramExerciseWithSets[];
};

// ============================================================================
// Composite Types (For Complex Queries)
// ============================================================================

/**
 * Extended workout set with related exercise and session information.
 * Used when displaying workout history.
 */
export type WorkoutSetWithExercise = WorkoutSet & {
  exercise: Exercise;
};

// ============================================================================
// Server Action Response Types
// ============================================================================

/**
 * Generic success/error response for server actions.
 * Provides type-safe error handling.
 */
export type ActionResult<T = undefined> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

/**
 * Response type for workout history queries.
 * Includes pagination metadata.
 */
export type WorkoutHistoryResult = {
  sets: WorkoutSetWithExercise[];
  totalCount: number;
  hasMore: boolean;
};

/**
 * Aggregate workout statistics for the home page dashboard.
 */
export type WorkoutStats = {
  totalWorkouts: number;
  totalReps: number;
  totalSets: number;
  thisWeekWorkouts: number;
};

/**
 * Session with aggregate stats for the history list view.
 */
export type SessionWithStats = WorkoutSession & {
  programName: string | null;
  setCount: number;
  exerciseCount: number;
  totalVolumeKg: number;
  durationMinutes: number;
  /** Distinct exercise names logged in this session — used for history filtering. */
  exerciseNames: string[];
};

/**
 * Session detail with sets grouped by exercise.
 */
export type SessionDetail = WorkoutSession & {
  programName: string | null;
  setsByExercise: Array<{ exerciseName: string; exerciseCategory: string; sets: WorkoutSet[] }>;
};

// Training Cycles
export type TrainingCycle = typeof trainingCycles.$inferSelect;
export type TrainingCycleSlot = typeof trainingCycleSlots.$inferSelect;

export type TrainingCycleSlotWithProgram = TrainingCycleSlot & {
  program: Program | null;
};

export type TrainingCycleWithSlots = TrainingCycle & {
  slots: TrainingCycleSlotWithProgram[];
};

// A scheduled slot that was missed (no completed session on its expected date).
export type MissedSlot = {
  date: string; // ISO date string (YYYY-MM-DD)
  slot: TrainingCycleSlotWithProgram;
};

// The active cycle with today's slot resolved
export type ActiveCycleInfo = {
  cycle: TrainingCycleWithSlots;
  todaySlot: TrainingCycleSlotWithProgram | null;
  currentWeek: number;
  endDate: string; // ISO date string
  /**
   * Active slots whose expected day has passed without a completed session.
   * - Rotation mode: surfaces today's slot when overdue (date == earliest miss).
   * - Day-of-week mode: missed days within the last 7 days bounded by [startDate, today).
   */
  missedSlots: MissedSlot[];
};

// ============================================================================
// UI Component Props Types
// ============================================================================

// ============================================================================
// Progressive Overload Suggestions
// ============================================================================

/**
 * A single progressive overload suggestion for a program set.
 *
 * Shared between the server action (getProgressiveSuggestions) and client
 * components. Plain serializable object — no server-only imports.
 *
 * reason values:
 *   "progressed"        — weight progression suggested
 *   "progressed-reps"   — rep count progression suggested
 *   "progressed-time"   — duration progression suggested (time mode)
 *   "held"              — not enough confident hits to progress; hold current weight
 *   "held-readiness"    — would have progressed, but readiness ≤ 2 today
 *   "deload"            — 3+ consecutive failures detected; 10% weight reduction suggested
 *   "manual"            — progression mode is manual; no suggestion
 */
export type SetSuggestion = {
  suggestedWeightKg: number;
  suggestedReps?: number;
  adjustedRepsForWeight?: number; // 1RM-estimated reps at new weight (smart mode)
  suggestedDurationSeconds?: number; // time mode: suggested new duration
  suggestedDistanceMeters?: number; // distance mode: suggested new target distance
  basedOnWeightKg: number; // last logged weight (raw, no rounding)
  basedOnReps: number; // last logged actual reps
  basedOnDurationSeconds?: number; // last logged duration (time mode)
  basedOnDistanceMeters?: number; // last logged distance (distance mode)
  basedOnFeeling: string; // last session feeling
  basedOnDate: string; // last session date
  basedOnRpe?: number; // last logged RPE (optional — null for old sessions)
  basedOnHitCount?: number; // how many of the last CONSENSUS_WINDOW sessions hit target with confidence
  reason: "progressed" | "held" | "held-readiness" | "manual" | "progressed-reps" | "deload" | "progressed-time" | "progressed-distance" | "retry";
  // ─── Enriched fields (populated by getProgressiveSuggestions) ───────────────
  /** How many confident hits have been recorded in the current consensus window. */
  hitsAchieved: number;
  /** Hits required to trigger progression (always REQUIRED_HITS). */
  hitsRequired: number;
  /**
   * Sessions remaining before a deload is triggered.
   *   null  — no consecutive failures; no risk
   *   1     — one more miss triggers deload
   *   0     — deload already triggered (reason === "deload")
   */
  sessionsUntilDeload: number | null;
  /** Epley-estimated 1RM from the latest logged set. Null for bodyweight/timed or > 12 reps. */
  estimated1RM: number | null;
  /** True when the suggestion was held or adjusted down due to low pre-workout readiness. */
  readinessModulated: boolean;
  /** Exercise name — populated by getProgressiveSuggestions for insight bucketing. */
  exerciseName?: string;
};

// ─── Personal Records ─────────────────────────────────────────────────────────

export type PRType =
  | "weight"
  | "reps_at_weight"
  | "estimated_1rm"
  | "distance"
  | "pace";

export type PRResult = {
  type: PRType;
  value: number;
  previousValue?: number;
  /** Endurance context (set for "distance"/"pace") so the UI can render the unit. */
  discipline?: Discipline;
  /** The effort's distance in meters — set for "pace" so pace can be formatted. */
  distanceMeters?: number;
  /** Distance bracket label, e.g. "5 km" — set for "pace". */
  bracket?: string;
};

/** Return type for logWorkoutSet — includes PR data detected from this set. */
export type LogWorkoutSetResult = {
  set: WorkoutSet;
  newPRs: PRResult[];
};

// ============================================================================
// Program Import/Export
// ============================================================================

// ============================================================================
// Friend System Types
// ============================================================================

export type LeaderboardEntry = {
  userId: string;
  name: string;
  image: string | null;
  totalVolumeKg: number;
  workoutCount: number;
  isMe: boolean;
};

export type UserSearchResult = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  friendshipStatus: "none" | "pending_sent" | "pending_received" | "accepted";
  friendshipId: number | null;
};

export type FriendWithActivity = {
  friendshipId: number;
  userId: string;
  name: string;
  image: string | null;
  workedOutToday: boolean | null; // null = friend has activity privacy on
  streak: number; // 0 = no current streak or privacy off
};

export type FriendProfileStats = {
  streak: number;
  thisWeekVolume: number;
  thisWeekWorkouts: number;
  totalWorkouts: number;
  recentSessions: FriendSessionCard[];
};

export type FriendSessionCard = {
  sessionId: number;
  date: string;
  startTime: Date | null;
  programName: string | null;
  durationMinutes: number;
  setCount: number;
  exerciseCount: number;
  totalVolumeKg: number;
  feeling: string | null;
  prHighlight: { exerciseName: string; value: number } | null;
};

export type ReceivedNudge = {
  id: number;
  fromUserId: string;
  fromName: string;
  fromImage: string | null;
  createdAt: string; // ISO string
};

export type PendingRequest = {
  friendshipId: number;
  requesterId: string;
  requesterName: string;
  requesterImage: string | null;
  createdAt: Date;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type FriendActivityItem = {
  friendshipId: number;
  userId: string;
  name: string;
  image: string | null;
  sessionId: number;
  date: string;
  startTime: Date | null;
  programName: string | null;
  durationMinutes: number;
  setCount: number;
  exerciseCount: number;
  totalVolumeKg: number;
  feeling: string | null;
  streak: number;
  prHighlight: { exerciseName: string; prType: string; value: number } | null;
  reactions: ReactionSummary[];
};

export type IncomingShare = {
  shareId: number;
  programId: number;
  programName: string;
  sharedByUserId: string;
  sharedByName: string;
  sharedByImage: string | null;
  sharedAt: Date;
  alreadyCopied: boolean;
};

export type OutgoingShare = {
  shareId: number;
  sharedWithUserId: string;
  sharedWithName: string;
  sharedWithImage: string | null;
  copiedProgramId: number | null;
  sharedAt: Date;
};

// ============================================================================
// Program Import/Export
// ============================================================================

export type ExportedPrograms = {
  version: 1;
  exportedAt: string;
  programs: ExportedProgram["program"][];
};

// ============================================================================
// Session History Export
// ============================================================================

export type ExportedSessions = {
  version: 1;
  exportedAt: string;
  sessions: Array<{
    id: number;
    date: string;
    startTime: string;
    endTime: string | null;
    notes: string | null;
    feeling: string | null;
    readiness: number | null;
    programName: string | null;
    sets: Array<{
      exerciseName: string;
      setNumber: number;
      targetReps: number | null;
      actualReps: number;
      weightKg: number;
      durationSeconds: number | null;
      distanceMeters: number | null;
      inclinePercent: number | null;
      heartRateZone: number | null;
      rpe: number;
      restTimeSeconds: number;
      isCompleted: boolean;
    }>;
  }>;
};

export type ExportedProgram = {
  version: 1;
  exportedAt: string;
  program: {
    name: string;
    exercises: Array<{
      idx: number;
      notes: string | null;
      incKg: number;
      incReps: number;
      mode: string;
      exercise: {
        name: string;
        category: string;
        area: string | null;
        muscle: string | null;
        equipment: string | null;
        pattern: string | null;
        type: string | null;
      };
      sets: Array<{
        n: number;
        reps: number | null;
        kg: number | null;
        durSec: number | null;
        distM: number | null;
        rest: number;
        type?: string;
        rir?: number | null;
        startDelay?: number | null;
      }>;
    }>;
  };
};
