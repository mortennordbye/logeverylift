import { AI_CYCLE_WEEKS } from "@/lib/utils/ai-plan";
import { EDIT_CHIP_IDS, EDIT_CHIPS, EDIT_TEXT_MAX } from "@/lib/utils/ai-edit";
import {
  AVOID_AREAS,
  MAX_PRIORITIES,
  PRIORITY_MUSCLES,
  SESSION_MINUTES,
  splitSupports,
  TEMPLATE_DAYS,
  TEMPLATE_GOALS,
  TEMPLATE_LEVELS,
  TEMPLATE_SPLITS,
} from "@/lib/utils/plan-templates";
import { z } from "zod";

const literals = <T extends number>(values: readonly T[]) =>
  z.union(values.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<T>, z.ZodLiteral<T>, ...z.ZodLiteral<T>[]]);

/** AI Setup's picks, as sent from the client. */
export const templateParamsSchema = z
  .object({
    goal: z.enum(TEMPLATE_GOALS),
    level: z.enum(TEMPLATE_LEVELS),
    daysPerWeek: literals(TEMPLATE_DAYS),
    equipment: z.enum(["full_gym", "barbell", "dumbbells", "bodyweight"]),
    weeks: literals(AI_CYCLE_WEEKS),
    sessionMinutes: literals(SESSION_MINUTES).optional(),
    split: z.enum(TEMPLATE_SPLITS).optional(),
    priorities: z.array(z.enum(PRIORITY_MUSCLES)).max(MAX_PRIORITIES).optional(),
    avoid: z.array(z.enum(AVOID_AREAS)).max(AVOID_AREAS.length).optional(),
  })
  .refine((p) => splitSupports(p.split ?? "auto", p.daysPerWeek), {
    message: "That split can't be built for this many days",
    path: ["split"],
  })
  .refine((p) => new Set(p.priorities ?? []).size === (p.priorities ?? []).length, {
    message: "Priority muscles must be different",
    path: ["priorities"],
  })
  .refine((p) => new Set(p.avoid ?? []).size === (p.avoid ?? []).length, {
    message: "Areas to avoid must be different",
    path: ["avoid"],
  });

const needsText = new Set<string>(EDIT_CHIPS.filter((c) => "needsText" in c && c.needsText).map((c) => c.id));

export const editRequestSchema = z
  .object({
    chips: z.array(z.enum(EDIT_CHIP_IDS)).max(EDIT_CHIP_IDS.length),
    text: z.string().max(EDIT_TEXT_MAX),
  })
  .refine((r) => r.chips.length > 0 || r.text.trim().length > 0, {
    message: "Pick a change or describe one",
    path: ["text"],
  })
  .refine((r) => !r.chips.some((id) => needsText.has(id)) || r.text.trim().length > 0, {
    message: "Name the exercises to swap in the note",
    path: ["text"],
  });

export const aiEditSchema = z.object({ picks: templateParamsSchema, request: editRequestSchema });
