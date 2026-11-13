import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
const id = z.number().int().positive();
const position = z.number().int().min(1).max(3);

/** One change to one dated session from the app (docs/plans/sessions.md, 5). */
export const plannedSessionOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move"), id, date: day, position: position.optional() }),
  z.object({ op: z.literal("skip"), id, reason: z.string().max(200).nullable().optional() }),
  z.object({ op: z.literal("unskip"), id }),
  z.object({ op: z.literal("reset"), id }),
  z.object({
    op: z.literal("change"),
    id,
    programId: id.optional(),
    label: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    position: position.optional(),
  }),
  z.object({ op: z.literal("remove"), id }),
  z.object({
    op: z.literal("add"),
    cycleId: id,
    date: day,
    programId: id,
    position: position.optional(),
    label: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
  // Structured workouts and answers, endurance features only (docs/plans/workouts-and-compliance.md, 7).
  // The other session operations (bricks, Garmin picks, unmiss, update from library) are MCP only until the app has a control for them.
  z.object({ op: z.literal("set_workout"), id, workoutId: id }),
  z.object({ op: z.literal("miss"), id, reason: z.string().trim().max(200).nullable().optional() }),
]);

/** "Yes, I did it" from the app (docs/plans/workouts-and-compliance.md, 6.5). */
export const confirmDoneSchema = z.object({
  plannedSessionId: id,
  durationSeconds: z.number().int().min(60).max(86_400),
  distanceMeters: z.number().int().min(0).max(1_000_000).nullable().optional(),
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const severity = z.enum(["mild", "moderate", "severe"]);

/** One change to a sick period from the app (docs/plans/workouts-and-compliance.md, 6.7). */
export const illnessOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), startedOn: day, endedOn: day.nullable().optional(), severity: severity.nullable().optional(), notes: z.string().trim().max(500).nullable().optional() }),
  z.object({
    op: z.literal("update"),
    id,
    startedOn: day.optional(),
    endedOn: day.nullable().optional(),
    severity: severity.nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({ op: z.literal("end"), id, endedOn: day }),
  z.object({ op: z.literal("delete"), id }),
]);

/** One change to a library workout from the app: the step editor waits for C6. */
export const workoutOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("duplicate"), id }),
  z.object({ op: z.literal("rename"), id, name: z.string().trim().min(1).max(80) }),
  z.object({ op: z.literal("delete"), id }),
  z.object({ op: z.literal("restore"), id }),
]);

export const plannedRangeSchema = z.object({ from: day, to: day, cycleId: id.optional() });
