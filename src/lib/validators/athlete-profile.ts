/**
 * Input shapes for the athlete profile, thresholds and injuries
 * (docs/plans/athlete-profile.md, 2.1), shared by the Server Actions and the
 * MCP tools. Values are metric; the app converts typed paces before it sends.
 */

import {
  ENDURANCE_LEVELS,
  INJURY_AREAS,
  INJURY_SIDES,
  INJURY_STATUSES,
  STRENGTH_GOALS,
  THRESHOLD_KINDS,
  THRESHOLD_PROTOCOLS,
  THRESHOLD_SOURCES,
} from "@/db/schema/athlete-profile";
import { z } from "zod";

/** A real calendar day as YYYY-MM-DD: "2026-02-30" is refused. */
export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real date");
export const dayOfWeek = z.number().int().min(1).max(7);

export const profileFields = {
  enduranceLevel: z.enum(ENDURANCE_LEVELS).nullable().optional(),
  availableDays: z.array(dayOfWeek).max(7).nullable().optional(),
  hoursPerWeek: z.number().min(1).max(40).nullable().optional(),
  longestDayMinutes: z.number().int().min(30).max(720).nullable().optional(),
  longDay: dayOfWeek.nullable().optional(),
  strengthGoal: z.enum(STRENGTH_GOALS).nullable().optional(),
};

/** Test inputs: seconds, bpm, watts or meters, all positive numbers. */
export const testData = z
  .record(z.string().max(40), z.number().positive().max(100_000))
  .refine((o) => Object.keys(o).length <= 10, "At most 10 test inputs");

export const thresholdFields = {
  kind: z.enum(THRESHOLD_KINDS),
  value: z.number().positive().max(10_000).optional(),
  measuredOn: dateStr.optional(),
  source: z.enum(THRESHOLD_SOURCES),
  protocol: z.enum(THRESHOLD_PROTOCOLS).nullable().optional(),
  testData: testData.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

export const injuryFields = {
  area: z.enum(INJURY_AREAS),
  side: z.enum(INJURY_SIDES).nullable().optional(),
  description: z.string().trim().min(1).max(500),
  avoid: z.string().trim().max(300).nullable().optional(),
  status: z.enum(INJURY_STATUSES),
  startedOn: dateStr.nullable().optional(),
  endedOn: dateStr.nullable().optional(),
};

/** The change set one interview run shares, made by the app when the interview opens. */
export const interviewChangeSet = z
  .string()
  .regex(/^interview:[0-9a-f-]{36}$/)
  .optional();
