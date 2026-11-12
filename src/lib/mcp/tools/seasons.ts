/**
 * MCP tools: seasons, races and phases (docs/plans/seasons.md, 2.9). The same
 * module as the app's Server Actions (src/lib/seasons.ts), so both follow one
 * set of rules. Every write is a revision with the assistant's reason.
 */

import { PHASE_TYPES, RACE_DISCIPLINES, RACE_PRIORITIES, TRI_DISTANCES } from "@/db/schema";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, expectedVersionArg, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import {
  PHASE_MAX_DAYS,
  PHASE_MAX_WEEKS,
  SEASON_MAX_PHASES,
  SEASON_MAX_RACES,
  SEASON_TEXT_MAX,
  addPhase,
  addRace,
  clearReplan,
  createSeason,
  deleteSeason,
  fitTaper,
  getSeasonDetail,
  listSeasons,
  movePhase,
  removePhase,
  removeRace,
  resumeSeason,
  setPhase,
  updateRace,
  updateSeason,
  type SeasonDetail,
} from "@/lib/seasons";
import { startDueScheduledCycle } from "@/lib/plan-revisions";
import { TAPER_DAYS_DEFAULT, TAPER_DAYS_LONG_RUN, TAPER_DAYS_TRI } from "@/lib/utils/seasons";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const text = z.string().trim().max(SEASON_TEXT_MAX);
const cycleVersionArg = z
  .number()
  .int()
  .positive()
  .describe("The version of the cycle the phase operation changes (from get_season or get_training_cycle).");

const TAPER_TEXT = `A taper phase with no length gets the A race's default: full ${TAPER_DAYS_TRI.full} days, half ${TAPER_DAYS_TRI.half}, olympic and sprint ${TAPER_DAYS_TRI.olympic}, a run of 30 km or more ${TAPER_DAYS_LONG_RUN}, others ${TAPER_DAYS_DEFAULT}.`;

function seasonOut(d: SeasonDetail) {
  return {
    id: d.season.id,
    name: d.season.name,
    goal: d.season.goal,
    startDate: d.season.startDate,
    endDate: d.season.endDate,
    nextGoal: d.season.nextGoal,
    status: d.status,
    version: d.season.version,
    replan: d.replan,
    races: d.races.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.raceDate,
      discipline: r.discipline,
      distance: r.distance,
      distanceMeters: r.distanceMeters,
      priority: r.priority,
    })),
    aRaceId: d.aRace?.id ?? null,
    taperDays: d.taperDays,
    taperFit: d.taperFit,
    phases: d.phases.map((p) => ({
      cycleId: p.id,
      name: p.name,
      position: p.phaseOrder,
      phaseType: p.phaseType,
      durationWeeks: p.durationWeeks,
      durationDays: p.durationDays,
      start: p.start,
      end: p.end,
      state: p.state,
      cycleVersion: p.version,
    })),
    nextPhase: d.next,
    // Not scheduled while a cycle outside the season runs: the chain is paused.
    chainPaused: d.next != null && !d.next.scheduled,
    gapBeforeFirstPhaseDays: d.gapBefore,
    lastPhaseRunsPastEndDays: d.overrunAfter,
  };
}

export function registerSeasonTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_seasons",
    {
      description:
        "The user's seasons (a long goal above training cycles, for example a race season or 'Bench 120 kg by summer'), newest first: id, name, goal, dates, next goal, status (planned, active, done), the A race, the re-plan flag, phase count, the current phase and the version. Check the re-plan flag at the start of every review.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        await startDueScheduledCycle(userId);
        const rows = await listSeasons(userId);
        return ok({
          seasons: rows.map((s) => ({
            id: s.id,
            name: s.name,
            goal: s.goal,
            startDate: s.startDate,
            endDate: s.endDate,
            nextGoal: s.nextGoal,
            status: s.status,
            aRace: s.aRace ? { id: s.aRace.id, name: s.aRace.name, date: s.aRace.raceDate } : null,
            replan: { flagged: s.replanFlaggedAt != null, since: s.replanFlaggedAt, reason: s.replanReason },
            phaseCount: s.phaseCount,
            currentPhase: s.currentPhase,
            version: s.version,
          })),
        });
      } catch (e) {
        return failInternal("seasons", e);
      }
    },
  );

  server.registerTool(
    "get_season",
    {
      description: [
        "One season: its fields and version, its races, and its phases in order with the dates the app computes (each phase is a training cycle; cycleVersion is that cycle's version).",
        "taperFit says whether the taper phase ends on the A race day ('fits', or 'early'/'late' by days). chainPaused means the next phase is not scheduled because a cycle outside the season ran; operation 'resume' picks it up.",
        "replan: { flagged, since, reason } is set when a race date or an A race changed (D17). The app never reshapes the phases itself: re-plan them, then clear the flag with manage_season clear_replan.",
      ].join(" "),
      inputSchema: { seasonId: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ seasonId }) => {
      try {
        await startDueScheduledCycle(userId);
        const d = await getSeasonDetail(userId, seasonId);
        if (!d) return fail("Season not found");
        return ok(seasonOut(d));
      } catch (e) {
        return failInternal("seasons", e);
      }
    },
  );

  server.registerTool(
    "manage_season",
    {
      description: [
        "Create, change or delete a season, clear its re-plan flag, or change its phases.",
        "operation='create': name, startDate, endDate; optional goal and nextGoal. operation='update': any of those. operation='delete': the season is soft deleted (the user can restore it for 90 days); its cycles stay and act as cycles with no season. operation='clear_replan': after you re-planned for a race change.",
        `Phases are training cycles in order. operation='add_phase': cycleId (an existing cycle in no season; cycleVersion required) or name (a new empty draft cycle; fill it with edit_cycle_slot), optional position (1-based, default last), phaseType (${PHASE_TYPES.join(", ")}; endurance features only) and a length: durationWeeks (1-${PHASE_MAX_WEEKS}) or durationDays (1-${PHASE_MAX_DAYS}). A cycle's own race moves to the season. ${TAPER_TEXT} At most ${SEASON_MAX_PHASES} phases.`,
        "operation='remove_phase' (cycleId): the cycle leaves the season and runs its whole block curve again. operation='move_phase': cycleId and position. operation='set_phase': cycleId and any of phaseType (null clears), durationWeeks, durationDays.",
        "operation='fit_taper': lengthens or shortens the phase before the taper so the taper ends on the A race day. operation='resume': starts or schedules the next phase after the chain was paused.",
        "Phase curves: general, base and build ramp from 0.80 to 1.00 of each set's peak with recovery weeks by athlete level; peak holds 1.00; taper falls from 0.60 to 0.35; transition holds 0.50 and leaves zone and rest alone; no phase type runs the cycle's whole block curve. When a phase starts, the next one is scheduled for the day after it ends.",
        `Every operation requires reason; all but create also require expectedVersion (the season's version), and phase operations on an existing cycle take cycleVersion. The result has the new versions. ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["create", "update", "delete", "clear_replan", "add_phase", "remove_phase", "move_phase", "set_phase", "fit_taper", "resume"]),
        seasonId: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(100).optional(),
        goal: text.nullable().optional(),
        nextGoal: text.nullable().optional(),
        startDate: dateArg.optional(),
        endDate: dateArg.optional(),
        cycleId: z.number().int().positive().optional(),
        cycleVersion: cycleVersionArg.optional(),
        position: z.number().int().positive().optional(),
        phaseType: z.enum(PHASE_TYPES).nullable().optional(),
        durationWeeks: z.number().int().min(1).max(PHASE_MAX_WEEKS).optional(),
        durationDays: z.number().int().min(1).max(PHASE_MAX_DAYS).optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        if (args.operation === "create") {
          if (!args.name || !args.startDate || !args.endDate) return fail("name, startDate and endDate are required to create a season");
          const { season, version } = await createSeason(ctx, {
            name: args.name,
            goal: args.goal ?? null,
            nextGoal: args.nextGoal ?? null,
            startDate: args.startDate,
            endDate: args.endDate,
          });
          return ok({ created: true, seasonId: season.id, version });
        }
        if (args.seasonId == null) return fail(`seasonId is required to ${args.operation}`);
        if (args.expectedVersion == null) return fail(`expectedVersion is required to ${args.operation}. Read it with get_season.`);
        const seasonId = args.seasonId;
        const ev = args.expectedVersion;
        const needCycle = () => {
          if (args.cycleId == null) throw new ArgError(`cycleId is required to ${args.operation}`);
          return args.cycleId;
        };
        switch (args.operation) {
          case "update": {
            const { version } = await updateSeason(
              ctx,
              seasonId,
              { name: args.name, goal: args.goal, nextGoal: args.nextGoal, startDate: args.startDate, endDate: args.endDate },
              ev,
            );
            return ok({ updated: true, seasonId, version });
          }
          case "delete":
            await deleteSeason(ctx, seasonId, ev);
            return ok({ deleted: true, seasonId });
          case "clear_replan": {
            const { version } = await clearReplan(ctx, seasonId, ev);
            return ok({ cleared: true, seasonId, version });
          }
          case "add_phase": {
            if (args.cycleId != null && args.cycleVersion == null) return fail("cycleVersion is required to add an existing cycle");
            const done = await addPhase(
              ctx,
              seasonId,
              {
                cycleId: args.cycleId,
                cycleVersion: args.cycleVersion,
                name: args.name,
                position: args.position,
                phaseType: args.phaseType,
                durationWeeks: args.durationWeeks,
                durationDays: args.durationDays,
              },
              ev,
            );
            return ok({ added: true, ...done });
          }
          case "remove_phase":
            return ok({ removed: true, ...(await removePhase(ctx, seasonId, needCycle(), ev, args.cycleVersion)) });
          case "move_phase":
            if (args.position == null) return fail("position is required to move a phase");
            return ok({ moved: true, ...(await movePhase(ctx, seasonId, needCycle(), args.position, ev, args.cycleVersion)) });
          case "set_phase":
            return ok({
              updated: true,
              ...(await setPhase(
                ctx,
                seasonId,
                needCycle(),
                { phaseType: args.phaseType, durationWeeks: args.durationWeeks, durationDays: args.durationDays },
                ev,
                args.cycleVersion,
              )),
            });
          case "fit_taper":
            return ok({ fitted: true, ...(await fitTaper(ctx, seasonId, ev)) });
          case "resume":
            return ok({ resumed: true, ...(await resumeSeason(ctx, seasonId, ev)) });
        }
      } catch (e) {
        if (e instanceof ArgError) return fail(e.message);
        return (await planErrorResult(userId, e)) ?? failInternal("seasons", e);
      }
    },
  );

  server.registerTool(
    "manage_race",
    {
      description: [
        "Add, change or remove a race on a season (endurance features only).",
        `operation='add': name, date, discipline (${RACE_DISCIPLINES.join(", ")}), priority (${RACE_PRIORITIES.join(", ")}); for a triathlon a distance (${TRI_DISTANCES.join(", ")}); for any other discipline distanceMeters. At most ${SEASON_MAX_RACES} races.`,
        "operation='update': raceId and any of those. operation='remove': raceId.",
        "The A race decides where the taper goes. A date change of any race, an A race added or removed, or a priority change to or from A flags the season for a re-plan; the result says so. Nothing else changes by itself.",
        `Every operation requires reason and expectedVersion (the season's version). ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["add", "update", "remove"]),
        seasonId: z.number().int().positive(),
        raceId: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(100).optional(),
        date: dateArg.optional(),
        discipline: z.enum(RACE_DISCIPLINES).optional(),
        distance: z.enum(TRI_DISTANCES).nullable().optional(),
        distanceMeters: z.number().int().min(100).max(1_000_000).nullable().optional(),
        priority: z.enum(RACE_PRIORITIES).optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg,
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        if (args.operation === "add") {
          if (!args.name || !args.date || !args.discipline || !args.priority) {
            return fail("name, date, discipline and priority are required to add a race");
          }
          const done = await addRace(
            ctx,
            args.seasonId,
            {
              name: args.name,
              raceDate: args.date,
              discipline: args.discipline,
              distance: args.distance,
              distanceMeters: args.distanceMeters,
              priority: args.priority,
            },
            args.expectedVersion,
          );
          return ok({ added: true, raceId: done.out.id, version: done.version, replanFlagged: done.replanFlagged });
        }
        if (args.raceId == null) return fail(`raceId is required to ${args.operation} a race`);
        const done =
          args.operation === "update"
            ? await updateRace(
                ctx,
                args.seasonId,
                args.raceId,
                {
                  name: args.name,
                  raceDate: args.date,
                  discipline: args.discipline,
                  distance: args.distance,
                  distanceMeters: args.distanceMeters,
                  priority: args.priority,
                },
                args.expectedVersion,
              )
            : await removeRace(ctx, args.seasonId, args.raceId, args.expectedVersion);
        return ok({ [args.operation === "update" ? "updated" : "removed"]: true, raceId: args.raceId, version: done.version, replanFlagged: done.replanFlagged });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("races", e);
      }
    },
  );
}

class ArgError extends Error {}
