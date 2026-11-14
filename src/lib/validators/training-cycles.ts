import { z } from "zod";

const endActionEnum = z.enum(["deload", "new_cycle", "rest", "none"]);
const scheduleTypeEnum = z.enum(["day_of_week", "rotation"]);
const statusEnum = z.enum(["draft", "active", "completed"]);

/** The block lengths the triathlon generator rounds to. A cycle itself can be any length in the range below. */
export const CYCLE_DURATION_WEEKS = [4, 6, 8, 10, 12, 16, 24, 36, 52];

/** A cycle is a whole number of weeks in this range, the same as a season phase. */
export const MIN_CYCLE_WEEKS = 1;
export const MAX_CYCLE_WEEKS = 52;

const durationWeeks = z
  .number()
  .int()
  .min(MIN_CYCLE_WEEKS, `A cycle is ${MIN_CYCLE_WEEKS} to ${MAX_CYCLE_WEEKS} weeks.`)
  .max(MAX_CYCLE_WEEKS, `A cycle is ${MIN_CYCLE_WEEKS} to ${MAX_CYCLE_WEEKS} weeks.`);

export const createTrainingCycleSchema = z.object({
  name: z.string().min(1).max(100),
  durationWeeks,
  scheduleType: scheduleTypeEnum.default("day_of_week"),
  endAction: endActionEnum.default("none"),
  endMessage: z.string().max(500).optional(),
});

export const updateTrainingCycleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  durationWeeks: durationWeeks.optional(),
  endAction: endActionEnum.optional(),
  endMessage: z.string().max(500).nullable().optional(),
  status: statusEnum.optional(),
  raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  raceDistance: z.enum(["full", "half"]).nullable().optional(),
});

export const upsertCycleSlotSchema = z.object({
  trainingCycleId: z.number().int().positive(),
  // day_of_week mode: 1=Mon…7=Sun
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  // rotation mode: 1, 2, 3…
  orderIndex: z.number().int().positive().optional(),
  // day_of_week mode: the session's order in the day, 1-3 (docs/plans/sessions.md, 3.1)
  daySlot: z.number().int().min(1).max(3).optional(),
  // null clears the label or the note.
  label: z.string().max(100).nullable().optional(),
  programId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // Day tracked outside the app: completes itself (see autoCompleteDue).
  autoComplete: z.boolean().optional(),
  // Endurance features only: a key session, and the next slot of the day as the run of a brick.
  priority: z.enum(["key", "support", "optional"]).nullable().optional(),
  brickWithNext: z.boolean().optional(),
});

export const startTrainingCycleSchema = z.object({
  cycleId: z.number().int().positive(),
  // The block's first day; today when omitted. A later day schedules the draft.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const reorderCycleSlotsSchema = z.object({
  cycleId: z.number().int().positive(),
  orderedIds: z.array(z.number().int().positive()),
});

export const importCycleSchema = z.object({
  name: z.string().min(1).max(100),
  weeks: durationWeeks,
  sched: scheduleTypeEnum.default("day_of_week"),
  endAction: endActionEnum.optional(),
  endMessage: z.string().max(500).optional(),
  slots: z.array(z.object({
    prog: z.string().min(1).max(100),
    day: z.number().int().min(1).max(7).optional(),
    idx: z.number().int().positive().optional(),
    label: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
    // Day tracked outside the app: completes itself (see autoCompleteDue).
    auto: z.boolean().optional(),
  })).min(1).max(20),
});

export type ImportCycleInput = z.infer<typeof importCycleSchema>;
