/**
 * What the "Did you do it?" answers show of one session
 * (docs/plans/workouts-and-compliance.md, 6.5). A plain module, so Server
 * Components can shape the props they pass to the client answers.
 */

import type { SessionCompliance } from "@/lib/session-compliance";
import type { Sport } from "@/lib/utils/session-compliance";

export type AnswerSession = { id: number; date: string; name: string; summary: string | null; sport: Sport | null };

const SPORT_NAME: Record<Sport, string> = { swim: "Swim", bike: "Ride", run: "Run" };

/** A session as the answers show it: its label or workout name, then its program, then its sport. */
export function answerSession(s: Pick<SessionCompliance, "id" | "date" | "label" | "programName" | "workout" | "workoutSummary" | "sport">): AnswerSession {
  const name = s.label ?? s.workout?.name ?? s.programName ?? (s.sport ? SPORT_NAME[s.sport] : "Session");
  return { id: s.id, date: s.date, name, summary: s.workoutSummary, sport: s.sport };
}
