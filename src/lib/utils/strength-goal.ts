/**
 * The strength part of an endurance plan, by strength goal and phase
 * (docs/plans/athlete-profile.md, 2.5; decisions D10 and D21).
 *
 * A default, not a rule: the assistant may plan another count if it gives
 * the reason, which the revision stores (D21). The check that refuses another
 * count until the assistant overrides it belongs to package D3, once seasons
 * store phases as cycles (owner, 2026-11-12).
 *
 * Research: docs/research/endurance-training-reference.md:214-222 (strength
 * by phase; Study for load and frequency, coach convention for the set/rep
 * schemes), :206 (concurrent training costs no muscle size, Schumann 2022),
 * :208 (heavy work and plyometrics improve economy; light work does not).
 */

import type { StrengthGoal } from "@/db/schema/athlete-profile";
import type { TrainingPhase } from "@/lib/utils/periodization";

/** Today's phases from the periodization curve, plus the season phases package C1 adds. */
export type StrengthPhase = TrainingPhase | "general" | "transition";

export const STRENGTH_PHASES: readonly StrengthPhase[] = ["general", "base", "build", "peak", "taper", "maintain", "transition"];

export const STRENGTH_GOAL_LABEL: Record<StrengthGoal, string> = {
  keep_muscle: "Keep muscle",
  stronger: "Get stronger",
  minimal: "Minimal",
};

/** One or two lines for the interview and the profile page. */
export const STRENGTH_GOAL_TEXT: Record<StrengthGoal, string> = {
  keep_muscle: "Moderate reps, with the main lifts heavy enough to keep your strength. Endurance work costs no muscle.",
  stronger: "Heavy main leg lifts at 3-6 reps plus jumps. The best-supported way to run and ride more economically.",
  minimal: "One short full-body session a week, to keep what you have.",
};

export type StrengthDefault = {
  sessionsPerWeek: number;
  /** The taper keeps one light session: the last heavy one is 7-10 days before the race. */
  light: boolean;
  scheme: string;
};

const SCHEME: Record<StrengthGoal, { early: string; late: string }> = {
  keep_muscle: {
    early: "Main lifts 3 x 6-10 at RIR 2-3; accessories 2 x 10-15.",
    late: "Main lifts 3 x 6-10 at RIR 2-3; accessories 2 x 10-15. No new exercises.",
  },
  stronger: {
    early: "Main leg lifts 3-4 x 3-6 at about 80-90% 1RM, RIR 1-3; plyometrics 2-4 x 5-10 contacts.",
    late: "Main leg lifts 2-3 x 3-5, load kept high, RIR 2-3. No new exercises, no eccentric-heavy work.",
  },
  minimal: {
    early: "One 30-40 minute full-body session: 2 x 5-8 on the main lifts.",
    late: "One 30-40 minute full-body session: 2 x 5-8 on the main lifts.",
  },
};

const TAPER = "Last heavy session 7-10 days before the race, then light activation only.";
const TRANSITION = "1-2 weeks off heavy lifting after the race, then start again light.";

/** The default strength sessions per week and scheme for a goal in a phase. */
export function strengthDefault(goal: StrengthGoal, phase: StrengthPhase): StrengthDefault {
  if (phase === "transition") return { sessionsPerWeek: 0, light: false, scheme: TRANSITION };
  if (phase === "taper") return { sessionsPerWeek: 1, light: true, scheme: TAPER };
  const early = phase === "general" || phase === "base" || phase === "maintain";
  const sessionsPerWeek = goal === "minimal" ? 1 : early ? 2 : 1;
  return { sessionsPerWeek, light: false, scheme: early ? SCHEME[goal].early : SCHEME[goal].late };
}

/** The whole table for one goal, phase by phase. */
export function strengthTable(goal: StrengthGoal): { phase: StrengthPhase; sessionsPerWeek: number; light: boolean; scheme: string }[] {
  return STRENGTH_PHASES.map((phase) => ({ phase, ...strengthDefault(goal, phase) }));
}
