import { db } from "../src/db";
import { exercises } from "../src/db/schema";
import { aiModelConfigs } from "../src/db/schema/ai-model-configs";
import { exerciseTypeFromPattern } from "../src/lib/utils/exercise-type";
import { inArray } from "drizzle-orm";

const AI_MODELS = [
  { modelId: "openai/gpt-oss-120b:free",               label: "OpenAI OSS 120B (free)",        priority: 1 },
  { modelId: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super 120B (free)",  priority: 2 },
  { modelId: "openrouter/free",                        label: "Free Models Router (auto)",      priority: 3 },
  { modelId: "google/gemma-4-31b-it:free",             label: "Gemma 4 31B (free)",            priority: 4 },
  { modelId: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)",          priority: 5 },
  { modelId: "nousresearch/hermes-3-llama-3.1-405b:free", label: "Hermes 3 405B (free)",       priority: 6 },
  { modelId: "qwen/qwen3-coder:free",                  label: "Qwen3 Coder 480B (free)",       priority: 7 },
] as const;

const EXERCISES = [
  // ── Chest ──────────────────────────────────────────────────────────────────
  { name: "Bench Press",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "barbell",    movementPattern: "push" },
  { name: "Incline Bench Press",   category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "barbell",    movementPattern: "push" },
  { name: "Decline Bench Press",   category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "barbell",    movementPattern: "push" },
  { name: "Dumbbell Bench Press",  category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "dumbbell",   movementPattern: "push" },
  { name: "Incline Dumbbell Press",category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "dumbbell",   movementPattern: "push" },
  { name: "Dumbbell Fly",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "dumbbell",   movementPattern: "push" },
  { name: "Cable Crossover",       category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "cable",      movementPattern: "push" },
  { name: "Cable Fly",             category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "cable",      movementPattern: "push" },
  { name: "Pec Deck Machine",      category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "machine",    movementPattern: "push" },
  { name: "Dip",                   category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Push-up",               category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Incline Push-up",       category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Close-Grip Bench Press",category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "barbell",    movementPattern: "push" },
  { name: "Landmine Press",        category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "barbell",    movementPattern: "push" },
  { name: "Push-up Plus",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },

  // ── Back ───────────────────────────────────────────────────────────────────
  { name: "Deadlift",              category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "back",       equipment: "barbell",    movementPattern: "hinge" },
  { name: "Barbell Row",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "barbell",    movementPattern: "pull" },
  { name: "Pendlay Row",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "barbell",    movementPattern: "pull" },
  { name: "T-Bar Row",             category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "barbell",    movementPattern: "pull" },
  { name: "Dumbbell Row",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Seal Row",              category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "barbell",    movementPattern: "pull" },
  { name: "Pull-up",               category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Chin-up",               category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Inverted Row",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Lat Pulldown",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "cable",      movementPattern: "pull" },
  { name: "Seated Cable Row",      category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "cable",      movementPattern: "pull" },
  { name: "Single-Arm Cable Row",  category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "cable",      movementPattern: "pull" },
  { name: "Face Pull",             category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "cable",      movementPattern: "pull" },
  { name: "Straight-Arm Pulldown", category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "cable",      movementPattern: "pull" },
  { name: "Lat Pushdown",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "cable",      movementPattern: "pull" },
  { name: "Renegade Row",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Hyperextension",        category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "lower_back", equipment: "bodyweight", movementPattern: "hinge" },

  // ── Shoulders ──────────────────────────────────────────────────────────────
  { name: "Overhead Press",        category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "barbell",    movementPattern: "push" },
  { name: "Dumbbell Shoulder Press",category:"strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "dumbbell",   movementPattern: "push" },
  { name: "Arnold Press",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "dumbbell",   movementPattern: "push" },
  { name: "Machine Shoulder Press",category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "machine",    movementPattern: "push" },
  { name: "Dumbbell Lateral Raise",category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "dumbbell",   movementPattern: "push" },
  { name: "Cable Lateral Raise",   category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "cable",      movementPattern: "push" },
  { name: "Front Raise",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "dumbbell",   movementPattern: "push" },
  { name: "Plate Front Raise",     category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "other",      movementPattern: "push" },
  { name: "Rear Delt Fly",         category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Bent-Over Lateral Raise",category:"strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Upright Row",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "barbell",    movementPattern: "pull" },
  { name: "Shrugs",                category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "barbell",    movementPattern: "pull" },
  { name: "Landmine Lateral Raise",category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "barbell",    movementPattern: "push" },

  // ── Biceps ─────────────────────────────────────────────────────────────────
  { name: "Barbell Curl",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "barbell",    movementPattern: "pull" },
  { name: "EZ Bar Curl",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "barbell",    movementPattern: "pull" },
  { name: "Dumbbell Curl",         category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Hammer Curl",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Incline Dumbbell Curl", category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Concentration Curl",    category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Spider Curl",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Preacher Curl",         category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "barbell",    movementPattern: "pull" },
  { name: "Cable Curl",            category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "cable",      movementPattern: "pull" },
  { name: "Reverse Curl",          category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "biceps",     equipment: "barbell",    movementPattern: "pull" },

  // ── Triceps ────────────────────────────────────────────────────────────────
  { name: "Tricep Pushdown",       category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "cable",      movementPattern: "push" },
  { name: "Skull Crusher",         category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "barbell",    movementPattern: "push" },
  { name: "Overhead Tricep Extension",category:"strength",isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "dumbbell",   movementPattern: "push" },
  { name: "Cable Overhead Extension",category:"strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "cable",      movementPattern: "push" },
  { name: "Tricep Dip",            category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "bodyweight", movementPattern: "push" },
  { name: "Kickback",              category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "dumbbell",   movementPattern: "push" },
  { name: "Close-Grip Push-up",    category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "bodyweight", movementPattern: "push" },
  { name: "Diamond Push-up",       category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "bodyweight", movementPattern: "push" },

  // ── Forearms ───────────────────────────────────────────────────────────────
  { name: "Wrist Curl",            category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "forearms",   equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Reverse Wrist Curl",    category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "forearms",   equipment: "dumbbell",   movementPattern: "pull" },
  { name: "Dead Hang",             category: "strength", isCustom: false, isTimed: true, bodyArea: "upper_body", muscleGroup: "forearms",   equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Plate Pinch",           category: "strength", isCustom: false, bodyArea: "upper_body", muscleGroup: "forearms",   equipment: "other",      movementPattern: "isometric" },

  // ── Quads ──────────────────────────────────────────────────────────────────
  { name: "Squat",                 category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "barbell",    movementPattern: "squat" },
  { name: "Front Squat",           category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "barbell",    movementPattern: "squat" },
  { name: "Box Squat",             category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "barbell",    movementPattern: "squat" },
  { name: "Hack Squat",            category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "machine",    movementPattern: "squat" },
  { name: "Leg Press",             category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "machine",    movementPattern: "squat" },
  { name: "Leg Extension",         category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "machine",    movementPattern: "pull" },
  { name: "Goblet Squat",          category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "kettlebell", movementPattern: "squat" },
  { name: "Bulgarian Split Squat", category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "dumbbell",   movementPattern: "squat" },
  { name: "Lunge",                 category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "squat" },
  { name: "Step-up",               category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "squat" },
  { name: "Jump Squat",            category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "squat" },

  // ── Hamstrings ─────────────────────────────────────────────────────────────
  { name: "Romanian Deadlift",     category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "barbell",    movementPattern: "hinge" },
  { name: "Stiff-Leg Deadlift",    category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "barbell",    movementPattern: "hinge" },
  { name: "Good Morning",          category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "barbell",    movementPattern: "hinge" },
  { name: "Leg Curl",              category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "machine",    movementPattern: "pull" },
  { name: "Lying Leg Curl",        category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "machine",    movementPattern: "pull" },
  { name: "Seated Leg Curl",       category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "machine",    movementPattern: "pull" },
  { name: "Nordic Curl",           category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "bodyweight", movementPattern: "pull" },

  // ── Glutes ─────────────────────────────────────────────────────────────────
  { name: "Hip Thrust",            category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "barbell",    movementPattern: "hinge" },
  { name: "Glute Bridge",          category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "bodyweight", movementPattern: "hinge" },
  { name: "Sumo Deadlift",         category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "barbell",    movementPattern: "hinge" },
  { name: "Cable Kickback",        category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "cable",      movementPattern: "pull" },
  { name: "Donkey Kick",           category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "bodyweight", movementPattern: "pull" },
  { name: "Lateral Band Walk",     category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "bands",      movementPattern: "isometric" },
  { name: "Hip Abduction Machine", category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "machine",    movementPattern: "pull" },
  { name: "Reverse Lunge",         category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "bodyweight", movementPattern: "squat" },

  // ── Calves ─────────────────────────────────────────────────────────────────
  { name: "Calf Raise",            category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "calves",     equipment: "machine",    movementPattern: "push" },
  { name: "Seated Calf Raise",     category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "calves",     equipment: "machine",    movementPattern: "push" },
  { name: "Donkey Calf Raise",     category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "calves",     equipment: "machine",    movementPattern: "push" },
  { name: "Single-Leg Calf Raise", category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "calves",     equipment: "bodyweight", movementPattern: "push" },

  // ── Abs / Core ─────────────────────────────────────────────────────────────
  { name: "Plank",                 category: "strength", isCustom: false, isTimed: true, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Side Plank",            category: "strength", isCustom: false, isTimed: true, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Hollow Hold",           category: "strength", isCustom: false, isTimed: true, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Dead Bug",              category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Pallof Press",          category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "cable",      movementPattern: "isometric" },
  { name: "Ab Wheel Rollout",      category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "other",      movementPattern: "isometric" },
  { name: "Hanging Leg Raise",     category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "pull" },
  { name: "Leg Raise",             category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "pull" },
  { name: "V-Up",                  category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "pull" },
  { name: "Crunch",                category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "pull" },
  { name: "Decline Sit-up",        category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "pull" },
  { name: "Sit-up",                category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "pull" },
  { name: "Cable Crunch",          category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "cable",      movementPattern: "pull" },
  { name: "Russian Twist",         category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "rotation" },
  { name: "Bicycle Crunch",        category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "rotation" },
  { name: "Windshield Wiper",      category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "rotation" },
  { name: "Mountain Climbers",     category: "strength", isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "push" },

  // ── Lower Back ─────────────────────────────────────────────────────────────
  { name: "Back Extension",        category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "lower_back", equipment: "bodyweight", movementPattern: "hinge" },
  { name: "Superman",              category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "lower_back", equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Reverse Hyper",         category: "strength", isCustom: false, bodyArea: "lower_body", muscleGroup: "lower_back", equipment: "machine",    movementPattern: "hinge" },

  // ── Full Body ──────────────────────────────────────────────────────────────
  { name: "Farmer's Carry",        category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "dumbbell",   movementPattern: "carry" },
  { name: "Kettlebell Swing",      category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "kettlebell", movementPattern: "hinge" },
  { name: "Power Clean",           category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "barbell",    movementPattern: "hinge" },
  { name: "Clean and Press",       category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "barbell",    movementPattern: "push" },
  { name: "Push Press",            category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "barbell",    movementPattern: "push" },
  { name: "Thruster",              category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "barbell",    movementPattern: "push" },
  { name: "Snatch",                category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "barbell",    movementPattern: "hinge" },
  { name: "Turkish Get-Up",        category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "kettlebell", movementPattern: "carry" },
  { name: "Burpee",                category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "push" },
  { name: "Sled Push",             category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "other",      movementPattern: "push" },
  { name: "Wall Ball",             category: "strength", isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "other",      movementPattern: "push" },

  // ── Cardio / Warm-up ───────────────────────────────────────────────────────
  { name: "Warm Up",               category: "cardio",   isCustom: false, isTimed: true, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Running",               category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio", discipline: "run" },
  // Triathlon disciplines — distance/pace logging, used by the triathlon plan generator
  { name: "Swim",                  category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio", discipline: "swim" },
  { name: "Bike",                  category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio", discipline: "bike" },
  { name: "Run",                   category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio", discipline: "run" },
  { name: "Walking",               category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Sprint",                category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "High Knees",            category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Jump Rope",             category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "other",      movementPattern: "cardio" },
  { name: "Box Jump",              category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Pogo Hops",             category: "cardio",   isCustom: false,               bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Cycling",               category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio" },
  { name: "Stair Climber",         category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio" },
  { name: "Elliptical",            category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio" },
  { name: "Rowing Machine",        category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio" },
  { name: "Assault Bike",          category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio" },
  { name: "Ski Erg",               category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "machine",    movementPattern: "cardio" },
  { name: "Swimming",              category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Battle Ropes",          category: "cardio",   isCustom: false, isTimed: true, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "other",      movementPattern: "cardio" },

  // ── Calisthenics — Push ────────────────────────────────────────────────────
  { name: "Wide Push-up",              category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Decline Push-up",           category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Archer Push-up",            category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Pseudo Planche Push-up",    category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Hindu Push-up",             category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "push" },
  { name: "Ring Push-up",              category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "other",      movementPattern: "push" },
  { name: "Pike Push-up",              category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "bodyweight", movementPattern: "push" },
  { name: "Handstand Push-up",         category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "bodyweight", movementPattern: "push" },
  { name: "Handstand Hold",            category: "strength",    isCustom: false, isTimed: true, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Handstand",                 category: "cardio",      isCustom: false, isTimed: true, bodyArea: "upper_body", muscleGroup: "shoulders",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Ring Dip",                  category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "triceps",    equipment: "other",      movementPattern: "push" },

  // ── Calisthenics — Pull ────────────────────────────────────────────────────
  { name: "Muscle-up",                 category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Negative Pull-up",          category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Wide-Grip Pull-up",         category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "L-sit Pull-up",             category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Typewriter Pull-up",        category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "pull" },
  { name: "Ring Row",                  category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "other",      movementPattern: "pull" },
  { name: "Front Lever",               category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Back Lever",                category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "back",       equipment: "bodyweight", movementPattern: "isometric" },

  // ── Calisthenics — Core / Skill ────────────────────────────────────────────
  { name: "L-sit",                     category: "strength",    isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Dragon Flag",               category: "strength",    isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Copenhagen Plank",          category: "strength",    isCustom: false, bodyArea: "core",       muscleGroup: "abs",        equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Tuck Planche",              category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Human Flag",                category: "strength",    isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Arch Hold",                 category: "strength",    isCustom: false, bodyArea: "lower_body", muscleGroup: "lower_back", equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Crow Pose",                 category: "strength",    isCustom: false, bodyArea: "upper_body", muscleGroup: "chest",      equipment: "bodyweight", movementPattern: "isometric" },

  // ── Calisthenics — Legs ────────────────────────────────────────────────────
  { name: "Pistol Squat",              category: "strength",    isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "squat" },
  { name: "Shrimp Squat",              category: "strength",    isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "squat" },
  { name: "Wall Sit",                  category: "strength",    isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Jump Lunge",                category: "strength",    isCustom: false, bodyArea: "lower_body", muscleGroup: "quads",      equipment: "bodyweight", movementPattern: "squat" },
  { name: "Single-Leg Glute Bridge",   category: "strength",    isCustom: false, bodyArea: "lower_body", muscleGroup: "glutes",     equipment: "bodyweight", movementPattern: "hinge" },

  // ── Calisthenics — Full Body / Locomotion ──────────────────────────────────
  { name: "Bear Crawl",                category: "strength",    isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "carry" },
  { name: "Inchworm",                  category: "strength",    isCustom: false, bodyArea: "full_body",  muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "push" },
  { name: "Tuck Jump",                 category: "cardio",      isCustom: false, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },
  { name: "Jumping Jack",              category: "cardio",      isCustom: false, bodyArea: "cardio",     muscleGroup: "cardio",     equipment: "bodyweight", movementPattern: "cardio" },

  // ── Flexibility ────────────────────────────────────────────────────────────
  { name: "Static Stretching",     category: "flexibility", isCustom: false, bodyArea: "full_body", muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Dynamic Stretching",    category: "flexibility", isCustom: false, bodyArea: "full_body", muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Yoga",                  category: "flexibility", isCustom: false, bodyArea: "full_body", muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Foam Rolling",          category: "flexibility", isCustom: false, bodyArea: "full_body", muscleGroup: "full_body",  equipment: "other",      movementPattern: "isometric" },
  { name: "Hip Flexor Stretch",    category: "flexibility", isCustom: false, bodyArea: "lower_body",muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Child's Pose",          category: "flexibility", isCustom: false, bodyArea: "full_body", muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Pigeon Pose",           category: "flexibility", isCustom: false, bodyArea: "lower_body",muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Neck Stretch",          category: "flexibility", isCustom: false, bodyArea: "upper_body",muscleGroup: "full_body",  equipment: "bodyweight", movementPattern: "isometric" },
  { name: "Wrist Mobility",        category: "flexibility", isCustom: false, bodyArea: "upper_body",muscleGroup: "forearms",   equipment: "bodyweight", movementPattern: "isometric" },
] as const;

async function seed() {
  console.log("🌱 Seeding database...");

  try {
    // User accounts are now created via Better Auth (pnpm create-admin).
    // The seed script only handles the exercise library.

    // Seed exercises — skips any that already exist by name
     
    // Derive each exercise's default type from its movement pattern (same coarse
    // mapping as the 0039 backfill migration). Refine per-exercise via the editor.
    const seedExercises = EXERCISES.map((e) => ({
      ...e,
      exerciseType: exerciseTypeFromPattern(e.movementPattern) ?? undefined,
    }));
    await db.insert(exercises).values(seedExercises).onConflictDoNothing();
    console.log(`✅ Seeded ${seedExercises.length} exercises (skipped duplicates)`);

    // Mark inherently time-based exercises (isometric holds, warm-up) as isTimed.
    // This also updates rows that existed before the is_timed column was added.
    const timedExerciseNames = [
      // Cardio — sustained / machine-based (no reps/kg)
      "Warm Up", "Walking", "High Knees", "Jump Rope",
      "Cycling", "Stair Climber", "Elliptical", "Rowing Machine",
      "Assault Bike", "Ski Erg", "Swimming", "Battle Ropes",
      "Handstand",
      // Isometric holds
      "Handstand Hold",
      "Plank", "Side Plank", "Hollow Hold", "Dead Hang",
      "L-sit", "Wall Sit", "Copenhagen Plank", "Arch Hold",
      "Front Lever", "Back Lever", "Tuck Planche", "Human Flag", "Crow Pose",
    ];
    await db.update(exercises).set({ isTimed: true }).where(
      inArray(exercises.name, timedExerciseNames),
    );
    console.log(`✅ Marked ${timedExerciseNames.length} exercises as timed`);

    // Seed AI model configs — skips any that already exist by modelId
    await db.insert(aiModelConfigs).values([...AI_MODELS]).onConflictDoNothing();
    console.log(`✅ Seeded ${AI_MODELS.length} AI model configs (skipped duplicates)`);

    console.log("✅ Seeding completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
