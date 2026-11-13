/**
 * Every action the Today widget offers, as data (docs/home-widgets-audit.md,
 * 6.7). The S size shows `primary` and puts `more` behind a "More" button; L
 * and M show them all in place. Every size keeps every action.
 */

import type { TodaySession } from "@/types/workout";

export type TodayAction =
  | { kind: "link"; href: string; label: string; primary: boolean; ariaLabel?: string }
  | { kind: "skip"; sessionId: number };

export type TodayActionInput = {
  hasCycle: boolean;
  todayProgram: { id: number; name: string } | null;
  severalToday: boolean;
  todaySessions: TodaySession[];
  completedToday: boolean;
  todayAutoSession: { id: number } | null;
};

const DIFFERENT: TodayAction = { kind: "link", href: "/new-workout", label: "Different Program", primary: false };

export function todayActions(d: TodayActionInput): { primary: TodayAction | null; more: TodayAction[] } {
  if (!d.hasCycle) {
    return { primary: { kind: "link", href: "/cycles", label: "Set up a Cycle →", primary: true }, more: [] };
  }
  if (d.severalToday) {
    const all: TodayAction[] = [];
    for (const s of d.todaySessions) {
      const program = s.slot.program;
      const name = program?.name ?? s.slot.label ?? "Session";
      if (s.autoSessionId != null) all.push({ kind: "skip", sessionId: s.autoSessionId });
      if (program) {
        all.push({
          kind: "link",
          href: `/programs/${program.id}/workout?planned=${s.plannedSessionId}`,
          label: s.done ? "Do again" : "Start",
          ariaLabel: `${s.done ? "Do again" : "Start"} ${name}`,
          primary: !s.done,
        });
      }
    }
    const firstOpen = all.find((a) => a.kind === "link" && a.primary) ?? null;
    return { primary: firstOpen, more: [...all.filter((a) => a !== firstOpen), DIFFERENT] };
  }
  if (d.todayProgram) {
    const href = `/programs/${d.todayProgram.id}/workout`;
    const primary: TodayAction = d.completedToday
      ? { kind: "link", href, label: d.todayAutoSession ? "Log in app" : "Do Again", primary: false }
      : { kind: "link", href, label: "Start Today's Workout", primary: true };
    const more: TodayAction[] = [];
    if (d.todayAutoSession) more.push({ kind: "skip", sessionId: d.todayAutoSession.id });
    more.push(DIFFERENT);
    return { primary, more };
  }
  return {
    primary: { kind: "link", href: "/new-workout", label: d.completedToday ? "Do Another Workout →" : "Start a Workout →", primary: false },
    more: [],
  };
}
