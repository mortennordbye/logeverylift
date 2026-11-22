/**
 * Strict work steps (docs/plans/strict-targets.md, decisions 2 and 3): a bike
 * work step names power, heart rate and cadence; a run work step names the
 * belt speed, heart rate and cadence. So each step has a target for both
 * places, inside and outside.
 *
 * This is a check for new input only, never part of parseWorkout: that also
 * reads every stored program, and old programs must keep loading, sharing,
 * copying and taking small edits. The writers that take new step input (MCP
 * edit_program_exercise and the app's saveExerciseSteps) call it, and only for
 * the steps whose targets are new: a step whose kind and targets match a step
 * the exercise already held passes as it is (`stepTargetKey`).
 *
 * A work step under 3 min needs no heart rate (decision 1: heart rate is too
 * slow for it), only power or the belt, and cadence. Under 3 min is a time
 * step under 180 s or a distance step of 800 m or less: the app's step time
 * estimates need the athlete's thresholds and the place, so the check uses
 * the distance alone.
 *
 * Exempt: warm-up, cool-down, recovery and rest steps; ramps and free spins;
 * every step of a test (FTP ramp and 20 min, run 30 min: the workout's
 * `test`); swims. The easy start of a brick run is not written on the steps:
 * the run screen derives it for the first 10 min of any brick run
 * (`BRICK_EASY_S` in src/lib/utils/run-screen.ts), so it needs no exemption here.
 *
 * Pure: the step editor, the save action and the MCP tool call it.
 */

import type { Workout, WorkoutSport, WorkoutStep } from "@/lib/utils/workout-steps";

/** What a work step can lack: the main inside target (power or belt), heart rate, cadence. */
export type WorkStepNeed = "power" | "belt" | "hr" | "cadence";

const NEED_WORD: Record<WorkStepNeed, string> = { power: "power", belt: "belt speed", hr: "heart rate", cadence: "cadence" };

const listText = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/** Under 3 min (180 s), the length where a work step needs no heart rate. */
export const SHORT_WORK = { seconds: 180, meters: 800 } as const;

/** A work step under 3 min: a time step under 180 s, or a distance step of 800 m or less. A lap step is not. */
export function isShortStep(step: Pick<WorkoutStep, "end">): boolean {
  if (step.end.type === "time") return step.end.seconds < SHORT_WORK.seconds;
  if (step.end.type === "distance") return step.end.meters <= SHORT_WORK.meters;
  return false;
}

/**
 * "A bike work step needs power, heart rate and cadence" (the step editor's
 * words), or for a step under 3 min "A bike work step under 3 min needs power
 * and cadence".
 */
export function workStepRuleText(sport: WorkoutSport, short = false): string {
  const main = sport === "run" ? "belt speed" : "power";
  return short ? `A ${sport} work step under 3 min needs ${listText([main, "cadence"])}` : `A ${sport} work step needs ${listText([main, "heart rate", "cadence"])}`;
}

/** "heart rate and cadence" */
export function needsText(needs: WorkStepNeed[]): string {
  return listText(needs.map((n) => NEED_WORD[n]));
}

/** What one step lacks. Empty when the step is complete or the rule does not apply to it. */
export function workStepMissing(step: WorkoutStep, sport: WorkoutSport, test?: Workout["test"] | null): WorkStepNeed[] {
  if (sport === "swim" || test != null) return [];
  if (step.type !== "work" || step.ramp || step.free) return [];
  const metrics = [step.target?.metric, step.target2?.metric];
  const out: WorkStepNeed[] = [];
  if (sport === "bike" && !metrics.includes("power")) out.push("power");
  if (sport === "run" && step.belt === undefined) out.push("belt");
  if (!metrics.includes("hr") && !isShortStep(step)) out.push("hr");
  if (!step.cadence && !metrics.includes("cadence")) out.push("cadence");
  return out;
}

/** A value as JSON with its keys sorted, so a target read back from jsonb matches the one written. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * A step's kind and targets as one string. A step with the same key as one
 * the exercise held already is an old step (its length, note or rest may have
 * changed), and the check leaves it as it was.
 */
export function stepTargetKey(s: WorkoutStep): string {
  return canonical({ type: s.type, target: s.target, target2: s.target2, cadence: s.cadence, belt: s.belt, ramp: s.ramp, free: s.free });
}

/** The keys of every step of a tree. */
export function workoutStepKeys(w: Workout): Set<string> {
  return new Set(w.steps.flatMap((n) => (n.type === "repeat" ? n.steps : [n])).map(stepTargetKey));
}

export type WorkStepGap = {
  /** "steps[2]" or "steps[1].steps[0]", as parseWorkout's paths. */
  path: string;
  /** The step's place in the list, counting the steps of a repeat block once, from 1. */
  number: number;
  missing: WorkStepNeed[];
  /** Under 3 min: no heart rate needed (`isShortStep`). */
  short: boolean;
};

/**
 * The work steps of a tree that lack a required target. Steps whose key is in
 * `known` (the steps the exercise held before this write) are left out.
 */
export function workStepGaps(w: Workout, known: ReadonlySet<string> = new Set()): WorkStepGap[] {
  const out: WorkStepGap[] = [];
  let number = 0;
  const see = (s: WorkoutStep, path: string) => {
    number++;
    if (known.has(stepTargetKey(s))) return;
    const missing = workStepMissing(s, w.sport, w.test);
    if (missing.length) out.push({ path, number, missing, short: isShortStep(s) });
  };
  w.steps.forEach((n, i) => {
    if (n.type === "repeat") n.steps.forEach((s, j) => see(s, `steps[${i}].steps[${j}]`));
    else see(n, `steps[${i}]`);
  });
  return out;
}
