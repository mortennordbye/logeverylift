/**
 * MCP tools: the athlete profile, thresholds, injuries and the intake
 * interview (docs/plans/athlete-profile.md, 2.6 and 2.8). Every write is a
 * revision with the assistant's reason. Values are metric.
 *
 * Thresholds are for every user (D15). The profile and injury tools are
 * registered only with the endurance switch on (D18); the read returns their
 * part only then. Garmin suggestions only where Garmin is allowed (admins).
 */

import { ENDURANCE_LEVELS, INJURY_AREAS, INJURY_SIDES, INJURY_STATUSES, STRENGTH_GOALS, THRESHOLD_KINDS, THRESHOLD_PROTOCOLS, type ThresholdKind } from "@/db/schema";
import {
  activeCyclePhase,
  addInjury,
  addThreshold,
  changeInjury,
  changeThreshold,
  garminSuggestions,
  getAthleteProfile,
  interviewRace,
  listInjuries,
  listThresholds,
  memoryToOffer,
  missingSteps,
  saveAthleteProfile,
  type ThresholdRow,
} from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, expectedVersionArg, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { strengthDefault, strengthTable } from "@/lib/utils/strength-goal";
import { THRESHOLD_MEASURE, currentThresholds, isStale, minSec, protocolsFor, weeksSince } from "@/lib/utils/thresholds";
import { dateStr, dayOfWeek, testData } from "@/lib/validators/athlete-profile";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** A stored threshold as the model reads it: metric, plus the pace in seconds. */
function thresholdOut(t: ThresholdRow, today: string) {
  const m = THRESHOLD_MEASURE[t.kind];
  return {
    id: t.id,
    kind: t.kind,
    value: Math.round(t.value * 1000) / 1000,
    unit: m === "watts" ? "W" : m === "bpm" ? "bpm" : "m/s",
    ...(m === "runPace" ? { paceSecondsPerKm: Math.round(1000 / t.value), pace: `${minSec(1000 / t.value)} /km` } : {}),
    ...(m === "swimPace" ? { paceSecondsPer100m: Math.round(100 / t.value), pace: `${minSec(100 / t.value)} /100m` } : {}),
    measuredOn: t.measuredOn,
    source: t.source,
    protocol: t.protocol,
    testData: t.testData,
    notes: t.notes,
    ageWeeks: weeksSince(t.measuredOn, today),
    stale: isStale(t.measuredOn, today),
    version: t.version,
  };
}

/** The typed value for a kind, from the one input field that fits it. */
function valueFor(
  kind: ThresholdKind,
  a: { watts?: number; bpm?: number; paceSecondsPerKm?: number; paceSecondsPer100m?: number },
): { value?: number } | { error: string } {
  const m = THRESHOLD_MEASURE[kind];
  const given = Object.entries(a).filter(([, v]) => v !== undefined).map(([k]) => k);
  const want = m === "watts" ? "watts" : m === "bpm" ? "bpm" : m === "runPace" ? "paceSecondsPerKm" : "paceSecondsPer100m";
  const wrong = given.filter((g) => g !== want);
  if (wrong.length) return { error: `${kind} takes ${want}, not ${wrong.join(", ")}` };
  if (m === "watts") return { value: a.watts };
  if (m === "bpm") return { value: a.bpm };
  if (m === "runPace") return { value: a.paceSecondsPerKm ? 1000 / a.paceSecondsPerKm : undefined };
  return { value: a.paceSecondsPer100m ? 100 / a.paceSecondsPer100m : undefined };
}

const PROTOCOL_TEXT = THRESHOLD_KINDS.flatMap((k) => protocolsFor(k).map((p) => `${k} by ${p.protocol} (testData: ${p.inputs.map((i) => i.key).join(", ")})`));

export const INTERVIEW_STEPS = [
  "1. Race: read it from get_athlete_profile (race). If none is set, ask the user and set it on the cycle with manage_training_cycle.",
  "2. Experience: novice, intermediate or advanced in endurance sport (manage_athlete_profile enduranceLevel).",
  "3. Availability: which days they can train (1 = Monday ... 7 = Sunday), hours a normal week can hold, the longest day in minutes and which day (availableDays, hoursPerWeek, longestDayMinutes, longDay).",
  "4. Strength goal: keep_muscle (moderate reps, main lifts heavy enough to keep strength), stronger (heavy main leg lifts at 3-6 reps plus plyometrics), or minimal (one short session a week). Explain the frequency by phase from strength.table.",
  "5. Thresholds: for each kind, the current value or a field test (manage_thresholds). Offer the Garmin suggestion where one is listed, and say it is an estimate.",
  "6. Injuries and limits: current and past injuries, what to avoid (manage_injuries).",
  "7. Coach memory: for each entry in interview.memoryToOffer, read it back to the user. If it is an injury or availability, write the fact with the tools above, then deactivate the entry with manage_coach_memory (reason: Moved to the athlete profile). Keep life limits such as travel or equipment in memory.",
  "8. Finish: manage_athlete_profile completeInterview true, and tell the user what you stored.",
];

export function registerAthleteProfileTools(server: McpServer, userId: string, clientId?: string, opts: { endurance?: boolean } = {}) {
  const endurance = opts.endurance ?? false;

  server.registerTool(
    "get_athlete_profile",
    {
      description: [
        "The user's thresholds: the current value per kind (ftp W; lthr_bike, lthr_run, max_hr bpm; run_threshold_pace and swim_css in m/s, with the pace in seconds per km or per 100 m), its date, source (manual, test, garmin), age in weeks and a stale flag after 8 weeks. history true adds every stored value.",
        "With endurance features on, also: the athlete profile (endurance level, available days 1 = Monday, hours per week, longest day, strength goal), the race, injuries (past ones with includePast), the strength default for the active cycle's phase and the whole table, and the intake interview: whether it is complete, which steps have no answer, and the coach memory entries to offer for moving.",
        "Garmin estimates appear as suggestions only where Garmin is enabled; they are not stored until you or the user take one. Read this before planning, after get_coach_memory. Health data: use it for coaching only.",
      ].join(" "),
      inputSchema: { history: z.boolean().default(false), includePast: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ history, includePast }) => {
      try {
        const today = toDateStr(await userToday(userId));
        const rows = await listThresholds(userId);
        const current = currentThresholds(rows);
        const thresholds = Object.fromEntries(THRESHOLD_KINDS.map((k) => [k, current[k] ? thresholdOut(current[k], today) : null]));
        const suggestions = await garminSuggestions(userId, rows);
        const base = {
          endurance,
          thresholds,
          ...(history ? { history: rows.map((r) => thresholdOut(r, today)) } : {}),
          ...(suggestions.length ? { garminSuggestions: suggestions } : {}),
        };
        if (!endurance) return ok(base);
        const [profile, injuries, race, memory, phase] = await Promise.all([
          getAthleteProfile(userId),
          listInjuries(userId, includePast),
          interviewRace(userId),
          memoryToOffer(userId),
          activeCyclePhase(userId),
        ]);
        const goal = profile?.strengthGoal ?? null;
        return ok({
          ...base,
          profile: profile
            ? {
                enduranceLevel: profile.enduranceLevel,
                availableDays: profile.availableDays,
                hoursPerWeek: profile.hoursPerWeek,
                longestDayMinutes: profile.longestDayMinutes,
                longDay: profile.longDay,
                strengthGoal: profile.strengthGoal,
                interviewCompletedAt: profile.interviewCompletedAt,
                version: profile.version,
              }
            : null,
          race,
          injuries: injuries.map((i) => ({
            id: i.id,
            area: i.area,
            side: i.side,
            description: i.description,
            avoid: i.avoid,
            status: i.status,
            startedOn: i.startedOn,
            endedOn: i.endedOn,
            version: i.version,
          })),
          strength: goal
            ? {
                goal,
                phase,
                default: phase ? strengthDefault(goal, phase) : null,
                table: strengthTable(goal),
                rule: "A default (D21): plan another count only with the reason in your write's reason.",
              }
            : null,
          interview: {
            complete: profile?.interviewCompletedAt != null,
            missingSteps: missingSteps(profile, rows, race),
            memoryToOffer: memory.map((m) => ({ id: m.id, kind: m.kind, text: m.text, date: m.entryDate, version: m.version })),
          },
        });
      } catch (e) {
        return failInternal("athlete_profile", e);
      }
    },
  );

  server.registerTool(
    "manage_thresholds",
    {
      description: [
        "Add, change or delete a threshold value. Each value is one row with its date, so the rows are the history; the latest date is the current value.",
        "operation='add': kind and the value in the field for its kind: watts (ftp), bpm (lthr_bike, lthr_run, max_hr), paceSecondsPerKm (run_threshold_pace) or paceSecondsPer100m (swim_css); measuredOn (YYYY-MM-DD, default today); source manual, test or garmin (a Garmin suggestion the user accepted).",
        `For a field test, send source 'test', protocol and testData; the server computes the value and refuses a value that disagrees. Tests: ${PROTOCOL_TEXT.join("; ")}. Times in seconds, distance in metres.`,
        "operation='update': id and any field. operation='delete': id; the user can restore it.",
        `Every operation requires reason; update and delete require expectedVersion. ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["add", "update", "delete"]),
        id: z.number().int().positive().optional(),
        kind: z.enum(THRESHOLD_KINDS).optional(),
        watts: z.number().positive().max(2000).optional(),
        bpm: z.number().positive().max(300).optional(),
        paceSecondsPerKm: z.number().positive().max(3600).optional(),
        paceSecondsPer100m: z.number().positive().max(3600).optional(),
        measuredOn: dateStr.optional(),
        source: z.enum(["manual", "test", "garmin"]).optional(),
        protocol: z.enum(THRESHOLD_PROTOCOLS).nullable().optional(),
        testData: testData.nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      const values = { watts: args.watts, bpm: args.bpm, paceSecondsPerKm: args.paceSecondsPerKm, paceSecondsPer100m: args.paceSecondsPer100m };
      try {
        if (args.operation === "add") {
          if (!args.kind || !args.source) return fail("kind and source are required to add a threshold");
          const v = valueFor(args.kind, values);
          if ("error" in v) return fail(v.error);
          const { threshold, version } = await addThreshold(ctx, {
            kind: args.kind,
            value: v.value,
            measuredOn: args.measuredOn,
            source: args.source,
            protocol: args.protocol,
            testData: args.testData,
            notes: args.notes,
          });
          return ok({ added: true, id: threshold.id, value: threshold.value, version });
        }
        if (args.id == null) return fail(`id is required to ${args.operation} a threshold`);
        if (args.expectedVersion == null) return fail(`expectedVersion is required to ${args.operation} a threshold. Read it with get_athlete_profile (history true).`);
        if (args.operation === "delete") {
          const { version } = await changeThreshold(ctx, args.id, "delete", args.expectedVersion);
          return ok({ deleted: true, id: args.id, version });
        }
        const [row] = (await listThresholds(userId)).filter((t) => t.id === args.id);
        let value: number | undefined;
        if (row) {
          const v = valueFor(row.kind, values);
          if ("error" in v) return fail(v.error);
          value = v.value;
        }
        const { version } = await changeThreshold(
          ctx,
          args.id,
          { value, measuredOn: args.measuredOn, source: args.source, protocol: args.protocol, testData: args.testData, notes: args.notes },
          args.expectedVersion,
        );
        return ok({ updated: true, id: args.id, version });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("athlete_profile", e);
      }
    },
  );

  if (!endurance) return;

  server.registerTool(
    "manage_athlete_profile",
    {
      description: [
        "Set the athlete profile: any of enduranceLevel (novice, intermediate, advanced), availableDays (1 = Monday ... 7 = Sunday), hoursPerWeek (1-40), longestDayMinutes (30-720), longDay (1-7), strengthGoal (keep_muscle, stronger, minimal); completeInterview true when the intake interview is done. Send null to clear a field.",
        `Requires reason, and expectedVersion once the profile exists (read it with get_athlete_profile). ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        enduranceLevel: z.enum(ENDURANCE_LEVELS).nullable().optional(),
        availableDays: z.array(dayOfWeek).max(7).nullable().optional(),
        hoursPerWeek: z.number().min(1).max(40).nullable().optional(),
        longestDayMinutes: z.number().int().min(30).max(720).nullable().optional(),
        longDay: dayOfWeek.nullable().optional(),
        strengthGoal: z.enum(STRENGTH_GOALS).nullable().optional(),
        completeInterview: z.boolean().optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async ({ reason, expectedVersion, ...change }) => {
      try {
        const existing = await getAthleteProfile(userId);
        if (existing && expectedVersion == null) return fail("expectedVersion is required: the profile exists. Read it with get_athlete_profile.");
        const { version } = await saveAthleteProfile(assistantContext(userId, clientId, reason), change, existing ? expectedVersion : undefined);
        return ok({ saved: true, version });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("athlete_profile", e);
      }
    },
  );

  server.registerTool(
    "manage_injuries",
    {
      description: [
        "Add, change, resolve or delete an injury or physical limit.",
        `operation='add': area (${INJURY_AREAS.join(", ")}), optional side (left, right, both), description in the user's words (up to 500 characters), optional avoid (what training to avoid, up to 300), status (active = hurts now, managed = lives with it, past = healed), optional startedOn and endedOn (YYYY-MM-DD).`,
        "operation='update': id and any field. operation='resolve': id; sets status past and endedOn (default today). operation='delete': id; the user can restore it.",
        `Every operation requires reason; all but add require expectedVersion. ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["add", "update", "resolve", "delete"]),
        id: z.number().int().positive().optional(),
        area: z.enum(INJURY_AREAS).optional(),
        side: z.enum(INJURY_SIDES).nullable().optional(),
        description: z.string().trim().min(1).max(500).optional(),
        avoid: z.string().trim().max(300).nullable().optional(),
        status: z.enum(INJURY_STATUSES).optional(),
        startedOn: dateStr.nullable().optional(),
        endedOn: dateStr.nullable().optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async ({ operation, id, reason, expectedVersion, ...fields }) => {
      const ctx = assistantContext(userId, clientId, reason);
      try {
        if (operation === "add") {
          if (!fields.area || !fields.description || !fields.status) return fail("area, description and status are required to add an injury");
          const { injury, version } = await addInjury(ctx, { ...fields, area: fields.area, description: fields.description, status: fields.status });
          return ok({ added: true, id: injury.id, version });
        }
        if (id == null) return fail(`id is required to ${operation} an injury`);
        if (expectedVersion == null) return fail(`expectedVersion is required to ${operation} an injury. Read it with get_athlete_profile.`);
        if (operation === "delete") {
          const { version } = await changeInjury(ctx, id, "delete", expectedVersion);
          return ok({ deleted: true, id, version });
        }
        const change =
          operation === "resolve"
            ? { status: "past" as const, endedOn: fields.endedOn ?? toDateStr(await userToday(userId)) }
            : fields;
        const { version } = await changeInjury(ctx, id, change, expectedVersion);
        return ok({ updated: true, id, version });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("athlete_profile", e);
      }
    },
  );
}

/**
 * The intake interview as an MCP prompt (docs/plans/athlete-profile.md, 2.6).
 * Registered on the raw server, since the read-only wrapper refuses prompts:
 * a prompt only returns text and writes nothing, and every write it asks for
 * goes through the scoped write tools.
 */
export function registerAthletePrompts(server: McpServer, userId: string) {
  server.registerPrompt(
    "intake_interview",
    {
      title: "Intake interview",
      description: "Ask the user the athlete profile interview step by step and store each answer in the app.",
    },
    async () => {
      const on = await enduranceEnabledFor(userId);
      const text = on
        ? [
            "Run the LogEveryLift intake interview with me. First read get_athlete_profile (and get_coach_memory). Ask one step at a time, skip steps that already have an answer unless I want to change them, and store each answer with the tools as soon as I give it. Every write needs a reason.",
            ...INTERVIEW_STEPS,
          ].join("\n")
        : "The intake interview needs the endurance features, which are not on for this account. Tell me that, and offer to record thresholds with manage_thresholds instead.";
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    },
  );
}
