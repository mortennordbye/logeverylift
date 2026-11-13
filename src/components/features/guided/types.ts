/** What the guided player, the pool view and the results screen get from the server (docs/plans/endurance-app.md, 3-5). */

import type { PlayStep } from "@/lib/utils/workout-player";

export type StepType = "warmup" | "work" | "recovery" | "cooldown" | "rest";

export type PlayerStepView = {
  key: string;
  type: StepType;
  round: { index: number; of: number } | null;
  /** Planned seconds of a time step (or a swim send-off); null waits for Lap. */
  seconds: number | null;
  /** "10 min 88-93% FTP" in the user's units. */
  text: string;
  /** The target in the user's numbers: "220-233 W". */
  targetText: string | null;
  /** Target bounds in metric (W, bpm, m/s, rpm), for the results screen. */
  targetLow: number | null;
  targetHigh: number | null;
  targetUnit: string | null;
  plannedMeters: number | null;
  /** "1000 m" in the user's units, for distance steps. */
  distanceText: string | null;
  note: string | null;
  stroke: string | null;
  /** A swim rep that leaves on a send-off: `seconds` is the send-off. */
  sendOff: boolean;
};

export type PlayerSession = {
  plannedSessionId: number;
  workoutHash: string;
  name: string;
  sport: "swim" | "bike" | "run";
  poolLengthM: number | null;
  steps: PlayerStepView[];
};

/** The play steps the state machine needs, from the server's view. */
export function toPlaySteps(steps: PlayerStepView[]): PlayStep[] {
  return steps.map((s) => ({
    key: s.key,
    type: s.type,
    round: s.round,
    seconds: s.seconds,
    step: { type: s.type, end: s.seconds !== null ? { type: "time", seconds: s.seconds } : { type: "lap" } },
  }));
}

export const STEP_WORD: Record<StepType, string> = {
  warmup: "Warm-up",
  work: "Work",
  recovery: "Easy",
  cooldown: "Cool-down",
  rest: "Rest",
};

/** Background colour of a step type (with text, never colour alone). */
export const STEP_TONE: Record<StepType, string> = {
  warmup: "bg-amber-500/15",
  work: "bg-rose-500/15",
  recovery: "bg-emerald-500/15",
  cooldown: "bg-sky-500/15",
  rest: "bg-muted",
};
