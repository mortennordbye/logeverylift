import { PHASE_TYPES, RACE_DISCIPLINES, RACE_PRIORITIES, TRI_DISTANCES } from "@/db/schema";
import { z } from "zod";

/** Seasons, races and phases (docs/plans/seasons.md). Limits match src/lib/seasons.ts. */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const id = z.number().int().positive();
const text = z.string().trim().max(500);

export const seasonFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  goal: text.nullable().optional(),
  startDate: day,
  endDate: day,
  nextGoal: text.nullable().optional(),
});

const raceFields = z.object({
  name: z.string().trim().min(1).max(100),
  raceDate: day,
  discipline: z.enum(RACE_DISCIPLINES),
  distance: z.enum(TRI_DISTANCES).nullable().optional(),
  distanceMeters: z.number().int().min(100).max(1_000_000).nullable().optional(),
  priority: z.enum(RACE_PRIORITIES),
});

/** New season (docs/plans/plan-tab-redesign.md, P4): an optional first race, and cycles to add as its phases, in order. */
export const createSeasonSchema = seasonFieldsSchema
  .extend({
    race: raceFields.optional(),
    cycleIds: z
      .array(id)
      .max(30)
      .refine((ids) => new Set(ids).size === ids.length, "Pick each cycle once.")
      .optional(),
    /** The user confirmed the first phase takes the scheduled start (addPhase `takeStart`). */
    takeStart: z.boolean().optional(),
  })
  .refine((s) => s.endDate >= s.startDate, {
    message: "The season must end on or after its start",
    path: ["endDate"],
  });

export const updateSeasonSchema = seasonFieldsSchema.partial().extend({ seasonId: id });

export const seasonIdSchema = z.object({ seasonId: id });

export const addRaceSchema = raceFields.extend({ seasonId: id });
export const updateRaceSchema = raceFields.partial().extend({ seasonId: id, raceId: id });
export const removeRaceSchema = z.object({ seasonId: id, raceId: id });

const length = {
  durationWeeks: z.number().int().min(1).max(52).optional(),
  durationDays: z.number().int().min(1).max(364).nullable().optional(),
};

export const addPhaseSchema = z
  .object({
    seasonId: id,
    cycleId: id.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    scheduleType: z.enum(["day_of_week", "rotation"]).optional(),
    position: z.number().int().positive().optional(),
    phaseType: z.enum(PHASE_TYPES).nullable().optional(),
    takeStart: z.boolean().optional(),
    ...length,
  })
  .refine((p) => p.cycleId != null || !!p.name, { message: "Pick a cycle or name a new one", path: ["name"] });

export const phaseSchema = z.object({ seasonId: id, cycleId: id });
export const movePhaseSchema = phaseSchema.extend({ position: z.number().int().positive() });
export const setPhaseSchema = phaseSchema.extend({ phaseType: z.enum(PHASE_TYPES).nullable().optional(), ...length });
