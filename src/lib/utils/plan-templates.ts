/**
 * Pre-built plans: AI Setup's default path. Builds a complete training setup
 * from the user's picks (goal, experience, days, equipment, weeks, and
 * optionally session length, split, priority muscles and areas to avoid)
 * without calling a model — instant, free, and the same AiPlan shape the AI
 * returns, so it goes through the same validation and import. The AI only
 * edits a plan built here.
 *
 * A plan is a split (which sessions on which days), each session a list of
 * movement slots, each slot filled with the first exercise the equipment
 * allows, and every set prescribed from the goal and experience. Starting
 * weights come from the athlete's estimated 1RM on that lift, else from body
 * weight; src/__tests__/plan-templates.test.ts validates every combination.
 */

import { MAX_EXERCISES_PER_PROGRAM, MAX_SETS_PER_EXERCISE, type AiPlan } from "@/lib/utils/ai-plan";
import type { PromptOptions } from "@/lib/utils/ai-prompt";

export const TEMPLATE_GOALS = ["strength", "muscle_gain", "general_fitness", "weight_loss", "endurance"] as const;
export const TEMPLATE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const TEMPLATE_DAYS = [2, 3, 4, 5, 6] as const;
export const SESSION_MINUTES = [30, 45, 60, 90] as const;
export const TEMPLATE_SPLITS = ["auto", "full_body", "upper_lower", "ppl"] as const;
export const PRIORITY_MUSCLES = ["chest", "back", "shoulders", "arms", "glutes", "quads", "hamstrings"] as const;
export const AVOID_AREAS = ["knees", "shoulders", "lower_back"] as const;
export const MAX_PRIORITIES = 2;

/**
 * Bump whenever a change alters the plan built for any picks. AI edit results
 * are cached against the plan they edited, and the cache key includes this.
 */
export const TEMPLATE_VERSION = 2;

export type TemplateGoal = (typeof TEMPLATE_GOALS)[number];
export type TemplateLevel = (typeof TEMPLATE_LEVELS)[number];
export type TemplateEquipment = NonNullable<PromptOptions["equipment"]>;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];
export type TemplateSplit = (typeof TEMPLATE_SPLITS)[number];
export type PriorityMuscle = (typeof PRIORITY_MUSCLES)[number];
export type AvoidArea = (typeof AVOID_AREAS)[number];

export type TemplateParams = {
  goal: TemplateGoal;
  level: TemplateLevel;
  daysPerWeek: (typeof TEMPLATE_DAYS)[number];
  equipment: TemplateEquipment;
  weeks: NonNullable<PromptOptions["cycleDurationWeeks"]>;
  /** Target session length. Absent: no time limit. */
  sessionMinutes?: SessionMinutes;
  /** Absent or "auto": chosen from days and experience. */
  split?: TemplateSplit;
  /** Up to MAX_PRIORITIES muscles that get extra volume. */
  priorities?: PriorityMuscle[];
  /** Joints to spare: exercises that load them are skipped. */
  avoid?: AvoidArea[];
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
  /** Joints this exercise loads enough to skip when the athlete avoids them. */
  stress?: AvoidArea[];
};

const c = (
  name: string,
  equipment: Equip,
  area: Exercise["area"],
  muscle: Exercise["muscle"],
  pattern: Exercise["pattern"],
  ratio = 0,
  extra: { hold?: boolean; stress?: AvoidArea[] } = {},
): Candidate => ({ name, equipment, area, muscle, pattern, ratio, hold: extra.hold ?? false, stress: extra.stress ?? [] });

const KNEES: AvoidArea[] = ["knees"];
const BACK: AvoidArea[] = ["lower_back"];
const SHOULDERS: AvoidArea[] = ["shoulders"];

// Each slot lists exercises best first; the first the equipment allows wins,
// skipping any already used in the same session or loading an avoided joint.
// Joint-friendly alternatives sit after the usual picks, so they only win
// when those are skipped. Names match the seeded exercise library so imports
// reuse those exercises.
const SLOTS = {
  squat: [
    c("Squat", "barbell", "lower_body", "quads", "squat", 1.25, { stress: ["knees", "lower_back"] }),
    c("Front Squat", "barbell", "lower_body", "quads", "squat", 1.0, { stress: KNEES }),
    c("Leg Press", "machine", "lower_body", "quads", "squat", 2.0),
    c("Goblet Squat", "dumbbell", "lower_body", "quads", "squat", 0.35, { stress: KNEES }),
    c("Bulgarian Split Squat", "bodyweight", "lower_body", "quads", "squat", 0, { stress: KNEES }),
    c("Box Squat", "barbell", "lower_body", "quads", "squat", 1.0),
  ],
  hinge: [
    c("Deadlift", "barbell", "lower_body", "back", "hinge", 1.5, { stress: BACK }),
    c("Romanian Deadlift", "barbell", "lower_body", "hamstrings", "hinge", 1.0, { stress: BACK }),
    c("Romanian Deadlift", "dumbbell", "lower_body", "hamstrings", "hinge", 0.4, { stress: BACK }),
    c("Hip Thrust", "barbell", "lower_body", "glutes", "hinge", 1.3),
    c("Single-Leg Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
  ],
  hinge_accessory: [
    c("Romanian Deadlift", "barbell", "lower_body", "hamstrings", "hinge", 1.0, { stress: BACK }),
    c("Hip Thrust", "barbell", "lower_body", "glutes", "hinge", 1.3),
    c("Romanian Deadlift", "dumbbell", "lower_body", "hamstrings", "hinge", 0.4, { stress: BACK }),
    c("Single-Leg Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
    c("Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
  ],
  lunge: [
    c("Bulgarian Split Squat", "dumbbell", "lower_body", "quads", "squat", 0.25, { stress: KNEES }),
    c("Reverse Lunge", "dumbbell", "lower_body", "glutes", "squat", 0.25, { stress: KNEES }),
    c("Bulgarian Split Squat", "bodyweight", "lower_body", "quads", "squat", 0, { stress: KNEES }),
    c("Step-up", "bodyweight", "lower_body", "quads", "squat", 0, { stress: KNEES }),
    c("Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
  ],
  quad_iso: [
    c("Leg Extension", "machine", "lower_body", "quads", "squat", 0.6, { stress: KNEES }),
    c("Leg Press", "machine", "lower_body", "quads", "squat", 2.0),
    c("Goblet Squat", "dumbbell", "lower_body", "quads", "squat", 0.35, { stress: KNEES }),
    c("Wall Sit", "bodyweight", "lower_body", "quads", "isometric", 0, { hold: true, stress: KNEES }),
  ],
  ham_iso: [
    c("Leg Curl", "machine", "lower_body", "hamstrings", "hinge", 0.5),
    c("Nordic Curl", "bodyweight", "lower_body", "hamstrings", "hinge"),
  ],
  glute_iso: [
    c("Hip Thrust", "barbell", "lower_body", "glutes", "hinge", 1.3),
    c("Cable Kickback", "cable", "lower_body", "glutes", "pull", 0.15),
    c("Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
    c("Single-Leg Glute Bridge", "bodyweight", "lower_body", "glutes", "hinge"),
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
    c("Dip", "bodyweight", "upper_body", "chest", "push", 0, { stress: SHOULDERS }),
    c("Decline Push-up", "bodyweight", "upper_body", "chest", "push"),
  ],
  vpush: [
    c("Overhead Press", "barbell", "upper_body", "shoulders", "push", 0.6, { stress: SHOULDERS }),
    c("Dumbbell Shoulder Press", "dumbbell", "upper_body", "shoulders", "push", 0.25, { stress: SHOULDERS }),
    c("Pike Push-up", "bodyweight", "upper_body", "shoulders", "push", 0, { stress: SHOULDERS }),
    c("Landmine Press", "barbell", "upper_body", "chest", "push", 0.4),
    c("Incline Push-up", "bodyweight", "upper_body", "chest", "push"),
  ],
  hpull: [
    c("Barbell Row", "barbell", "upper_body", "back", "pull", 0.8, { stress: BACK }),
    c("Seated Cable Row", "cable", "upper_body", "back", "pull", 0.8),
    c("Dumbbell Row", "dumbbell", "upper_body", "back", "pull", 0.4),
    c("Inverted Row", "bodyweight", "upper_body", "back", "pull"),
    c("Seal Row", "barbell", "upper_body", "back", "pull", 0.6),
  ],
  vpull: [
    c("Lat Pulldown", "cable", "upper_body", "back", "pull", 0.8),
    c("Pull-up", "bodyweight", "upper_body", "back", "pull"),
    c("Chin-up", "bodyweight", "upper_body", "back", "pull"),
  ],
  back_iso: [
    c("Straight-Arm Pulldown", "cable", "upper_body", "back", "pull", 0.3),
    c("Seal Row", "barbell", "upper_body", "back", "pull", 0.6),
    c("Dumbbell Row", "dumbbell", "upper_body", "back", "pull", 0.4),
    c("Inverted Row", "bodyweight", "upper_body", "back", "pull"),
  ],
  chest_iso: [
    c("Cable Fly", "cable", "upper_body", "chest", "push", 0.15),
    c("Dumbbell Fly", "dumbbell", "upper_body", "chest", "push", 0.12),
    c("Wide Push-up", "bodyweight", "upper_body", "chest", "push"),
  ],
  side_delt: [
    c("Dumbbell Lateral Raise", "dumbbell", "upper_body", "shoulders", "push", 0.1),
    c("Cable Lateral Raise", "cable", "upper_body", "shoulders", "push", 0.08),
    c("Upright Row", "barbell", "upper_body", "shoulders", "pull", 0.4, { stress: SHOULDERS }),
    c("Pike Push-up", "bodyweight", "upper_body", "shoulders", "push", 0, { stress: SHOULDERS }),
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
    c("Close-Grip Push-up", "bodyweight", "upper_body", "triceps", "push"),
  ],
  core: [
    c("Plank", "bodyweight", "core", "abs", "isometric", 0, { hold: true }),
    c("Dead Bug", "bodyweight", "core", "abs", "isometric"),
  ],
  core_dynamic: [
    c("Hanging Leg Raise", "bodyweight", "core", "abs", "rotation"),
    c("Side Plank", "bodyweight", "core", "abs", "isometric", 0, { hold: true }),
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

/** Day counts each explicit split can be built for. */
export const SPLIT_DAYS: Record<Exclude<TemplateSplit, "auto">, readonly TemplateParams["daysPerWeek"][]> = {
  full_body: [2, 3, 4],
  upper_lower: [2, 4, 6],
  ppl: [3, 6],
};

export function splitSupports(split: TemplateSplit, days: TemplateParams["daysPerWeek"]): boolean {
  return split === "auto" || SPLIT_DAYS[split].includes(days);
}

const onDays = (sessions: number[], days: number[]) => sessions.map((session, i) => ({ session, day: days[i] }));

function autoSplit(days: TemplateParams["daysPerWeek"], level: TemplateLevel): Split {
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

function splitFor(days: TemplateParams["daysPerWeek"], level: TemplateLevel, split: TemplateSplit): Split {
  if (!splitSupports(split, days)) throw new Error(`Split "${split}" can't be built for ${days} days per week`);
  const s = SESSIONS;
  switch (split) {
    case "auto":
      return autoSplit(days, level);
    case "full_body": {
      const pattern = { 2: [[0, 1], [1, 4]], 3: [[0, 1], [1, 3], [0, 5]], 4: [[0, 1], [1, 2], [0, 4], [1, 5]] }[days as 2 | 3 | 4];
      return { name: "Full Body", sessions: [s.fullA, s.fullB], days: pattern.map(([session, day]) => ({ session, day })) };
    }
    case "upper_lower":
      if (days === 2) return { name: "Upper/Lower", sessions: [s.upperA, s.lowerA], days: onDays([0, 1], [1, 4]) };
      if (days === 4) return autoSplit(4, level);
      return {
        name: "Upper/Lower",
        sessions: [s.upperA, s.lowerA, s.upperB, s.lowerB],
        days: onDays([0, 1, 2, 3, 0, 1], [1, 2, 3, 4, 5, 6]),
      };
    case "ppl":
      if (days === 3) return { name: "Push/Pull/Legs", sessions: [s.push, s.pull, s.legs], days: onDays([0, 1, 2], [1, 3, 5]) };
      return autoSplit(6, level);
  }
}

// A priority muscle gets an isolation slot in each session that already
// trains it (any of `trains`), or one more set where the slot is already there.
const PRIORITY_SLOTS: Record<PriorityMuscle, { trains: SlotKey[]; add: SlotKey; muscles: Exercise["muscle"][] }[]> = {
  chest: [{ trains: ["hpush", "hpush_accessory"], add: "chest_iso", muscles: ["chest"] }],
  back: [{ trains: ["hpull", "vpull"], add: "back_iso", muscles: ["back"] }],
  shoulders: [{ trains: ["vpush", "side_delt", "rear_delt"], add: "side_delt", muscles: ["shoulders"] }],
  arms: [
    { trains: ["hpull", "vpull"], add: "biceps", muscles: ["biceps"] },
    { trains: ["hpush", "vpush"], add: "triceps", muscles: ["triceps"] },
  ],
  glutes: [{ trains: ["squat", "hinge", "hinge_accessory", "lunge"], add: "glute_iso", muscles: ["glutes"] }],
  quads: [{ trains: ["squat", "lunge"], add: "quad_iso", muscles: ["quads"] }],
  hamstrings: [{ trains: ["hinge", "hinge_accessory"], add: "ham_iso", muscles: ["hamstrings"] }],
};

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

// Short sessions rest less: the main lifts keep the most.
const REST_CAP: Partial<Record<SessionMinutes, { main: number; other: number }>> = {
  30: { main: 120, other: 60 },
  45: { main: 150, other: 90 },
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

function schemeFor(role: Role, params: TemplateParams): Scheme {
  const base = SCHEMES[params.goal][role];
  const cap = params.sessionMinutes ? REST_CAP[params.sessionMinutes] : undefined;
  if (!cap) return base;
  return { ...base, rest: Math.min(base.rest, role === "main" ? cap.main : cap.other) };
}

function prescribe(candidate: Candidate, role: Role, params: TemplateParams, athlete: TemplateAthlete): Exercise {
  const base = schemeFor(role, params);
  // Advanced lifters get one more set on the big lifts; beginners keep isolation light.
  // Long sessions add a set to accessory and isolation work.
  const bonus =
    (params.level === "advanced" && (role === "main" || role === "secondary") ? 1 : 0) +
    (params.sessionMinutes === 90 && (role === "accessory" || role === "isolation") ? 1 : 0);
  const sets = Math.min(4, base.sets + bonus);
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

function pick(slot: SlotKey, params: TemplateParams, used: Set<string>): Candidate | null {
  const allowed = ALLOWED[params.equipment];
  const avoid = params.avoid ?? [];
  return (
    SLOTS[slot].find(
      (cand) =>
        allowed.includes(cand.equipment) &&
        !used.has(cand.name) &&
        !(cand.stress ?? []).some((joint) => avoid.includes(joint)),
    ) ?? null
  );
}

// Rough minutes for a session: a set takes about 45 s (or its hold time) plus
// its rest, and each exercise a minute to set up.
const WORK_SEC = 45;
const CHANGEOVER_SEC = 60;

/** Estimated length of a session in minutes. */
export function estimateSessionMinutes(exercises: Exercise[]): number {
  let seconds = 0;
  for (const exercise of exercises) {
    seconds += CHANGEOVER_SEC;
    for (const set of exercise.sets) seconds += (set.durSec ?? WORK_SEC) + set.rest;
  }
  return seconds / 60;
}

type Entry = { slot: SlotKey; role: Role; priority: boolean; exercise: Exercise };

function addSet(exercise: Exercise): void {
  if (exercise.sets.length >= MAX_SETS_PER_EXERCISE) return;
  const working = exercise.sets.filter((s) => s.type === "working");
  exercise.sets.push({ ...working[working.length - 1] });
}

function removeWorkingSet(exercise: Exercise): void {
  const last = exercise.sets.map((s) => s.type).lastIndexOf("working");
  exercise.sets.splice(last, 1);
}

const workingSets = (exercise: Exercise) => exercise.sets.filter((s) => s.type === "working").length;

/** Extra volume for the priority muscles, as new slots or extra sets. */
function applyPriorities(
  entries: Entry[],
  session: Session,
  params: TemplateParams,
  athlete: TemplateAthlete,
  used: Set<string>,
): void {
  for (const muscle of params.priorities ?? []) {
    for (const rule of PRIORITY_SLOTS[muscle]) {
      if (!session.slots.some(([slot]) => rule.trains.includes(slot))) continue;
      const existing = entries.find((e) => e.slot === rule.add);
      if (existing) {
        addSet(existing.exercise);
        existing.priority = true;
        continue;
      }
      const candidate = entries.length < MAX_EXERCISES_PER_PROGRAM ? pick(rule.add, params, used) : null;
      if (candidate) {
        used.add(candidate.name);
        // After the last isolation slot, before core work.
        const at = entries.findIndex((e) => e.role === "core");
        const entry: Entry = {
          slot: rule.add,
          role: "isolation",
          priority: true,
          exercise: prescribe(candidate, "isolation", params, athlete),
        };
        entries.splice(at === -1 ? entries.length : at, 0, entry);
        continue;
      }
      // No slot to add: one more set on an exercise for that muscle, if any.
      const fallback = entries.find((e) => rule.muscles.includes(e.exercise.muscle));
      if (fallback) addSet(fallback.exercise);
    }
  }
}

/** Trims a session to the time limit, cheapest cuts first. Never drops a main lift or a priority slot. */
function fitToTime(entries: Entry[], minutes: number): Entry[] {
  let out = [...entries];
  const over = () => estimateSessionMinutes(out.map((e) => e.exercise)) > minutes;
  const lastIndex = (test: (e: Entry) => boolean) => out.map(test).lastIndexOf(true);

  while (over()) {
    const droppable = ["core", "isolation", "accessory"]
      .map((role) => lastIndex((e) => e.role === role && !e.priority))
      .find((i) => i !== -1);
    if (droppable !== undefined) {
      out = out.filter((_, i) => i !== droppable);
      continue;
    }
    const shorten = (["secondary", "main"] as Role[])
      .map((role) => lastIndex((e) => e.role === role && workingSets(e.exercise) > 2))
      .find((i) => i !== -1);
    if (shorten !== undefined) {
      removeWorkingSet(out[shorten].exercise);
      continue;
    }
    const priorityExtra = lastIndex((e) => e.priority && workingSets(e.exercise) > 2);
    if (priorityExtra !== -1) {
      removeWorkingSet(out[priorityExtra].exercise);
      continue;
    }
    const secondary = lastIndex((e) => e.role === "secondary");
    if (secondary !== -1) {
      out = out.filter((_, i) => i !== secondary);
      continue;
    }
    break;
  }
  return out;
}

/** The complete plan for these picks. Deterministic: same picks, same plan. */
export function buildTemplatePlan(params: TemplateParams, athlete: TemplateAthlete): AiPlan {
  const split = splitFor(params.daysPerWeek, params.level, params.split ?? "auto");
  const programs = split.sessions.map((session) => {
    const used = new Set<string>();
    let entries: Entry[] = [];
    for (const [slot, role] of session.slots) {
      const candidate = pick(slot, params, used);
      if (!candidate) continue;
      used.add(candidate.name);
      entries.push({ slot, role, priority: false, exercise: prescribe(candidate, role, params, athlete) });
    }
    applyPriorities(entries, session, params, athlete, used);
    if (params.sessionMinutes) entries = fitToTime(entries, params.sessionMinutes);
    return { name: session.name, exercises: entries.map((e) => e.exercise) };
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
