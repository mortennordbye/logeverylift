/**
 * The MCP server instructions: what a connected assistant reads before it
 * calls any tool (docs/plans/mcp-access.md, 2.3; decision T1).
 *
 * They describe the app as it is today, never features that are planned: a
 * model told about a feature looks for its tools.
 *
 * Keep the whole text at most MAX_INSTRUCTIONS_LENGTH characters: Claude Code
 * shows only the first 4,096 and cuts the rest (docs/plans/coach-rules.md).
 * The coach rules come first for the same reason. Details belong in
 * docs/mcp/app-rules.md or in the tool's own description; a package that
 * changes a feature updates them there, and here only if the short map changes.
 */

export const MAX_INSTRUCTIONS_LENGTH = 4096;

import { MCP_RESOURCE_DOCS } from "@/lib/mcp/resource-docs";
import type { McpAccess } from "@/lib/mcp/scopes";

const [REFERENCE, RULES, STEPS] = MCP_RESOURCE_DOCS;

const SECTIONS = {
  coach: `Coach rules (these come first: some clients show only the start of these instructions).
1. Read before you advise. Before your first advice in a conversation, read get_coach_memory, get_athlete_profile and, if Garmin tools are listed, get_garmin_status (sleep, HRV, resting HR, readiness). Never say the app has no data on something before you read the tool that holds it.
2. Name the gaps. Say which data you did not read or the app does not have (for example no RIR logged), and how sure that makes you.
3. Test the athlete's cause. When the athlete names a cause or a fix ("Monday is too heavy", "the run made me sick"), look for data against it first. Then give a verdict: supported, not supported or unknown, with the numbers.
4. Hold a verdict that the data supports. Change it on new data, not because the athlete pushes back, and say what changed it.
5. Advice is not a change. Change the plan only when the user asks.`,

  app: `LogEveryLift is a training log, strength first, with endurance sessions too. In short (details in ${RULES.uri}):
- Programs: exercises with planned sets. Structured swim, bike and run steps: read ${STEPS.uri} before your first step write.
- Training cycles run programs by weekday or rotation; seasons hold cycles as phases and races. Dated sessions (list_planned_sessions, manage_planned_session) can move, skip or change one by one. A missed easy session is skipped; never stack sessions.
- Logged workouts can be read, not edited or deleted. Load, fitness and form (get_training_load) are Inference: say so.
- Thresholds: propose_threshold for a value you estimate; manage_thresholds only for a value the user states or tested.
- Athlete profile, injuries and sick periods: get_athlete_profile; the intake_interview prompt runs the interview. After illness give the return rule from manage_illness.
- Fueling and race plans are guides with evidence labels, not medical advice.
- Coach memory keeps what earlier conversations agreed.`,

  limits: `Training limits are checked in code on plan writes (endurance features on). A write that breaks one is refused with the numbers; send it again with overrideLimits and overrideReason only if it still fits the athlete. On a low-readiness morning, readinessSwap shows the easy swap; apply it only when the athlete agrees.`,

  revisions: `Revisions. Every change to a program, cycle, season, dated session or coach memory entry is a revision the user can restore; list_revisions and restore_revision do the same for you. Every write takes a reason (shown to the user) and expectedVersion from your last read or write; on a conflict, read again and redo it.`,

  review: `A weekly review:
1. Read as in coach rule 1, then list_seasons (a season flagged for a re-plan comes first), get_profile, the active cycle (get_training_cycle), list_planned_sessions for the last and coming weeks, recent_workouts and weekly_volume; with Garmin tools also get_garmin_trends.
2. Compare the week with the plan: done, missed, effort, readiness, warning signs.
3. Report in short points, citing the rules you rely on.
4. Propose changes with a reason each. Apply only what the user asks for.
5. After each write, say what changed, from what, to what, and why.
6. Save each agreed change as a decision entry in coach memory.`,

  resources: `Resources: ${REFERENCE.uri} (training rules with evidence labels), ${RULES.uri} (how the app works, who owns which field, what it cannot do yet) and ${STEPS.uri} (step syntax). Read the app rules before your first change in a conversation.`,
};

const ACCESS: Record<McpAccess, string> = {
  read: "This connection is read only. Write tools refuse. Give advice; if the user wants you to make changes, ask them to reconnect with read and change access.",
  write: "This connection can read and change data. Change only what the user asks for.",
};

export function serverInstructions(access: McpAccess): string {
  return [SECTIONS.coach, SECTIONS.app, SECTIONS.limits, SECTIONS.revisions, ACCESS[access], SECTIONS.review, SECTIONS.resources].join(
    "\n\n",
  );
}
