import { AI_CYCLE_WEEKS, toImportPayload, uniqueProgramNames, validatePlan } from "@/lib/utils/ai-plan";
import {
  AVOID_AREAS,
  buildTemplatePlan,
  estimateSessionMinutes,
  PRIORITY_MUSCLES,
  SESSION_MINUTES,
  splitSupports,
  TEMPLATE_DAYS,
  TEMPLATE_GOALS,
  TEMPLATE_LEVELS,
  TEMPLATE_SPLITS,
  templateDefaults,
  type AvoidArea,
  type PriorityMuscle,
  type TemplateEquipment,
  type TemplateParams,
} from "@/lib/utils/plan-templates";
import { createHash } from "crypto";
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

describe("buildTemplatePlan — default picks", () => {
  // Fingerprint of every base combination for two athletes, taken before
  // session length, split, priorities and avoid areas were added. Leaving
  // those picks out must keep producing exactly these plans. If a change is
  // meant to alter them, bump TEMPLATE_VERSION and update the hash.
  it("are unchanged by the optional picks", () => {
    const athletes = [athlete, { bodyWeightKg: 60, sex: "female", lifts: { Squat: 100, "Bench Press": 60 } }];
    const plans = athletes.flatMap((a) => combos.map((p) => buildTemplatePlan(p, a)));
    expect(createHash("sha256").update(JSON.stringify(plans)).digest("hex")).toBe(
      "aee61168050f785b7afb7ab96af5bba8ba05d319410f91e940073234c87cd33b",
    );
  });
});

const subsets = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

// Exercises each avoid area must keep out of the plan.
const STRESSES: Record<AvoidArea, string[]> = {
  knees: ["Squat", "Front Squat", "Goblet Squat", "Bulgarian Split Squat", "Reverse Lunge", "Step-up", "Leg Extension", "Wall Sit"],
  shoulders: ["Overhead Press", "Dumbbell Shoulder Press", "Pike Push-up", "Dip", "Upright Row"],
  lower_back: ["Squat", "Deadlift", "Romanian Deadlift", "Barbell Row"],
};

describe("buildTemplatePlan — session length, split and avoid areas", () => {
  it("every combination is valid, importable, within equipment and time, and spares avoided joints", () => {
    const failures: string[] = [];
    let built = 0;
    for (const base of combos) {
      for (const sessionMinutes of SESSION_MINUTES) {
        for (const split of TEMPLATE_SPLITS) {
          if (!splitSupports(split, base.daysPerWeek)) continue;
          for (const avoid of subsets(AVOID_AREAS)) {
            const params: TemplateParams = { ...base, sessionMinutes, split, avoid };
            const label = `${base.goal}/${base.level}/${base.daysPerWeek}d/${base.equipment}/${sessionMinutes}min/${split}/${avoid.join("+") || "-"}`;
            const plan = buildTemplatePlan(params, athlete);
            built++;
            const result = validatePlan(plan, { daysPerWeek: base.daysPerWeek, cycleDurationWeeks: base.weeks });
            if (!result.ok) failures.push(`${label}: ${result.issues[0]}`);
            const payload = toImportPayload(plan);
            if (!importProgramSchema.safeParse(payload).success) failures.push(`${label}: import schema`);
            const banned = new Set(avoid.flatMap((a) => STRESSES[a]));
            for (const program of plan.programs) {
              const minutes = estimateSessionMinutes(program.exercises);
              if (minutes > sessionMinutes) failures.push(`${label} ${program.name}: ${minutes.toFixed(1)} min`);
              const floor = sessionMinutes <= 45 ? 3 : 4;
              if (program.exercises.length < floor) failures.push(`${label} ${program.name}: ${program.exercises.length} exercises`);
              for (const ex of program.exercises) {
                if (!ALLOWED[base.equipment].includes(ex.equipment)) failures.push(`${label}: ${ex.name} needs ${ex.equipment}`);
                if (banned.has(ex.name)) failures.push(`${label}: ${ex.name} loads an avoided joint`);
              }
            }
          }
        }
      }
    }
    // 60 base combos per day count × 13 valid (days, split) pairs × 4 lengths × 8 avoid subsets.
    expect(built).toBe(60 * 13 * 4 * 8);
    expect(failures.slice(0, 10)).toEqual([]);
  }, 60_000);

  const base: TemplateParams = { goal: "strength", level: "intermediate", daysPerWeek: 4, equipment: "full_gym", weeks: 8 };
  const names = (plan: ReturnType<typeof buildTemplatePlan>) => plan.programs.flatMap((p) => p.exercises.map((e) => e.name));

  it("caps rest in short sessions, main lifts keeping the most", () => {
    const plan = buildTemplatePlan({ ...base, sessionMinutes: 30 }, athlete);
    const bench = plan.programs[0].exercises.find((e) => e.name === "Bench Press")!;
    expect(bench.sets.filter((s) => s.type === "working").every((s) => s.rest === 120)).toBe(true);
    for (const ex of plan.programs.flatMap((p) => p.exercises).filter((e) => e.role !== "compound")) {
      expect(ex.sets.every((s) => s.rest <= 60)).toBe(true);
    }
  });

  it("adds a set to accessory and isolation work in 90-minute sessions", () => {
    const curl = (p: TemplateParams) =>
      buildTemplatePlan(p, athlete).programs[0].exercises.find((e) => e.name === "Dumbbell Curl")!.sets.length;
    expect(curl({ ...base, sessionMinutes: 90 })).toBe(curl(base) + 1);
  });

  it("drops cheap work before touching the main lifts", () => {
    const full = buildTemplatePlan(base, athlete).programs[0].exercises.map((e) => e.name);
    const short = buildTemplatePlan({ ...base, sessionMinutes: 30 }, athlete).programs[0].exercises.map((e) => e.name);
    expect(short.length).toBeLessThan(full.length);
    expect(short.slice(0, 2)).toEqual(["Bench Press", "Barbell Row"]);
  });

  it("builds explicit splits on their own days", () => {
    const slots = (p: TemplateParams) => buildTemplatePlan(p, athlete).cycle!.slots.map((s) => [s.prog, s.day]);
    expect(slots({ ...base, split: "full_body" })).toEqual([["Full Body A", 1], ["Full Body B", 2], ["Full Body A", 4], ["Full Body B", 5]]);
    expect(slots({ ...base, daysPerWeek: 2, split: "upper_lower" })).toEqual([["Upper A", 1], ["Lower A", 4]]);
    expect(slots({ ...base, daysPerWeek: 6, split: "upper_lower" }).map(([p]) => p)).toEqual(
      ["Upper A", "Lower A", "Upper B", "Lower B", "Upper A", "Lower A"],
    );
    expect(slots({ ...base, daysPerWeek: 3, split: "ppl" })).toEqual([["Push", 1], ["Pull", 3], ["Legs", 5]]);
    expect(buildTemplatePlan({ ...base, daysPerWeek: 3, split: "ppl" }, athlete).cycle!.name).toBe("8-Week Push/Pull/Legs");
  });

  it("refuses a split the days can't hold", () => {
    expect(splitSupports("ppl", 4)).toBe(false);
    expect(splitSupports("auto", 5)).toBe(true);
    expect(() => buildTemplatePlan({ ...base, split: "ppl" }, athlete)).toThrow();
  });

  it("swaps in joint-friendly exercises rather than dropping the slot", () => {
    expect(names(buildTemplatePlan({ ...base, avoid: ["knees"] }, athlete))).toContain("Leg Press");
    expect(names(buildTemplatePlan({ ...base, avoid: ["shoulders"] }, athlete))).toContain("Landmine Press");
    const back = names(buildTemplatePlan({ ...base, avoid: ["lower_back"] }, athlete));
    expect(back).toContain("Seated Cable Row");
    expect(back).toContain("Hip Thrust");
  });
});

const PRIORITY_MUSCLE_GROUPS: Record<PriorityMuscle, string[]> = {
  chest: ["chest"],
  back: ["back"],
  shoulders: ["shoulders"],
  arms: ["biceps", "triceps"],
  glutes: ["glutes"],
  quads: ["quads"],
  hamstrings: ["hamstrings"],
};

describe("buildTemplatePlan — priority muscles", () => {
  const pairs = PRIORITY_MUSCLES.flatMap((a, i) => [[a], ...PRIORITY_MUSCLES.slice(i + 1).map((b) => [a, b])]) as PriorityMuscle[][];
  const sample = combos.filter((p) => p.equipment !== "barbell");
  const workingSetsFor = (plan: ReturnType<typeof buildTemplatePlan>, muscle: PriorityMuscle) =>
    plan.programs
      .flatMap((p) => p.exercises)
      .filter((e) => PRIORITY_MUSCLE_GROUPS[muscle].includes(e.muscle))
      .reduce((n, e) => n + e.sets.filter((s) => s.type === "working").length, 0);

  it("every single muscle and pair adds volume and stays valid", () => {
    const failures: string[] = [];
    for (const priorities of pairs) {
      for (const base of sample) {
        const label = `${priorities.join("+")} ${base.goal}/${base.level}/${base.daysPerWeek}d/${base.equipment}`;
        const plain = buildTemplatePlan(base, athlete);
        const plan = buildTemplatePlan({ ...base, priorities }, athlete);
        const result = validatePlan(plan, { daysPerWeek: base.daysPerWeek, cycleDurationWeeks: base.weeks });
        if (!result.ok) failures.push(`${label}: ${result.issues[0]}`);
        for (const muscle of priorities) {
          if (workingSetsFor(plan, muscle) <= workingSetsFor(plain, muscle)) failures.push(`${label}: no extra ${muscle} volume`);
        }
        const timed = buildTemplatePlan({ ...base, priorities, sessionMinutes: 30 }, athlete);
        for (const program of timed.programs) {
          if (estimateSessionMinutes(program.exercises) > 30) failures.push(`${label} ${program.name}: over 30 min`);
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }, 60_000);

  it("adds an isolation slot before core work", () => {
    const plan = buildTemplatePlan(
      { goal: "muscle_gain", level: "intermediate", daysPerWeek: 3, equipment: "full_gym", weeks: 8, split: "full_body", priorities: ["chest"] },
      athlete,
    );
    const a = plan.programs[0].exercises.map((e) => e.name);
    expect(a.indexOf("Cable Fly")).toBe(a.length - 2);
    expect(a[a.length - 1]).toBe("Plank");
  });

  it("adds a set where the slot already exists", () => {
    const p: TemplateParams = { goal: "muscle_gain", level: "intermediate", daysPerWeek: 4, equipment: "full_gym", weeks: 8 };
    const curls = (plan: ReturnType<typeof buildTemplatePlan>) =>
      plan.programs[0].exercises.find((e) => e.name === "Dumbbell Curl")!.sets.length;
    expect(curls(buildTemplatePlan({ ...p, priorities: ["arms"] }, athlete))).toBe(curls(buildTemplatePlan(p, athlete)) + 1);
  });
});
