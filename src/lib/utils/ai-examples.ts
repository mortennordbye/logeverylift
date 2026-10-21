/**
 * Worked examples for AI edits, sent as prior user/assistant turns so a weak
 * model sees a whole edit done right: the plan comes back complete, with only
 * the requested change, and loads left null.
 *
 * The plans are built by the template builder, so they always match what a
 * real request carries. Two edits on purpose: one swaps an exercise in place,
 * one adds an exercise to every session. src/__tests__/ai-plan.test.ts checks
 * that each output passes `validatePlan` and changes only what was asked.
 */

import type { AiPlan } from "@/lib/utils/ai-plan";
import type { EditInput } from "@/lib/utils/ai-prompt";
import { buildTemplatePlan, stripWeights, type TemplateParams } from "@/lib/utils/plan-templates";

export type AiEditExample = { input: EditInput; output: AiPlan };

type PlanExercise = AiPlan["programs"][number]["exercises"][number];

const athlete = { bodyWeightKg: 80, sex: "male", lifts: {} };

function basePlan(picks: TemplateParams): AiPlan {
  return stripWeights(buildTemplatePlan(picks, athlete));
}

function editInput(picks: TemplateParams, request: string[], allowedExercises: string[], plan: AiPlan): EditInput {
  return {
    athlete: { ageBand: "25_34", gender: "male", goals: [picks.goal], experience: picks.level },
    picks: {
      daysPerWeek: picks.daysPerWeek,
      equipment: picks.equipment,
      cycleWeeks: picks.weeks,
      sessionMinutes: picks.sessionMinutes ?? null,
      priorityMuscles: picks.priorities ?? [],
      avoidJoints: picks.avoid ?? [],
    },
    request,
    allowedExercises,
    plan,
  };
}

const swapPicks: TemplateParams = { goal: "general_fitness", level: "beginner", daysPerWeek: 2, equipment: "full_gym", weeks: 8 };
const swapBase = basePlan(swapPicks);
const swapOutput: AiPlan = {
  ...swapBase,
  programs: swapBase.programs.map((program) => ({
    ...program,
    exercises: program.exercises.map(
      (exercise): PlanExercise =>
        exercise.name === "Barbell Row" ? { ...exercise, name: "Seated Cable Row", equipment: "cable", incKg: 2.5 } : exercise,
    ),
  })),
};

const finisherPicks: TemplateParams = { goal: "weight_loss", level: "beginner", daysPerWeek: 3, equipment: "bodyweight", weeks: 4 };
const finisherBase = basePlan(finisherPicks);
const burpees: PlanExercise = {
  name: "Burpee", category: "strength", area: "full_body", muscle: "full_body", equipment: "bodyweight",
  pattern: "push", role: "plyometric", adv: "duration", hits: 2, incKg: null, incReps: null,
  sets: [{ type: "working", reps: null, kg: 0, durSec: 300, distM: null, rest: 0, repMin: null, repMax: null, rir: null }],
};
const finisherOutput: AiPlan = {
  ...finisherBase,
  programs: finisherBase.programs.map((program) => ({ ...program, exercises: [...program.exercises, burpees] })),
};

export const AI_EDIT_EXAMPLES: AiEditExample[] = [
  {
    input: editInput(
      swapPicks,
      [
        "Replace the exercises the athlete names in their note with alternatives that train the same muscles.",
        'The athlete\'s note: "no barbell rows please"',
      ],
      [
        "Squat (quads, barbell, squat, compound)",
        "Bench Press (chest, barbell, push, compound)",
        "Barbell Row (back, barbell, pull, compound)",
        "Seated Cable Row (back, cable, pull, compound)",
        "Lat Pulldown (back, cable, pull, compound)",
        "Romanian Deadlift (hamstrings, barbell, hinge, compound)",
        "Plank (abs, bodyweight, isometric, isometric)",
      ],
      swapBase,
    ),
    output: swapOutput,
  },
  {
    input: editInput(
      finisherPicks,
      ["Add a short cardio finisher (5 to 10 minutes) as the last exercise of each session."],
      [
        "Push-up (chest, bodyweight, push, compound)",
        "Inverted Row (back, bodyweight, pull, compound)",
        "Bulgarian Split Squat (quads, bodyweight, squat, compound)",
        "Burpee (full_body, bodyweight, push, plyometric)",
        "Plank (abs, bodyweight, isometric, isometric)",
      ],
      finisherBase,
    ),
    output: finisherOutput,
  },
];
