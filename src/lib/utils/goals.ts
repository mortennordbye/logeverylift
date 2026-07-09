export const GOAL_VALUES = [
  "strength",
  "muscle_gain",
  "weight_loss",
  "endurance",
  "general_fitness",
] as const;

export type Goal = (typeof GOAL_VALUES)[number];

/** Parse the goals JSON array string from the DB into validated Goal values. */
export function parseUserGoals(goalsJson: string | null | undefined): Goal[] {
  if (goalsJson) {
    try {
      const parsed = JSON.parse(goalsJson);
      if (Array.isArray(parsed)) {
        return parsed.filter((g): g is Goal => GOAL_VALUES.includes(g as Goal));
      }
    } catch {
      // fall through
    }
  }
  return [];
}
