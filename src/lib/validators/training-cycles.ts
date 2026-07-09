import { z } from "zod";

const endActionEnum = z.enum(["deload", "new_cycle", "rest", "none"]);
const scheduleTypeEnum = z.enum(["day_of_week", "rotation"]);
const statusEnum = z.enum(["draft", "active", "completed"]);

export const createTrainingCycleSchema = z.object({
  name: z.string().min(1).max(100),
  durationWeeks: z.number().int().refine((v) => [4, 6, 8, 10, 12, 16].includes(v), {
    message: "Duration must be 4, 6, 8, 10, 12, or 16 weeks",
  }),
  scheduleType: scheduleTypeEnum.default("day_of_week"),
  endAction: endActionEnum.default("none"),
  endMessage: z.string().max(500).optional(),
});

export const updateTrainingCycleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  durationWeeks: z
    .number()
    .int()
    .refine((v) => [4, 6, 8, 10, 12, 16].includes(v), {
      message: "Duration must be 4, 6, 8, 10, 12, or 16 weeks",
    })
    .optional(),
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
});

export const reorderCycleSlotsSchema = z.object({
  cycleId: z.number().int().positive(),
  orderedIds: z.array(z.number().int().positive()),
});

export const importCycleSchema = z.object({
  name: z.string().min(1).max(100),
  weeks: z.number().int().refine((v) => [4, 6, 8, 10, 12, 16].includes(v), {
    message: "Duration must be 4, 6, 8, 10, 12, or 16 weeks",
  }),
  sched: scheduleTypeEnum.default("day_of_week"),
  endAction: endActionEnum.optional(),
  endMessage: z.string().max(500).optional(),
  slots: z.array(z.object({
    prog: z.string().min(1).max(100),
    day: z.number().int().min(1).max(7).optional(),
    idx: z.number().int().positive().optional(),
    label: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
  })).min(1).max(20),
});

export type ImportCycleInput = z.infer<typeof importCycleSchema>;
