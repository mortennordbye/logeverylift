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
]);

export const plannedRangeSchema = z.object({ from: day, to: day, cycleId: id.optional() });
