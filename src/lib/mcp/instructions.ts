/**
 * The MCP server instructions: what a connected assistant reads before it
 * calls any tool (docs/plans/mcp-access.md, 2.3; decision T1).
 *
 * They describe the app as it is today, never features that are planned: a
 * model told about a feature looks for its tools. When a package adds a
 * feature (coach memory, seasons, dated
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
- Training cycles: a template that runs programs for some weeks, by weekday (one slot a day) or as a rotation, with a periodization curve and a weekly sync of the active cycle. A cycle can hold a race, a goal and an athlete level (endurance features only), and a draft can be scheduled to start on a later day.
- Exercises: the built-in library and the user's own custom exercises. Find one with search_exercises; make a custom one with create_exercise (set its discipline swim, bike or run on an endurance exercise).
- Workout sessions: what the user logged, set by set, with the user's notes. You can read them. You can log a session done outside the app (log_session) and mark a planned day of the active cycle as done (confirm_session). You cannot edit or delete a session.
- Profile and body weight history.
- Coach memory: what earlier conversations agreed or learned (preferences, life limits, observations, decisions), kept for you between conversations. get_coach_memory reads it; manage_coach_memory changes it. The user sees and edits it in the app.
- Settings in get_profile: the user's time zone, which decides "today", the cycle week and the weekly sync; display units (km or mi, m or yd), which change only what the app shows, since every tool value is metric (kg, metres, seconds); and enduranceEnabled, the endurance add-on (triathlon plan, race on a cycle), which only an admin can turn on.`,

  owners: `Who owns which field. The progression engine owns target reps and weight on strength sets: an edit is a one-off until the next session. The weekly sync owns distance and duration on sets with a peak anchor (an edit becomes the new peak), and heart rate zone and rest on "work" sets with a peak anchor (a different value is refused; send sessionRole null on the set to take them over). To make one week lighter or harder, use manage_training_cycle set_volume: it sets the same volume factor the sync uses, for this week only. Details: ${RULES.uri}.`,

  limits: `Training limits. For users with endurance features on, two limits are checked in code on your plan writes: long_run_cap (no planned run more than 1.10x the longest run in the last 30 days; needs Garmin data, otherwise not checked) and hard_sessions_per_week (at most 3 interval sessions, a "work" set or zone 4-5, in a weekday cycle's week). A write that breaks one is refused with the rule, the numbers and the evidence label, and nothing changes. If the change still fits the athlete, send it again with overrideLimits and overrideReason; the user sees the reason. Every checked write says which limits ran and which did not, and why. The other rules (weekly load ramp, no hard session after a low-readiness day, no heavy legs within 48 h of a key session) are not in code yet: check them against ${REFERENCE.uri} yourself and name the rule and its evidence label.`,

  revisions: `Revisions. Every change to a program or cycle, by you, the user or the app, is a revision the user can see and restore in the app; list_revisions and restore_revision do the same for you. Every write takes a reason (shown to the user) and expectedVersion, the version you read with get_program or get_training_cycle or got back from your last write. A write based on an older version is refused with what changed since: read again and redo it. Your writes within 30 minutes form one change set the user can undo in one step. A restore never changes logged workouts. There is no undo button for you to promise beyond that.`,

  missing: `Not in the app yet, so do not look for it or promise it:
- One workout slot per day in a weekday cycle. No seasons above cycles.
- No tables yet for injuries, availability or thresholds: keep injuries and weekly availability in coach memory as limit or observation entries.`,

  review: `A weekly review:
1. Read get_coach_memory first, then get_profile, the active cycle (list_training_cycles, get_training_cycle), recent_workouts, weekly_volume and personal_records. If Garmin tools are listed, read get_garmin_status and get_garmin_trends.
2. Compare the week with the plan: what was done, what was missed, effort and readiness, any warning sign.
3. Report that to the user in short points, citing the rules you rely on.
4. Propose changes with a reason each. Apply only what the user asks for.
5. After each write, say what changed, from what, to what, and why.
6. Save each agreed change as a decision entry in coach memory, with the date and the reason.`,

  resources: `Resources: ${REFERENCE.uri} (training rules with evidence labels) and ${RULES.uri} (how the app works and its limits). Read the rules before your first change in a conversation.`,
};

const ACCESS: Record<McpAccess, string> = {
  read: "This connection is read only. Write tools refuse. Give advice; if the user wants you to make changes, ask them to reconnect with read and change access.",
  write: "This connection can read and change data. Change only what the user asks for.",
};

export function serverInstructions(access: McpAccess): string {
  return [SECTIONS.app, SECTIONS.owners, SECTIONS.limits, SECTIONS.revisions, SECTIONS.missing, ACCESS[access], SECTIONS.review, SECTIONS.resources].join(
    "\n\n",
  );
}
