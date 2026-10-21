/**
 * The one-week check-in for plans built in AI Setup: when it is due, and how
 * the athlete's answer becomes a revised plan.
 *
 * Problems a pick can fix change the pick and rebuild, at no cost. Only what
 * picks can't express ("I don't like some exercises", a free-text note) goes
 * to an AI edit, and those requests cache like any other.
 */

import { EDIT_CHIP_IDS, EDIT_TEXT_MAX, type EditChipId, type EditRequest } from "@/lib/utils/ai-edit";
import { parseDateStr } from "@/lib/utils/cycle-position";
import { SESSION_MINUTES, TEMPLATE_LEVELS, type TemplateParams } from "@/lib/utils/plan-templates";

const CHECKIN_AFTER_DAYS = 7;
export const CHECKIN_NOTE_MAX = 300;

export const CHECKIN_ISSUES = [
  { id: "too_long", label: "Sessions take too long" },
  { id: "wrong_days", label: "Too few or too many training days" },
  { id: "equipment", label: "Equipment doesn't match my gym" },
  { id: "too_hard", label: "Too hard" },
  { id: "too_easy", label: "Too easy" },
  { id: "dislike_exercises", label: "I don't like some exercises" },
  { id: "other", label: "Something else" },
] as const;

export type CheckinIssue = (typeof CHECKIN_ISSUES)[number]["id"];
export const CHECKIN_ISSUE_IDS = CHECKIN_ISSUES.map((i) => i.id) as [CheckinIssue, ...CheckinIssue[]];

/**
 * Whether to ask: the cycle is running, started at least a week ago, and the
 * athlete hasn't answered. A draft, finished or deleted cycle is never asked about.
 */
export function checkinDue(
  plan: { checkinStatus: string },
  cycle: { status: string; startDate: string | null } | null,
  today: Date,
): boolean {
  if (plan.checkinStatus !== "pending" || !cycle || cycle.status !== "active" || !cycle.startDate) return false;
  const start = parseDateStr(cycle.startDate);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((midnight.getTime() - start.getTime()) / 86_400_000) >= CHECKIN_AFTER_DAYS;
}

export type Revision = {
  /** Picks with every pick-based fix applied. */
  picks: TemplateParams;
  /** The AI edit to apply on top, or null when the picks cover everything. */
  request: EditRequest | null;
  /** The athlete needs to choose a pick themselves (days or equipment). */
  repick: "daysPerWeek" | "equipment" | null;
  /** What changed, in words, for the page to show. */
  changes: string[];
};

/**
 * The revised plan for a "doesn't fit" answer. Starts from the original picks
 * and edit, so a revision keeps what the athlete already chose.
 */
export function revisionFor(
  original: { picks: TemplateParams; edit: EditRequest | null },
  issues: CheckinIssue[],
  note: string,
): Revision {
  const picks: TemplateParams = { ...original.picks };
  const changes: string[] = [];
  const aiAsks: string[] = [];
  let repick: Revision["repick"] = null;

  if (issues.includes("too_long")) {
    const minutes = picks.sessionMinutes ?? 60;
    const shorter = [...SESSION_MINUTES].reverse().find((m) => m < minutes);
    if (shorter) {
      picks.sessionMinutes = shorter;
      changes.push(`Sessions shortened to ${shorter} minutes`);
    } else {
      aiAsks.push("Make each session shorter");
    }
  }

  const levelStep = (issues.includes("too_easy") ? 1 : 0) - (issues.includes("too_hard") ? 1 : 0);
  if (levelStep !== 0) {
    const index = TEMPLATE_LEVELS.indexOf(picks.level) + levelStep;
    if (index >= 0 && index < TEMPLATE_LEVELS.length) {
      picks.level = TEMPLATE_LEVELS[index];
      changes.push(`Experience set to ${picks.level}`);
    } else {
      aiAsks.push(levelStep > 0 ? "Make the plan more challenging" : "Make the plan easier");
    }
  }

  if (issues.includes("equipment")) repick = "equipment";
  if (issues.includes("wrong_days")) repick = "daysPerWeek";

  const chips: EditChipId[] = [...(original.edit?.chips ?? [])];
  const trimmedNote = note.trim();
  if (issues.includes("dislike_exercises") && !chips.includes("swap_named")) chips.push("swap_named");
  if ((issues.includes("dislike_exercises") || issues.includes("other")) && trimmedNote) aiAsks.push(trimmedNote);

  const text = [original.edit?.text.trim() ?? "", ...aiAsks].filter(Boolean).join(". ").slice(0, EDIT_TEXT_MAX);
  const newAiWork = aiAsks.length > 0 || chips.length > (original.edit?.chips.length ?? 0);
  // swap_named needs a note naming the exercises; without one, the athlete writes it on the page.
  const request: EditRequest | null =
    newAiWork || original.edit
      ? { chips: EDIT_CHIP_IDS.filter((id) => chips.includes(id)), text }
      : null;

  return { picks, request, repick, changes };
}
