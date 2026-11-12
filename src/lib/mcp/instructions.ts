/**
 * The MCP server instructions: what a connected assistant reads before it
 * calls any tool (docs/plans/mcp-access.md, 2.3; decision T1).
 *
 * They describe the app as it is today, never features that are planned: a
 * model told about a feature looks for its tools. When a package adds a
 * feature (the endurance switch, revisions, coach memory, seasons, dated
 * sessions, training limits), it adds or changes its section here and in
 * docs/mcp/app-rules.md in the same PR, and removes the matching line from
 * "Not in the app yet".
 */

import { MCP_RESOURCE_DOCS } from "@/lib/mcp/resource-docs";
import type { McpAccess } from "@/lib/mcp/scopes";

const [REFERENCE, RULES] = MCP_RESOURCE_DOCS;

const SECTIONS = {
  app: `LogEveryLift is a training log, strength first, with endurance sessions too.
- Programs: exercises with planned sets (reps or a rep range, weight, rest; or duration, distance and heart rate zone).
- Training cycles: a template that runs programs for some weeks, by weekday (one slot a day) or as a rotation, with a periodization curve and a weekly sync of the active cycle.
- Workout sessions: what the user logged, set by set. You can read them; you cannot log or edit them.
- Profile and body weight history.`,

  owners: `Who owns which field. The progression engine owns target reps and weight on strength sets: an edit is a one-off until the next session. The weekly sync owns distance and duration on sets with a peak anchor (an edit becomes the new peak) and heart rate zone and rest on "work" sets (overwritten next week). Details: ${RULES.uri}.`,

  missing: `Not in the app yet, so do not look for it or promise it:
- No undo or revision history. Every write applies at once and is final. Say exactly what you changed.
- No training limits checked in code. Check changes against ${REFERENCE.uri} yourself and name the rule and its evidence label.
- One workout slot per day in a weekday cycle. No seasons above cycles.
- No session notes over MCP. "Today" uses the server's clock, not the user's time zone. All values are metric.`,

  review: `A weekly review:
1. Read get_profile, the active cycle (list_training_cycles, get_training_cycle), recent_workouts, weekly_volume and personal_records. If Garmin tools are listed, read get_garmin_status and get_garmin_trends.
2. Compare the week with the plan: what was done, what was missed, effort and readiness, any warning sign.
3. Report that to the user in short points, citing the rules you rely on.
4. Propose changes with a reason each. Apply only what the user asks for.
5. After each write, say what changed, from what, to what, and why.`,

  resources: `Resources: ${REFERENCE.uri} (training rules with evidence labels) and ${RULES.uri} (how the app works and its limits). Read the rules before your first change in a conversation.`,
};

const ACCESS: Record<McpAccess, string> = {
  read: "This connection is read only. Write tools refuse. Give advice; if the user wants you to make changes, ask them to reconnect with read and change access.",
  write: "This connection can read and change data. Change only what the user asks for.",
};

export function serverInstructions(access: McpAccess): string {
  return [SECTIONS.app, SECTIONS.owners, SECTIONS.missing, ACCESS[access], SECTIONS.review, SECTIONS.resources].join(
    "\n\n",
  );
}
