import { z } from "zod";

const endActionEnum = z.enum(["deload", "new_cycle", "rest", "none"]);
const scheduleTypeEnum = z.enum(["day_of_week", "rotation"]);
const statusEnum = z.enum(["draft", "active", "completed"]);

/** Every block length a cycle can have, including the triathlon generator's long blocks. */
export const CYCLE_DURATION_WEEKS = [4, 6, 8, 10, 12, 16, 24, 36, 52];

const durationWeeks = z.number().int().refine((v) => CYCLE_DURATION_WEEKS.includes(v), {
  message: `Duration must be one of ${CYCLE_DURATION_WEEKS.join(", ")} weeks`,
});

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
});

export const upsertCycleSlotSchema = z.object({
  trainingCycleId: z.number().int().positive(),
  // day_of_week mode: 1=Mon…7=Sun
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  // rotation mode: 1, 2, 3…
  orderIndex: z.number().int().positive().optional(),
  label: z.string().max(100).optional(),
  programId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).optional(),
  // Day tracked outside the app: completes itself (see autoCompleteDue).
  autoComplete: z.boolean().optional(),
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
