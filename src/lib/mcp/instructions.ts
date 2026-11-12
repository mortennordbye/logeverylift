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
- Training cycles: a template that runs programs for some weeks, by weekday (up to three slots a day, daySlot 1-3, for example strength in the morning and a run in the evening) or as a rotation, with a periodization curve and a weekly sync of the active cycle. A cycle in no season can hold a race, a goal and an athlete level (endurance features only), and a draft can be scheduled to start on a later day.
- Seasons: a long goal above cycles (list_seasons, get_season, manage_season), for every user. A season holds races with priority A, B or C (manage_race, endurance features only) and its phases: training cycles in order, each with an optional phase type (general, base, build, peak, taper, transition) and a length in weeks or days. When a phase starts, the next one is scheduled for the day after it ends. A cycle in a season stores no race; it reads the season's A race. The taper is placed from the A race: get_season says whether it ends on race day, and fit_taper fixes it. When a race date or an A race changes, the season is flagged for a re-plan; the app never reshapes the phases itself, so re-plan them and clear the flag (clear_replan).
- Dated sessions: a weekday cycle makes one dated session per slot for the whole block. Each can be moved, skipped or changed alone (list_planned_sessions, manage_planned_session); a template edit rewrites only sessions from today on that nobody changed, and past sessions never change. Done and missed are matched from logged workouts. A rotation cycle has no fixed dates (a missed session repeats the next day), so its sessions are worked out from the walk and you can only skip or change one by its rotationPosition.
- Exercises: the built-in library and the user's own custom exercises. Find one with search_exercises; make a custom one with create_exercise (set its discipline swim, bike or run on an endurance exercise).
- Workout sessions: what the user logged, set by set, with the user's notes. You can read them. You can log a session done outside the app (log_session) and mark a planned day of the active cycle as done (confirm_session). You cannot edit or delete a session.
- Profile and body weight history.
- Thresholds (every user): FTP, threshold heart rate for bike and run, threshold run pace, swim CSS and max HR, each value with its date and source (typed in, a field test, or a Garmin estimate the user took), so the stored values are the history. get_athlete_profile reads them; manage_thresholds adds, changes or deletes one.
- Athlete profile (endurance features only): endurance experience, available days, hours per week, the longest day, the strength goal (keep_muscle, stronger, minimal), injuries and limits, and the intake interview. get_athlete_profile reads it; manage_athlete_profile and manage_injuries change it. The prompt intake_interview runs the interview step by step.
- Strength in an endurance plan follows the strength goal: get_athlete_profile gives the default sessions per week for the phase and the scheme. It is a default: plan another count only with the reason in your write's reason.
- Coach memory: what earlier conversations agreed or learned (preferences, life limits, observations, decisions), kept for you between conversations. get_coach_memory reads it; manage_coach_memory changes it. The user sees and edits it in the app.
- Settings in get_profile: the user's time zone, which decides "today", the cycle week and the weekly sync; display units (km or mi, m or yd), which change only what the app shows, since every tool value is metric (kg, metres, seconds); and enduranceEnabled, the endurance add-on (triathlon plan, race on a cycle), which only an admin can turn on.`,

  owners: `Who owns which field. The progression engine owns target reps and weight on strength sets: an edit is a one-off until the next session. The weekly sync owns distance and duration on sets with a peak anchor (an edit becomes the new peak), and heart rate zone and rest on "work" sets with a peak anchor (a different value is refused; send sessionRole null on the set to take them over). To make one week lighter or harder, use manage_training_cycle set_volume: it sets the same volume factor the sync uses, for this week only. Details: ${RULES.uri}.`,

  limits: `Training limits. For users with endurance features on, two limits are checked in code on your plan writes: long_run_cap (no planned run more than 1.10x the longest run in the last 30 days; needs Garmin data, otherwise not checked) and hard_sessions_per_week (at most 3 interval sessions, a "work" set or zone 4-5, in a weekday cycle's week; for a moved, changed or added dated session, in each Monday-to-Sunday week it touches). A write that breaks one is refused with the rule, the numbers and the evidence label, and nothing changes. If the change still fits the athlete, send it again with overrideLimits and overrideReason; the user sees the reason. Every checked write says which limits ran and which did not, and why. The other rules (weekly load ramp, no hard session after a low-readiness day, no heavy legs within 48 h of a key session) are not in code yet: check them against ${REFERENCE.uri} yourself and name the rule and its evidence label.`,

  revisions: `Revisions. Every change to a program, cycle, season, dated session or coach memory entry, by you, the user or the app, is a revision the user can see and restore in the app; list_revisions and restore_revision do the same for you. Every write takes a reason (shown to the user) and expectedVersion, the version you read with get_program, get_training_cycle, get_season or list_planned_sessions or got back from your last write. A write based on an older version is refused with what changed since: read again and redo it. Your writes within 30 minutes form one change set the user can undo in one step. A restore never changes logged workouts. There is no undo button for you to promise beyond that.`,

  missing: `Not in the app yet, so do not look for it or promise it:
- Strength frequency by phase is a default only; no code refuses another count yet.`,

  review: `A weekly review:
1. Read get_coach_memory first, then list_seasons (a season flagged for a re-plan comes first: re-plan its phases with the user), get_athlete_profile and get_profile, the active cycle (list_training_cycles, get_training_cycle), the planned sessions of the last and the coming weeks (list_planned_sessions), recent_workouts, weekly_volume and personal_records. If Garmin tools are listed, read get_garmin_status and get_garmin_trends.
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
