export type PrData = {
  exerciseName: string;
  estimated1rm?: number;
  maxWeight?: number;
};

export type PromptOptions = {
  daysPerWeek?: number;
  equipment?: "full_gym" | "barbell" | "dumbbells" | "bodyweight";
  cycleDurationWeeks?: 4 | 6 | 8 | 10 | 12 | 16;
};

type UserProfile = {
  gender: string | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goals: string[];
  experienceLevel: string | null;
};

type Exercise = {
  name: string;
  muscleGroup?: string | null;
  equipment?: string | null;
  movementPattern?: string | null;
  exerciseType?: string | null;
};

const GOAL_LABELS: Record<string, string> = {
  strength: "Strength",
  muscle_gain: "Muscle Gain",
  weight_loss: "Weight Loss",
  endurance: "Endurance",
  general_fitness: "General Fitness",
};

const EQUIPMENT_LABELS: Record<string, string> = {
  full_gym: "Full gym (barbells, dumbbells, cables, machines — all equipment available)",
  barbell: "Barbell + rack only (barbell and bodyweight exercises only — no dumbbells, cables, or machines)",
  dumbbells: "Dumbbells only (dumbbells and bodyweight exercises only — no barbell, cables, or machines)",
  bodyweight: "Bodyweight only (no equipment whatsoever — bands allowed)",
};

/** Shared instruction block used by both manual and automatic flows. */
export function buildAiSystemPrompt(userProfile: UserProfile, exercises: Exercise[], prs: PrData[] = [], existingProgramNames: string[] = [], options: PromptOptions = {}): string {
  const exerciseListText =
    exercises.length > 0
      ? `\nAvailable exercises in my library (use these names exactly when possible):\n${exercises
          .map(
            (e) =>
              `- ${e.name} (${[e.muscleGroup, e.equipment, e.movementPattern, e.exerciseType].filter(Boolean).join(", ")})`,
          )
          .join("\n")}\n`
      : "";

  const profileLines: string[] = [];
  if (userProfile.goals.length > 0)
    profileLines.push(`Goals: ${userProfile.goals.map((g) => GOAL_LABELS[g] ?? g).join(", ")}`);
  if (userProfile.experienceLevel)
    profileLines.push(`Experience level: ${userProfile.experienceLevel}`);
  if (userProfile.gender && userProfile.gender !== "prefer_not_to_say")
    profileLines.push(`Gender: ${userProfile.gender}`);
  if (userProfile.birthYear)
    profileLines.push(`Age: ${new Date().getFullYear() - userProfile.birthYear}`);
  if (userProfile.heightCm) profileLines.push(`Height: ${userProfile.heightCm} cm`);
  if (userProfile.weightKg) profileLines.push(`Body weight: ${userProfile.weightKg} kg`);
  if (options.daysPerWeek) profileLines.push(`Training frequency: ${options.daysPerWeek} days/week`);
  if (options.equipment) profileLines.push(`Available equipment: ${EQUIPMENT_LABELS[options.equipment] ?? options.equipment}`);
  if (options.cycleDurationWeeks) profileLines.push(`Preferred cycle length: ${options.cycleDurationWeeks} weeks`);
  const profileBlock =
    profileLines.length > 0
      ? `\nAbout me:\n${profileLines.map((l) => `- ${l}`).join("\n")}\n`
      : "";

  const prLines = prs
    .map((pr) => {
      if (pr.estimated1rm) return `- ${pr.exerciseName}: ~${pr.estimated1rm}kg estimated 1RM`;
      if (pr.maxWeight) return `- ${pr.exerciseName}: ${pr.maxWeight}kg max weight lifted`;
      return null;
    })
    .filter(Boolean);
  const prBlock =
    prLines.length > 0
      ? `\nMy current performance (use these to set realistic starting weights):\n${prLines.join("\n")}\n`
      : "";

  const existingProgramsBlock =
    existingProgramNames.length > 0
      ? `\nI already have these programs (do NOT duplicate them — create complementary work instead):\n${existingProgramNames.map((n) => `- ${n}`).join("\n")}\n`
      : "";

  const equipmentRule =
    options.equipment && options.equipment !== "full_gym"
      ? "\n- Equipment constraint: ONLY include exercises that use the available equipment listed above. Do not suggest any exercises requiring equipment not available."
      : "";
  const frequencyRule = options.daysPerWeek
    ? `\n- Frequency constraint: the cycle must schedule EXACTLY ${options.daysPerWeek} training day${options.daysPerWeek !== 1 ? "s" : ""} per week — no more, no less.`
    : "";
  const durationRule = options.cycleDurationWeeks
    ? `\n- Cycle duration constraint: weeks MUST be ${options.cycleDurationWeeks}.`
    : "";

  return `Set up my workout app with the right programs and training schedule.${profileBlock}${prBlock}${existingProgramsBlock}
Generate a JSON response that creates everything I need — workout programs and optionally a training cycle that links them together.

If generating programs only (no schedule), use:
{ "version": 1, "programs": [ { "name": "...", "exercises": [...] } ] }

If generating a full training setup (programs + a cycle schedule), use:
{
  "version": 1,
  "programs": [ { "name": "Push Day", "exercises": [...] }, ... ],
  "cycle": {
    "name": "12-Week Strength Block",
    "weeks": 12,
    "sched": "day_of_week",
    "slots": [
      { "day": 1, "prog": "Push Day" },
      { "day": 3, "prog": "Pull Day" },
      { "day": 5, "prog": "Leg Day" }
    ]
  }
}

For rotation-based cycles (programs cycle in order regardless of which day of the week):
  "cycle": {
    "name": "ABC Rotation",
    "weeks": 8,
    "sched": "rotation",
    "slots": [
      { "idx": 1, "prog": "Push Day", "label": "A" },
      { "idx": 2, "prog": "Pull Day", "label": "B" },
      { "idx": 3, "prog": "Leg Day", "label": "C" }
    ]
  }

Each exercise entry:
{
  "idx": 0,
  "adv": "load",
  "hits": 2,
  "incKg": 2.5,
  "incReps": 0,
  "exercise": {
    "name": "Bench Press",
    "category": "strength",
    "area": "upper_body",
    "muscle": "chest",
    "equipment": "barbell",
    "pattern": "push",
    "type": "compound"
  },
  "sets": [
    { "n": 1, "reps": 8, "kg": 40, "rest": 60, "type": "warmup" },
    { "n": 2, "reps": 8, "kg": 60, "rest": 90 }
  ]
}

A rep-range exercise instead — the standard hypertrophy scheme. "repMin"/"repMax"
are required for "adv": "double", and "reps" is the prescription today, which the
app moves between the bounds:
{
  "idx": 1,
  "adv": "double",
  "hits": 1,
  "incKg": 2.5,
  "exercise": { "name": "Tricep Pushdown", "category": "strength", "area": "upper_body", "muscle": "triceps", "equipment": "cable", "pattern": "push", "type": "isolation" },
  "sets": [
    { "n": 1, "reps": 12, "kg": 25, "rest": 60, "repMin": 8, "repMax": 12 }
  ]
}

Rules:
- Do NOT generate rest day programs. Omit rest days from cycle slots entirely.
- category: "strength", "cardio", or "flexibility"
- area: "upper_body", "lower_body", "core", "full_body", or "cardio"
- muscle: "chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads", "hamstrings", "glutes", "calves", "abs", "lower_back", "full_body", or "cardio"
- equipment: "barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", or "other"
- pattern: "push", "pull", "hinge", "squat", "carry", "rotation", "isometric", or "cardio"
- type: the exercise's ROLE IN THIS PROGRAM — "compound" (multi-joint main lifts — squat, bench, deadlift, OHP, rows, pull-ups), "isolation" (single-joint, one muscle — curls, raises, extensions), "accessory" (a compound/isolation movement used here as support work for a main lift), "plyometric" (explosive — box jumps, clapping push-ups), or "isometric" (static holds — planks, wall sits). Use "accessory" when a movement supports a main lift in this program even if it's compound elsewhere (e.g. an incline press accessory to a flat bench).
- adv: what the app should move when the target is met. "manual" (default — shows the last session's numbers and proposes nothing), "load" (add weight: compound lifts where progressive overload is the main driver), "double" (work a rep range, add reps to the top of it, then add weight and drop back — the standard hypertrophy scheme, and it REQUIRES "repMin"/"repMax" on every working set), "reps" (add reps at the same weight: bodyweight work with no load to add — chin-ups, push-ups), "duration" (hold longer: planks, carries), "distance" (go further: running, rowing), or "none" (no suggestions at all). Default to "manual" for warm-ups, machines you don't push hard, and anything where auto-suggestions would be noise; prefer "double" over "load" for accessory and isolation work, which is where rep ranges belong.
- hits: how many sessions in a row at target before the app suggests a bump. 1 for linear progression and for "double" (its reset already lands you at the bottom of the range, so a higher gate banks a clear it did not earn), 2 for everything else. Omit to take the default.
- rir: optional, per set — the reps in reserve the athlete should stop with (0-5). Setting it means the app will NOT count a session until they log how hard it was, so use it only where autoregulation is the point of the exercise, and never on warm-ups.
- kg: use 0 for bodyweight, null if unknown
- rest: rest between sets in seconds (e.g. 90)
- type: "working" (default — counts toward progression) or "warmup" (excluded from auto-progression suggestions). Use "warmup" for the first 1–2 light sets of compound lifts (squat, bench, deadlift, OHP, rows). Omit for accessories and isolation work — they don't need warmup sets in the program.
- idx: 0-based index for exercise order within each program
- weeks must be one of: 4, 6, 8, 10, 12, 16
- day: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
- prog in cycle slots must exactly match a name in the "programs" array
- Exercise order: always list compound (type "compound") exercises before accessory/isolation (type "accessory"/"isolation") exercises within a program; finish with isometric core work where appropriate
- Starting weights: use ~75% of 1RM for 3–5 rep sets, ~70% for 6–8 reps, ~65% for 8–12 reps, ~60% for 12–15 reps. Estimate for exercises without PR data using body weight as reference where appropriate.
- Periodization: for beginner/novice experience levels use linear progression ("adv": "load" with "hits": 1). For intermediate/advanced use undulating periodization (vary rep ranges across sessions or programs, e.g. heavy/medium/light days) and prefer "adv": "double" on the accessory work.
- Weekly volume: aim for 10–20 working sets per muscle group per week across all programs in the cycle combined. Avoid both under-training (< 10 sets) and junk volume (> 20 sets).${equipmentRule}${frequencyRule}${durationRule}
${exerciseListText}
IMPORTANT: The list above contains exercises already in my library. Use those exact names whenever possible — only invent a new exercise name if the exercise genuinely does not exist in the list.
IMPORTANT: Keep programs focused — max 8 exercises per program, max 4 sets per exercise. Prioritise quality over quantity.`;
}

/** Full prompt for the manual clipboard flow (adds the interactive "ask one question" tail). */
export function buildManualClipboardPrompt(userProfile: UserProfile, exercises: Exercise[], prs: PrData[] = [], existingProgramNames: string[] = [], options: PromptOptions = {}): string {
  return `${buildAiSystemPrompt(userProfile, exercises, prs, existingProgramNames, options)}

First ask me one question: "What kind of training are you looking for? Tell me your goals, how many days a week you can train, and whether you want a structured weekly schedule or just standalone programs." Use my answer to generate everything. Then output only the raw JSON — no explanation, no markdown, no code block.`;
}
