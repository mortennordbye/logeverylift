/**
 * Worked examples for AI Setup's multi-shot prompt. Each is a full request →
 * plan exchange, sent as prior user/assistant turns so a weak model sees the
 * whole shape done right instead of inferring it from rules.
 *
 * The two cover different ground on purpose: a weekday schedule with load
 * progression, warm-ups and a timed hold; a rotation with rep ranges,
 * bodyweight reps and an equipment limit. Both must pass `validatePlan` with
 * their own constraints (src/__tests__/ai-plan.test.ts checks this).
 */

import type { AiPlan } from "@/lib/utils/ai-plan";
import type { GenerationInput } from "@/lib/utils/ai-prompt";

export type AiExample = { input: GenerationInput; output: AiPlan };

const set = (
  reps: number | null,
  kg: number | null,
  rest: number,
  extra: Partial<AiPlan["programs"][number]["exercises"][number]["sets"][number]> = {},
): AiPlan["programs"][number]["exercises"][number]["sets"][number] => ({
  type: "working",
  reps,
  kg,
  durSec: null,
  distM: null,
  rest,
  repMin: null,
  repMax: null,
  rir: null,
  ...extra,
});

export const AI_EXAMPLES: AiExample[] = [
  {
    input: {
      request: "I'm new to lifting and want to get stronger. Three days a week at a normal gym.",
      athlete: { experience: "beginner", goals: ["strength"], bodyWeightKg: 80 },
      constraints: { daysPerWeek: 3, equipment: "full_gym", cycleWeeks: 8 },
      currentLifts: [],
      existingPrograms: [],
      exerciseLibrary: [
        "Squat (quads, barbell, squat, compound)",
        "Bench Press (chest, barbell, push, compound)",
        "Barbell Row (back, barbell, pull, compound)",
        "Deadlift (back, barbell, hinge, compound)",
        "Overhead Press (shoulders, barbell, push, compound)",
        "Lat Pulldown (back, cable, pull, compound)",
        "Plank (abs, bodyweight, isometric, isometric)",
      ],
    },
    output: {
      programs: [
        {
          name: "Full Body A",
          exercises: [
            {
              name: "Squat", category: "strength", area: "lower_body", muscle: "quads", equipment: "barbell",
              pattern: "squat", role: "compound", adv: "load", hits: 1, incKg: 2.5, incReps: null,
              sets: [set(5, 30, 60, { type: "warmup" }), set(5, 50, 150), set(5, 50, 150), set(5, 50, 150)],
            },
            {
              name: "Bench Press", category: "strength", area: "upper_body", muscle: "chest", equipment: "barbell",
              pattern: "push", role: "compound", adv: "load", hits: 1, incKg: 2.5, incReps: null,
              sets: [set(5, 20, 60, { type: "warmup" }), set(5, 40, 120), set(5, 40, 120), set(5, 40, 120)],
            },
            {
              name: "Barbell Row", category: "strength", area: "upper_body", muscle: "back", equipment: "barbell",
              pattern: "pull", role: "compound", adv: "load", hits: 1, incKg: 2.5, incReps: null,
              sets: [set(8, 40, 90), set(8, 40, 90), set(8, 40, 90)],
            },
            {
              name: "Plank", category: "strength", area: "core", muscle: "abs", equipment: "bodyweight",
              pattern: "isometric", role: "isometric", adv: "duration", hits: 2, incKg: null, incReps: null,
              sets: [set(null, 0, 60, { durSec: 30 }), set(null, 0, 60, { durSec: 30 })],
            },
          ],
        },
        {
          name: "Full Body B",
          exercises: [
            {
              name: "Deadlift", category: "strength", area: "lower_body", muscle: "back", equipment: "barbell",
              pattern: "hinge", role: "compound", adv: "load", hits: 1, incKg: 5, incReps: null,
              sets: [set(5, 40, 60, { type: "warmup" }), set(5, 60, 180), set(5, 60, 180)],
            },
            {
              name: "Overhead Press", category: "strength", area: "upper_body", muscle: "shoulders", equipment: "barbell",
              pattern: "push", role: "compound", adv: "load", hits: 1, incKg: 2.5, incReps: null,
              sets: [set(5, 25, 120), set(5, 25, 120), set(5, 25, 120)],
            },
            {
              name: "Lat Pulldown", category: "strength", area: "upper_body", muscle: "back", equipment: "cable",
              pattern: "pull", role: "accessory", adv: "double", hits: 1, incKg: 2.5, incReps: null,
              sets: [
                set(8, 40, 90, { repMin: 8, repMax: 12 }),
                set(8, 40, 90, { repMin: 8, repMax: 12 }),
                set(8, 40, 90, { repMin: 8, repMax: 12 }),
              ],
            },
          ],
        },
      ],
      cycle: {
        name: "8-Week Beginner Strength",
        weeks: 8,
        sched: "day_of_week",
        slots: [
          { prog: "Full Body A", day: 1, idx: null, label: null, auto: false },
          { prog: "Full Body B", day: 3, idx: null, label: null, auto: false },
          { prog: "Full Body A", day: 5, idx: null, label: null, auto: false },
        ],
      },
    },
  },
  {
    input: {
      request: "Build muscle with an upper/lower split. Home gym, dumbbells only, about four sessions a week whenever I can fit them in.",
      athlete: { experience: "intermediate", goals: ["muscle_gain"], bodyWeightKg: 72 },
      constraints: { equipment: "dumbbells", cycleWeeks: 6 },
      currentLifts: [{ exercise: "Dumbbell Bench Press", maxKg: 30 }],
      existingPrograms: [],
      exerciseLibrary: [
        "Dumbbell Bench Press (chest, dumbbell, push, compound)",
        "Dumbbell Row (back, dumbbell, pull, compound)",
        "Dumbbell Lateral Raise (shoulders, dumbbell, push, isolation)",
        "Push-up (chest, bodyweight, push, compound)",
        "Goblet Squat (quads, dumbbell, squat, compound)",
        "Bulgarian Split Squat (quads, dumbbell, squat, compound)",
        "Romanian Deadlift (hamstrings, barbell, hinge, compound)",
        "Side Plank (abs, bodyweight, isometric, isometric)",
      ],
    },
    output: {
      programs: [
        {
          name: "Upper",
          exercises: [
            {
              name: "Dumbbell Bench Press", category: "strength", area: "upper_body", muscle: "chest", equipment: "dumbbell",
              pattern: "push", role: "compound", adv: "double", hits: 1, incKg: 2, incReps: null,
              sets: [
                set(8, 22, 120, { repMin: 8, repMax: 12 }),
                set(8, 22, 120, { repMin: 8, repMax: 12 }),
                set(8, 22, 120, { repMin: 8, repMax: 12 }),
              ],
            },
            {
              name: "Dumbbell Row", category: "strength", area: "upper_body", muscle: "back", equipment: "dumbbell",
              pattern: "pull", role: "compound", adv: "double", hits: 1, incKg: 2, incReps: null,
              sets: [
                set(10, 24, 90, { repMin: 10, repMax: 15 }),
                set(10, 24, 90, { repMin: 10, repMax: 15 }),
                set(10, 24, 90, { repMin: 10, repMax: 15 }),
              ],
            },
            {
              name: "Dumbbell Lateral Raise", category: "strength", area: "upper_body", muscle: "shoulders", equipment: "dumbbell",
              pattern: "push", role: "isolation", adv: "double", hits: 1, incKg: 1, incReps: null,
              sets: [
                set(12, 8, 60, { repMin: 12, repMax: 20 }),
                set(12, 8, 60, { repMin: 12, repMax: 20 }),
                set(12, 8, 60, { repMin: 12, repMax: 20 }),
              ],
            },
            {
              name: "Push-up", category: "strength", area: "upper_body", muscle: "chest", equipment: "bodyweight",
              pattern: "push", role: "accessory", adv: "reps", hits: 2, incKg: null, incReps: 1,
              sets: [set(15, 0, 60), set(15, 0, 60)],
            },
          ],
        },
        {
          name: "Lower",
          exercises: [
            {
              name: "Goblet Squat", category: "strength", area: "lower_body", muscle: "quads", equipment: "dumbbell",
              pattern: "squat", role: "compound", adv: "double", hits: 1, incKg: 2, incReps: null,
              sets: [
                set(10, 26, 120, { repMin: 10, repMax: 15 }),
                set(10, 26, 120, { repMin: 10, repMax: 15 }),
                set(10, 26, 120, { repMin: 10, repMax: 15 }),
              ],
            },
            {
              name: "Romanian Deadlift", category: "strength", area: "lower_body", muscle: "hamstrings", equipment: "dumbbell",
              pattern: "hinge", role: "compound", adv: "double", hits: 1, incKg: 2, incReps: null,
              sets: [
                set(10, 24, 90, { repMin: 10, repMax: 15 }),
                set(10, 24, 90, { repMin: 10, repMax: 15 }),
                set(10, 24, 90, { repMin: 10, repMax: 15 }),
              ],
            },
            {
              name: "Bulgarian Split Squat", category: "strength", area: "lower_body", muscle: "quads", equipment: "dumbbell",
              pattern: "squat", role: "accessory", adv: "double", hits: 1, incKg: 2, incReps: null,
              sets: [
                set(8, 12, 90, { repMin: 8, repMax: 12 }),
                set(8, 12, 90, { repMin: 8, repMax: 12 }),
              ],
            },
            {
              name: "Side Plank", category: "strength", area: "core", muscle: "abs", equipment: "bodyweight",
              pattern: "isometric", role: "isometric", adv: "duration", hits: 2, incKg: null, incReps: null,
              sets: [set(null, 0, 45, { durSec: 30 }), set(null, 0, 45, { durSec: 30 })],
            },
          ],
        },
      ],
      cycle: {
        name: "6-Week Upper/Lower",
        weeks: 6,
        sched: "rotation",
        slots: [
          { prog: "Upper", day: null, idx: 1, label: "A", auto: false },
          { prog: "Lower", day: null, idx: 2, label: "B", auto: false },
        ],
      },
    },
  },
];
