import { AI_CYCLE_WEEKS, toImportPayload, uniqueProgramNames, validatePlan } from "@/lib/utils/ai-plan";
import {
  buildTemplatePlan,
  TEMPLATE_DAYS,
  TEMPLATE_GOALS,
  TEMPLATE_LEVELS,
  templateDefaults,
  type TemplateEquipment,
  type TemplateParams,
} from "@/lib/utils/plan-templates";
import { importCycleSchema } from "@/lib/validators/training-cycles";
import { importProgramSchema } from "@/lib/validators/workout";
import { describe, expect, it } from "vitest";

const EQUIPMENT: TemplateEquipment[] = ["full_gym", "barbell", "dumbbells", "bodyweight"];
const ALLOWED: Record<TemplateEquipment, string[]> = {
  full_gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "other"],
  barbell: ["barbell", "bodyweight"],
  dumbbells: ["dumbbell", "bodyweight"],
  bodyweight: ["bodyweight", "bands"],
};
const athlete = { bodyWeightKg: 80, sex: "male", lifts: {} };

const combos: TemplateParams[] = TEMPLATE_GOALS.flatMap((goal) =>
  TEMPLATE_LEVELS.flatMap((level) =>
    TEMPLATE_DAYS.flatMap((daysPerWeek) =>
      EQUIPMENT.map((equipment) => ({ goal, level, daysPerWeek, equipment, weeks: 8 as const })),
    ),
  ),
);

describe("buildTemplatePlan — every combination", () => {
  it("covers all 300 picks", () => {
    expect(combos).toHaveLength(300);
  });

  it.each(combos.map((p) => [`${p.goal}/${p.level}/${p.daysPerWeek}d/${p.equipment}`, p] as const))(
    "%s is a valid, importable plan within the equipment",
    (_, params) => {
      const plan = buildTemplatePlan(params, athlete);
      const result = validatePlan(plan, { daysPerWeek: params.daysPerWeek, cycleDurationWeeks: params.weeks });
      expect(result.ok ? [] : result.issues).toEqual([]);

      const payload = toImportPayload(plan);
      expect(importProgramSchema.safeParse(payload).success).toBe(true);
      expect(importCycleSchema.safeParse(payload.cycle).success).toBe(true);

      for (const program of plan.programs) {
        expect(program.exercises.length).toBeGreaterThanOrEqual(4);
        const names = program.exercises.map((e) => e.name);
        expect(new Set(names).size).toBe(names.length);
        for (const ex of program.exercises) expect(ALLOWED[params.equipment]).toContain(ex.equipment);
      }
    },
  );
});

describe("buildTemplatePlan — prescriptions", () => {
  const base: TemplateParams = { goal: "strength", level: "beginner", daysPerWeek: 3, equipment: "full_gym", weeks: 8 };
  const find = (plan: ReturnType<typeof buildTemplatePlan>, name: string) =>
    plan.programs.flatMap((p) => p.exercises).find((e) => e.name === name)!;

  it("runs a beginner full body A/B on Mon/Wed/Fri", () => {
    const plan = buildTemplatePlan(base, athlete);
    expect(plan.programs.map((p) => p.name)).toEqual(["Full Body A", "Full Body B"]);
    expect(plan.cycle!.slots.map((s) => [s.prog, s.day])).toEqual([["Full Body A", 1], ["Full Body B", 3], ["Full Body A", 5]]);
  });

  it("gives an intermediate three days push/pull/legs", () => {
    const plan = buildTemplatePlan({ ...base, level: "intermediate" }, athlete);
    expect(plan.programs.map((p) => p.name)).toEqual(["Push", "Pull", "Legs"]);
  });

  it("uses linear load progression with a warm-up on a beginner's main barbell lift", () => {
    const squat = find(buildTemplatePlan(base, athlete), "Squat");
    expect(squat).toMatchObject({ adv: "load", hits: 1, incKg: 5 });
    expect(squat.sets[0].type).toBe("warmup");
    expect(squat.sets.slice(1).every((s) => s.reps === 5 && s.repMin === null)).toBe(true);
  });

  it("uses double progression with a rep range for hypertrophy work", () => {
    const plan = buildTemplatePlan({ ...base, goal: "muscle_gain", level: "intermediate", daysPerWeek: 4 }, athlete);
    const bench = find(plan, "Bench Press");
    expect(bench.adv).toBe("double");
    expect(bench.sets.filter((s) => s.type === "working").every((s) => s.repMin === 6 && s.repMax === 10)).toBe(true);
  });

  it("starts from the athlete's estimated 1RM when known, else from body weight", () => {
    const known = find(buildTemplatePlan(base, { ...athlete, lifts: { Squat: 140 } }), "Squat");
    expect(known.sets[1].kg).toBe(105); // 75% of 140, to 2.5 kg
    const estimated = find(buildTemplatePlan(base, athlete), "Squat");
    expect(estimated.sets[1].kg).toBe(45); // 80 kg × 1.25 × 0.6 (beginner) × 75%
  });

  it("never drops a barbell below the empty bar", () => {
    const plan = buildTemplatePlan({ ...base, goal: "endurance" }, { bodyWeightKg: 45, sex: "female", lifts: {} });
    for (const ex of plan.programs.flatMap((p) => p.exercises).filter((e) => e.equipment === "barbell")) {
      expect(ex.sets.every((s) => (s.kg ?? 0) >= 20)).toBe(true);
    }
  });

  it("prescribes bodyweight work in reps and holds in seconds", () => {
    const plan = buildTemplatePlan({ ...base, equipment: "bodyweight" }, athlete);
    const pushUp = find(plan, "Push-up");
    expect(pushUp).toMatchObject({ adv: "reps", incReps: 1 });
    expect(pushUp.sets.every((s) => s.kg === 0 && s.reps !== null)).toBe(true);
    const plank = find(plan, "Plank");
    expect(plank.adv).toBe("duration");
    expect(plank.sets.every((s) => s.durSec === 30 && s.reps === null)).toBe(true);
  });

  it("names the cycle from its length and split", () => {
    for (const weeks of AI_CYCLE_WEEKS) {
      const plan = buildTemplatePlan({ ...base, daysPerWeek: 4, weeks }, athlete);
      expect(plan.cycle!.name).toBe(`${weeks}-Week Upper/Lower`);
      expect(plan.cycle!.weeks).toBe(weeks);
    }
  });
});

describe("templateDefaults", () => {
  it("takes the first supported goal and the experience from the profile", () => {
    expect(templateDefaults(["unknown", "muscle_gain", "strength"], "advanced")).toEqual({ goal: "muscle_gain", level: "advanced" });
    expect(templateDefaults([], null)).toEqual({ goal: "general_fitness", level: "beginner" });
  });
});

describe("uniqueProgramNames", () => {
  it("renames clashing programs and their cycle slots", () => {
    const plan = buildTemplatePlan({ goal: "strength", level: "intermediate", daysPerWeek: 3, equipment: "full_gym", weeks: 8 }, athlete);
    const out = uniqueProgramNames(plan, ["push", "Push 2", "Legs"]);
    expect(out.programs.map((p) => p.name)).toEqual(["Push 3", "Pull", "Legs 2"]);
    expect(out.cycle!.slots.map((s) => s.prog)).toEqual(["Push 3", "Pull", "Legs 2"]);
    expect(validatePlan(out).ok).toBe(true);
  });
});
