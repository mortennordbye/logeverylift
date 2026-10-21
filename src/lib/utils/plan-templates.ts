/**
 * Pre-built plans: AI Setup's default path. Builds a complete training setup
 * from five picks (goal, experience, days, equipment, weeks) without calling a
 * model — instant, free, and the same AiPlan shape the AI returns, so it goes
 * through the same validation and import. The AI is only for requests these
 * picks can't express.
 *
 * A plan is a split (which sessions on which days), each session a list of
 * movement slots, each slot filled with the first exercise the equipment
 * allows, and every set prescribed from the goal and experience. Starting
 * weights come from the athlete's estimated 1RM on that lift, else from body
 * weight; src/__tests__/plan-templates.test.ts validates every combination.
 */

import type { AiPlan } from "@/lib/utils/ai-plan";
import type { PromptOptions } from "@/lib/utils/ai-prompt";

export const TEMPLATE_GOALS = ["strength", "muscle_gain", "general_fitness", "weight_loss", "endurance"] as const;
export const TEMPLATE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const TEMPLATE_DAYS = [2, 3, 4, 5, 6] as const;

export type TemplateGoal = (typeof TEMPLATE_GOALS)[number];
export type TemplateLevel = (typeof TEMPLATE_LEVELS)[number];
export type TemplateEquipment = NonNullable<PromptOptions["equipment"]>;

export type TemplateParams = {
  goal: TemplateGoal;
  level: TemplateLevel;
  daysPerWeek: (typeof TEMPLATE_DAYS)[number];
  equipment: TemplateEquipment;
  weeks: NonNullable<PromptOptions["cycleDurationWeeks"]>;
};

export type TemplateAthlete = {
  bodyWeightKg: number | null;
  sex: string | null;
  /** Estimated 1RM (or best weight) by exercise name. */
  lifts: Record<string, number>;
};

type Exercise = AiPlan["programs"][number]["exercises"][number];
type PlanSet = Exercise["sets"][number];
type Equip = Exercise["equipment"];
type Role = "main" | "secondary" | "accessory" | "isolation" | "core";

type Candidate = {
  name: string;
  equipment: Equip;
  area: Exercise["area"];
  muscle: Exercise["muscle"];
  pattern: Exercise["pattern"];
  /** Intermediate male 1RM as a fraction of body weight (per hand for dumbbells). */
  ratio: number;
  /** A static hold: prescribed in seconds. */
  hold?: boolean;
};

const c = (
  name: string,
  equipment: Equip,
  area: Exercise["area"],
  muscle: Exercise["muscle"],
  pattern: Exercise["pattern"],
  ratio = 0,
  hold = false,
): Candidate => ({ name, equipment, area, muscle, pattern, ratio, hold });

// Each slot lists exercises best first; the first the equipment allows wins,
// skipping any already used in the same session. Names match the seeded
// exercise library so imports reuse those exercises.
const SLOTS = {
  squat: [
    c("Squat", "barbell", "lower_body", "quads", "squat", 1.25),
    c("Front Squat", "barbell", "lower_body", "quads", "squat", 1.0),
    c("Leg Press", "machine", "lower_body", "quads", "squat", 2.0),
    c("Goblet Squat", "dumbbell", "lower_body", "quads", "squat", 0.35),
    c("Bulgarian Split Squat", "bodyweight", "lower_body", "quads", "squat"),
  ],
  hinge: [
    c("Deadlift", "barbell", "lower_body", "back", "hinge", 1.5),
    c("Romanian Deadlift", "barbell", "lower_body", "hamstrings", "hinge", 1.0),
    c("Romanian Deadlift", "dumbbell", "lower_body", "hamstrings", "hinge", 0.4),
    c("Single-Leg Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
  ],
  hinge_accessory: [
    c("Romanian Deadlift", "barbell", "lower_body", "hamstrings", "hinge", 1.0),
    c("Hip Thrust", "barbell", "lower_body", "glutes", "hinge", 1.3),
    c("Romanian Deadlift", "dumbbell", "lower_body", "hamstrings", "hinge", 0.4),
    c("Single-Leg Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
  ],
  lunge: [
    c("Bulgarian Split Squat", "dumbbell", "lower_body", "quads", "squat", 0.25),
    c("Reverse Lunge", "dumbbell", "lower_body", "glutes", "squat", 0.25),
    c("Bulgarian Split Squat", "bodyweight", "lower_body", "quads", "squat"),
    c("Step-up", "bodyweight", "lower_body", "quads", "squat"),
  ],
  quad_iso: [
    c("Leg Extension", "machine", "lower_body", "quads", "squat", 0.6),
    c("Leg Press", "machine", "lower_body", "quads", "squat", 2.0),
    c("Goblet Squat", "dumbbell", "lower_body", "quads", "squat", 0.35),
    c("Wall Sit", "bodyweight", "lower_body", "quads", "isometric", 0, true),
  ],
  ham_iso: [
    c("Leg Curl", "machine", "lower_body", "hamstrings", "hinge", 0.5),
    c("Nordic Curl", "bodyweight", "lower_body", "hamstrings", "hinge"),
  ],
  calves: [
    c("Calf Raise", "machine", "lower_body", "calves", "squat", 1.0),
    c("Single-Leg Calf Raise", "bodyweight", "lower_body", "calves", "squat"),
  ],
  hpush: [
    c("Bench Press", "barbell", "upper_body", "chest", "push", 1.0),
    c("Dumbbell Bench Press", "dumbbell", "upper_body", "chest", "push", 0.35),
    c("Push-up", "bodyweight", "upper_body", "chest", "push"),
  ],
  hpush_accessory: [
    c("Incline Dumbbell Press", "dumbbell", "upper_body", "chest", "push", 0.3),
    c("Incline Bench Press", "barbell", "upper_body", "chest", "push", 0.85),
    c("Dip", "bodyweight", "upper_body", "chest", "push"),
    c("Decline Push-up", "bodyweight", "upper_body", "chest", "push"),
  ],
  vpush: [
    c("Overhead Press", "barbell", "upper_body", "shoulders", "push", 0.6),
    c("Dumbbell Shoulder Press", "dumbbell", "upper_body", "shoulders", "push", 0.25),
    c("Pike Push-up", "bodyweight", "upper_body", "shoulders", "push"),
  ],
  hpull: [
    c("Barbell Row", "barbell", "upper_body", "back", "pull", 0.8),
    c("Seated Cable Row", "cable", "upper_body", "back", "pull", 0.8),
    c("Dumbbell Row", "dumbbell", "upper_body", "back", "pull", 0.4),
    c("Inverted Row", "bodyweight", "upper_body", "back", "pull"),
  ],
  vpull: [
    c("Lat Pulldown", "cable", "upper_body", "back", "pull", 0.8),
    c("Pull-up", "bodyweight", "upper_body", "back", "pull"),
    c("Chin-up", "bodyweight", "upper_body", "back", "pull"),
  ],
  chest_iso: [
    c("Cable Fly", "cable", "upper_body", "chest", "push", 0.15),
    c("Dumbbell Fly", "dumbbell", "upper_body", "chest", "push", 0.12),
    c("Wide Push-up", "bodyweight", "upper_body", "chest", "push"),
  ],
  side_delt: [
    c("Dumbbell Lateral Raise", "dumbbell", "upper_body", "shoulders", "push", 0.1),
    c("Cable Lateral Raise", "cable", "upper_body", "shoulders", "push", 0.08),
    c("Upright Row", "barbell", "upper_body", "shoulders", "pull", 0.4),
    c("Pike Push-up", "bodyweight", "upper_body", "shoulders", "push"),
  ],
  rear_delt: [
    c("Face Pull", "cable", "upper_body", "shoulders", "pull", 0.25),
    c("Rear Delt Fly", "dumbbell", "upper_body", "shoulders", "pull", 0.08),
    c("Inverted Row", "bodyweight", "upper_body", "back", "pull"),
  ],
  biceps: [
    c("Dumbbell Curl", "dumbbell", "upper_body", "biceps", "pull", 0.15),
    c("Barbell Curl", "barbell", "upper_body", "biceps", "pull", 0.35),
    c("Cable Curl", "cable", "upper_body", "biceps", "pull", 0.3),
    c("Chin-up", "bodyweight", "upper_body", "biceps", "pull"),
  ],
  triceps: [
    c("Tricep Pushdown", "cable", "upper_body", "triceps", "push", 0.35),
    c("Overhead Tricep Extension", "dumbbell", "upper_body", "triceps", "push", 0.15),
    c("Skull Crusher", "barbell", "upper_body", "triceps", "push", 0.35),
    c("Diamond Push-up", "bodyweight", "upper_body", "triceps", "push"),
  ],
  core: [
    c("Plank", "bodyweight", "core", "abs", "isometric", 0, true),
    c("Dead Bug", "bodyweight", "core", "abs", "isometric"),
  ],
  core_dynamic: [
    c("Hanging Leg Raise", "bodyweight", "core", "abs", "rotation"),
    c("Side Plank", "bodyweight", "core", "abs", "isometric", 0, true),
  ],
} satisfies Record<string, Candidate[]>;

type SlotKey = keyof typeof SLOTS;
type Session = { name: string; slots: [SlotKey, Role][] };

const SESSIONS = {
  fullA: { name: "Full Body A", slots: [["squat", "main"], ["hpush", "main"], ["hpull", "secondary"], ["hinge_accessory", "accessory"], ["core", "core"]] },
  fullB: { name: "Full Body B", slots: [["hinge", "main"], ["vpush", "main"], ["vpull", "secondary"], ["lunge", "accessory"], ["core_dynamic", "core"]] },
  upperA: { name: "Upper A", slots: [["hpush", "main"], ["hpull", "main"], ["vpush", "secondary"], ["vpull", "secondary"], ["biceps", "isolation"], ["triceps", "isolation"]] },
  upperB: { name: "Upper B", slots: [["vpush", "main"], ["vpull", "main"], ["hpush_accessory", "secondary"], ["hpull", "secondary"], ["side_delt", "isolation"], ["rear_delt", "isolation"]] },
  lowerA: { name: "Lower A", slots: [["squat", "main"], ["hinge_accessory", "secondary"], ["lunge", "accessory"], ["ham_iso", "isolation"], ["calves", "isolation"], ["core", "core"]] },
  lowerB: { name: "Lower B", slots: [["hinge", "main"], ["squat", "secondary"], ["lunge", "accessory"], ["quad_iso", "isolation"], ["calves", "isolation"], ["core_dynamic", "core"]] },
  push: { name: "Push", slots: [["hpush", "main"], ["vpush", "secondary"], ["hpush_accessory", "accessory"], ["side_delt", "isolation"], ["triceps", "isolation"]] },
  pull: { name: "Pull", slots: [["vpull", "main"], ["hpull", "secondary"], ["rear_delt", "isolation"], ["biceps", "isolation"], ["core_dynamic", "core"]] },
  legs: { name: "Legs", slots: [["squat", "main"], ["hinge_accessory", "secondary"], ["lunge", "accessory"], ["ham_iso", "isolation"], ["calves", "isolation"]] },
} satisfies Record<string, Session>;

type Split = { name: string; sessions: Session[]; days: { session: number; day: number }[] };

function splitFor(days: TemplateParams["daysPerWeek"], level: TemplateLevel): Split {
  const s = SESSIONS;
  switch (days) {
    case 2:
      return { name: "Full Body", sessions: [s.fullA, s.fullB], days: [{ session: 0, day: 1 }, { session: 1, day: 4 }] };
    case 3:
      return level === "beginner"
        ? { name: "Full Body", sessions: [s.fullA, s.fullB], days: [{ session: 0, day: 1 }, { session: 1, day: 3 }, { session: 0, day: 5 }] }
        : { name: "Push/Pull/Legs", sessions: [s.push, s.pull, s.legs], days: [{ session: 0, day: 1 }, { session: 1, day: 3 }, { session: 2, day: 5 }] };
    case 4:
      return {
        name: "Upper/Lower",
        sessions: [s.upperA, s.lowerA, s.upperB, s.lowerB],
        days: [{ session: 0, day: 1 }, { session: 1, day: 2 }, { session: 2, day: 4 }, { session: 3, day: 5 }],
      };
    case 5:
      return {
        name: "Upper/Lower + PPL",
        sessions: [s.upperA, s.lowerA, s.push, s.pull, s.legs],
        days: [{ session: 0, day: 1 }, { session: 1, day: 2 }, { session: 2, day: 4 }, { session: 3, day: 5 }, { session: 4, day: 6 }],
      };
    case 6:
      return {
        name: "Push/Pull/Legs ×2",
        sessions: [s.push, s.pull, s.legs],
        days: [0, 1, 2, 0, 1, 2].map((session, i) => ({ session, day: i + 1 })),
      };
  }
}

const ALLOWED: Record<TemplateEquipment, Equip[]> = {
  full_gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "other"],
  barbell: ["barbell", "bodyweight"],
  dumbbells: ["dumbbell", "bodyweight"],
  bodyweight: ["bodyweight", "bands"],
};

// [sets, repMin, repMax, rest] per role. Loaded "main" lifts on a strength
// goal run fixed reps with load progression; everything else a rep range.
type Scheme = { sets: number; repMin: number; repMax: number; rest: number };
const SCHEMES: Record<TemplateGoal, Record<Role, Scheme>> = {
  strength: {
    main: { sets: 3, repMin: 5, repMax: 5, rest: 180 },
    secondary: { sets: 3, repMin: 6, repMax: 10, rest: 120 },
    accessory: { sets: 3, repMin: 8, repMax: 12, rest: 90 },
    isolation: { sets: 2, repMin: 10, repMax: 15, rest: 60 },
    core: { sets: 2, repMin: 8, repMax: 12, rest: 60 },
  },
  muscle_gain: {
    main: { sets: 3, repMin: 6, repMax: 10, rest: 120 },
    secondary: { sets: 3, repMin: 8, repMax: 12, rest: 90 },
    accessory: { sets: 3, repMin: 10, repMax: 15, rest: 75 },
    isolation: { sets: 3, repMin: 12, repMax: 20, rest: 60 },
    core: { sets: 2, repMin: 10, repMax: 15, rest: 60 },
  },
  general_fitness: {
    main: { sets: 3, repMin: 8, repMax: 12, rest: 90 },
    secondary: { sets: 3, repMin: 10, repMax: 15, rest: 75 },
    accessory: { sets: 2, repMin: 10, repMax: 15, rest: 60 },
    isolation: { sets: 2, repMin: 12, repMax: 15, rest: 60 },
    core: { sets: 2, repMin: 10, repMax: 15, rest: 45 },
  },
  weight_loss: {
    main: { sets: 3, repMin: 10, repMax: 15, rest: 75 },
    secondary: { sets: 3, repMin: 10, repMax: 15, rest: 60 },
    accessory: { sets: 2, repMin: 12, repMax: 15, rest: 45 },
    isolation: { sets: 2, repMin: 12, repMax: 20, rest: 45 },
    core: { sets: 2, repMin: 12, repMax: 20, rest: 45 },
  },
  endurance: {
    main: { sets: 3, repMin: 12, repMax: 15, rest: 60 },
    secondary: { sets: 3, repMin: 15, repMax: 20, rest: 45 },
    accessory: { sets: 2, repMin: 15, repMax: 20, rest: 45 },
    isolation: { sets: 2, repMin: 15, repMax: 20, rest: 45 },
    core: { sets: 3, repMin: 15, repMax: 20, rest: 30 },
  },
};

const LEVEL_FACTOR: Record<TemplateLevel, number> = { beginner: 0.6, intermediate: 1, advanced: 1.3 };

/** Fraction of 1RM for a target rep count (the AI prompt's starting-weight rule). */
function intensity(reps: number): number {
  if (reps <= 5) return 0.75;
  if (reps <= 8) return 0.7;
  if (reps <= 12) return 0.65;
  return 0.6;
}

const STEP: Record<Equip, number> = {
  barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5, kettlebell: 4, bodyweight: 0, bands: 0, other: 2.5,
};
const FLOOR: Record<Equip, number> = {
  barbell: 20, dumbbell: 2, machine: 5, cable: 5, kettlebell: 8, bodyweight: 0, bands: 0, other: 0,
};

function roundLoad(kg: number, equipment: Equip): number {
  const step = STEP[equipment];
  if (step === 0) return 0;
  return Math.max(FLOOR[equipment], Math.round(kg / step) * step);
}

function oneRepMax(candidate: Candidate, level: TemplateLevel, athlete: TemplateAthlete): number {
  const known = athlete.lifts[candidate.name];
  if (known) return known;
  const sex = (athlete.sex ?? "").toLowerCase();
  const bodyWeight = athlete.bodyWeightKg ?? (sex === "female" ? 62 : 75);
  return bodyWeight * candidate.ratio * LEVEL_FACTOR[level] * (sex === "female" ? 0.65 : 1);
}

function emptySet(rest: number): PlanSet {
  return { type: "working", reps: null, kg: null, durSec: null, distM: null, rest, repMin: null, repMax: null, rir: null };
}

function prescribe(candidate: Candidate, role: Role, params: TemplateParams, athlete: TemplateAthlete): Exercise {
  const base = SCHEMES[params.goal][role];
  // Advanced lifters get one more set on the big lifts; beginners keep isolation light.
  const sets = Math.min(4, base.sets + (params.level === "advanced" && (role === "main" || role === "secondary") ? 1 : 0));
  const meta = {
    name: candidate.name,
    category: "strength" as const,
    area: candidate.area,
    muscle: candidate.muscle,
    equipment: candidate.equipment,
    pattern: candidate.pattern,
    role: (role === "main" || role === "secondary"
      ? "compound"
      : role === "core"
        ? candidate.hold ? "isometric" : "accessory"
        : role) as Exercise["role"],
  };

  if (candidate.hold) {
    const durSec = params.level === "beginner" ? 30 : 45;
    return {
      ...meta, adv: "duration", hits: 2, incKg: null, incReps: null,
      sets: Array.from({ length: sets }, () => ({ ...emptySet(base.rest), kg: 0, durSec })),
    };
  }

  if (candidate.equipment === "bodyweight" || candidate.equipment === "bands") {
    const reps = params.level === "beginner" ? Math.max(5, base.repMin - 2) : base.repMin;
    return {
      ...meta, adv: "reps", hits: 2, incKg: null, incReps: 1,
      sets: Array.from({ length: sets }, () => ({ ...emptySet(base.rest), reps, kg: 0 })),
    };
  }

  const kg = roundLoad(oneRepMax(candidate, params.level, athlete) * intensity(base.repMin), candidate.equipment);
  // Fixed-rep load progression for beginners' main lifts and every strength
  // main lift; a rep range with double progression for everything else.
  const linear = role === "main" && (params.level === "beginner" || params.goal === "strength");
  const working: PlanSet[] = Array.from({ length: sets }, () => ({
    ...emptySet(base.rest),
    reps: base.repMin,
    kg,
    ...(!linear && { repMin: base.repMin, repMax: base.repMax }),
  }));
  const warmup: PlanSet[] =
    role === "main" && candidate.equipment === "barbell"
      ? [{ ...emptySet(60), type: "warmup", reps: 5, kg: roundLoad(kg * 0.5, "barbell") }]
      : [];
  const lowerBarbell = candidate.equipment === "barbell" && candidate.area === "lower_body";

  return {
    ...meta,
    adv: linear ? "load" : "double",
    hits: linear && params.level !== "beginner" ? 2 : 1,
    incKg: linear && lowerBarbell && params.level === "beginner" ? 5 : STEP[candidate.equipment],
    incReps: null,
    sets: [...warmup, ...working],
  };
}

function pick(slot: SlotKey, equipment: TemplateEquipment, used: Set<string>): Candidate | null {
  const allowed = ALLOWED[equipment];
  return SLOTS[slot].find((cand) => allowed.includes(cand.equipment) && !used.has(cand.name)) ?? null;
}

/** The complete plan for these picks. Deterministic: same picks, same plan. */
export function buildTemplatePlan(params: TemplateParams, athlete: TemplateAthlete): AiPlan {
  const split = splitFor(params.daysPerWeek, params.level);
  const programs = split.sessions.map((session) => {
    const used = new Set<string>();
    const exercises: Exercise[] = [];
    for (const [slot, role] of session.slots) {
      const candidate = pick(slot, params.equipment, used);
      if (!candidate) continue;
      used.add(candidate.name);
      exercises.push(prescribe(candidate, role, params, athlete));
    }
    return { name: session.name, exercises };
  });

  return {
    programs,
    cycle: {
      name: `${params.weeks}-Week ${split.name}`,
      weeks: params.weeks,
      sched: "day_of_week",
      slots: split.days.map(({ session, day }) => ({
        prog: split.sessions[session].name,
        day,
        idx: null,
        label: null,
        auto: false,
      })),
    },
  };
}

/** Defaults from the athlete's profile, for preselecting the pickers. */
export function templateDefaults(goals: string[], experience: string | null): Pick<TemplateParams, "goal" | "level"> {
  const goal = goals.find((g) => (TEMPLATE_GOALS as readonly string[]).includes(g)) as TemplateGoal | undefined;
  const level = (TEMPLATE_LEVELS as readonly string[]).includes(experience ?? "") ? (experience as TemplateLevel) : "beginner";
  return { goal: goal ?? "general_fitness", level };
}
