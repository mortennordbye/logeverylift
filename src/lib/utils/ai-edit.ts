/**
 * AI edits of a built plan: the request catalogue, the generic profile sent
 * with it, and the cache key material.
 *
 * Only coarse, non-identifying profile fields go to a model (an age band,
 * gender, goals and experience), never a name, birth year, body weight or
 * lift. Free models may keep prompts, and the coarse profile is also what
 * lets cached edits be shared between users. Client-safe: no Node imports.
 */

import type { AiPlan } from "@/lib/utils/ai-plan";
import { GOAL_VALUES, type Goal } from "@/lib/utils/goals";
import {
  equipmentAllowed,
  TEMPLATE_VERSION,
  type TemplateEquipment,
  type TemplateParams,
} from "@/lib/utils/plan-templates";

export const EDIT_TEXT_MAX = 200;

/** Ready-made edit requests. None duplicates a pick. */
export const EDIT_CHIPS = [
  {
    id: "more_variety",
    label: "More variety",
    instruction: "Make the training days more varied: where the same exercise repeats across days, use a different variation for the same muscles on one of them.",
  },
  {
    id: "cardio_finisher",
    label: "Cardio finisher",
    instruction: "Add a short cardio finisher (5 to 10 minutes) as the last exercise of each session.",
  },
  {
    id: "mobility_warmup",
    label: "Mobility warm-up",
    instruction: "Add one short mobility or dynamic warm-up exercise at the start of each session.",
  },
  {
    id: "prefer_machines",
    label: "Prefer machines",
    instruction: "Prefer machines and cables over free weights wherever a good machine or cable alternative exists for the same muscles.",
  },
  {
    id: "fewer_exercises",
    label: "Fewer exercises, more sets",
    instruction: "Use fewer exercises per session and give the remaining ones more sets, keeping roughly the same total work.",
  },
  {
    id: "swap_named",
    label: "Swap exercises I name",
    instruction: "Replace the exercises the athlete names in their note with alternatives that train the same muscles.",
    needsText: true,
  },
] as const satisfies readonly { id: string; label: string; instruction: string; needsText?: boolean }[];

export type EditChipId = (typeof EDIT_CHIPS)[number]["id"];
export const EDIT_CHIP_IDS = EDIT_CHIPS.map((chip) => chip.id) as [EditChipId, ...EditChipId[]];

export const AGE_BANDS = ["under_25", "25_34", "35_44", "45_54", "55_64", "65_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number] | "unspecified";

export function ageBand(birthYear: number | null, year: number): AgeBand {
  if (!birthYear || birthYear > year) return "unspecified";
  const age = year - birthYear;
  if (age < 25) return "under_25";
  if (age < 35) return "25_34";
  if (age < 45) return "35_44";
  if (age < 55) return "45_54";
  if (age < 65) return "55_64";
  return "65_plus";
}

/** What a model may know about the athlete. */
export type GenericProfile = {
  ageBand: AgeBand;
  gender: "male" | "female" | "other" | "unspecified";
  goals: Goal[];
  experience: "beginner" | "intermediate" | "advanced" | "unspecified";
};

export function genericProfile(
  user: { birthYear: number | null; gender: string | null; goals: Goal[]; experienceLevel: string | null },
  year: number,
): GenericProfile {
  const gender = user.gender === "male" || user.gender === "female" || user.gender === "other" ? user.gender : "unspecified";
  const experience =
    user.experienceLevel === "beginner" || user.experienceLevel === "intermediate" || user.experienceLevel === "advanced"
      ? user.experienceLevel
      : "unspecified";
  return {
    ageBand: ageBand(user.birthYear, year),
    gender,
    goals: GOAL_VALUES.filter((g) => user.goals.includes(g)),
    experience,
  };
}

/** Lowercased, trimmed, whitespace collapsed, trailing punctuation dropped. */
export function normalizeEditText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.!?,;:]+$/, "");
}

export type EditRequest = { chips: EditChipId[]; text: string };

/** The request in a fixed form: chips in catalogue order, text normalized. */
export function normalizeEditRequest(request: EditRequest): EditRequest {
  return {
    chips: EDIT_CHIP_IDS.filter((id) => request.chips.includes(id)),
    text: normalizeEditText(request.text),
  };
}

/**
 * Everything an edit result depends on, in a fixed order, for hashing into
 * the cache key. Two requests with the same material get the same plan.
 */
export function editCacheMaterial(profile: GenericProfile, picks: TemplateParams, request: EditRequest): string {
  const edit = normalizeEditRequest(request);
  return JSON.stringify({
    v: TEMPLATE_VERSION,
    profile: { ageBand: profile.ageBand, gender: profile.gender, goals: [...profile.goals].sort(), experience: profile.experience },
    picks: {
      goal: picks.goal,
      level: picks.level,
      daysPerWeek: picks.daysPerWeek,
      equipment: picks.equipment,
      weeks: picks.weeks,
      sessionMinutes: picks.sessionMinutes ?? null,
      split: picks.split ?? "auto",
      priorities: [...(picks.priorities ?? [])].sort(),
      avoid: [...(picks.avoid ?? [])].sort(),
    },
    edit,
  });
}

/** The request as instructions for the model. */
export function editInstructions(request: EditRequest): string[] {
  const lines: string[] = EDIT_CHIPS.filter((chip) => request.chips.includes(chip.id)).map((chip) => chip.instruction);
  const text = request.text.trim();
  if (text) lines.push(`The athlete's note: "${text}"`);
  return lines;
}

/** Problems an edited plan has against the picks, beyond what validatePlan checks. */
export function checkEdit(plan: AiPlan, equipment: TemplateEquipment): string[] {
  const issues: string[] = [];
  for (const program of plan.programs) {
    for (const exercise of program.exercises) {
      if (!equipmentAllowed(equipment, exercise.equipment)) {
        issues.push(`"${program.name}" uses ${exercise.name} (${exercise.equipment}), but the athlete only has: ${equipment.replace("_", " ")}. Pick an exercise for that equipment.`);
      }
    }
  }
  return issues;
}
