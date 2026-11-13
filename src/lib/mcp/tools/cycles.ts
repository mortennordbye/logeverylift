/**
 * MCP tools: training cycles (mesocycles) and their day/rotation slots.
 *
 * Mirrors src/lib/actions/training-cycles.ts, scoped to the MCP-authenticated
 * userId. Ownership is enforced on every read and write.
 */

import { db } from "@/db";
import { programs, trainingCycles, workouts } from "@/db/schema";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { enduranceEnabledFor } from "@/lib/endurance";
import { LIMITS_TEXT, limitRefusal, limitSummary, overrideArgs, overrideFrom } from "@/lib/mcp/limits";
import { REVISION_RULES, assistantContext, expectedVersionArg, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import { liveCycles, livePrograms, liveSlotProgram } from "@/lib/plan-live";
import {
  activateCycle,
  deleteCycles,
  liveSeasonId,
  planWrite,
  scheduleCycle,
  startDueScheduledCycle,
  versionKey,
} from "@/lib/plan-revisions";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import {
  LimitRefusedError,
  NO_FACTS,
  cycleScope,
  evaluateLimits,
  syncLimitWarnings,
  limitContext,
  planFacts,
  withLimits,
} from "@/lib/training-limits";
import { userToday } from "@/lib/user-settings";
import { countTouchedFuture, removeSlotInTx, upsertSlotInTx } from "@/lib/planned-sessions";
import { raceForCycle } from "@/lib/seasons";
import { SEASON_CYCLE_LENGTH, SEASON_CYCLE_RACE } from "@/lib/utils/seasons";
import { addDays, cycleWeek, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";
import { CYCLE_DURATION_WEEKS } from "@/lib/validators/training-cycles";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

const durationWeeks = z
  .number()
  .int()
  .refine((v) => CYCLE_DURATION_WEEKS.includes(v), {
    message: `Duration must be one of ${CYCLE_DURATION_WEEKS.join(", ")} weeks`,
  });
const endActionEnum = z.enum(["deload", "new_cycle", "rest", "none"]);
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** How far ahead a block can be scheduled to start. */
export const MAX_SCHEDULE_DAYS = 120;
/** The range of an assistant's one-week volume change (set_volume). */
export const SET_VOLUME_MIN = 50;
export const SET_VOLUME_MAX = 110;

const ENDURANCE_FIELDS_OFF =
  "Race, goal and athlete level are part of the endurance features, which are not on for this account. Only an admin can turn them on.";

/** Returns the owning userId for a live cycle, or null if not found. */
async function cycleOwner(cycleId: number) {
  const [row] = await db
    .select({ userId: trainingCycles.userId })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), liveCycles))
    .limit(1);
  return row ?? null;
}

const cycleVersion = (versions: Map<string, number>, cycleId: number) =>
  versions.get(versionKey({ type: "cycle", id: cycleId }));

export function registerCycleTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_training_cycles",
    {
      description:
        "List the current user's training cycles (mesocycles), newest first. Each has `race`: the race it reads (its season's A race for a phase of a season, else its own).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        // A block scheduled for today becomes active on the first read, as in the app.
        await startDueScheduledCycle(userId);
        const rows = await db
          .select()
          .from(trainingCycles)
          .where(and(eq(trainingCycles.userId, userId), liveCycles))
          .orderBy(desc(trainingCycles.createdAt));
        // The race each cycle reads: its season's A race, or its own (D8).
        return ok(await Promise.all(rows.map(async (c) => ({ ...c, race: await raceForCycle(userId, c) }))));
      } catch (e) {
        return failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "get_training_cycle",
    {
      description:
        "Get one training cycle with its slots (each slot's assigned program included), its version, and touchedFutureSessions: how many dated sessions from today on were moved, skipped or changed, which a slot change leaves alone. Pass the version as expectedVersion when you change it. A cycle with seasonId is a phase of that season (phaseOrder, phaseType, durationDays); its race is the season's A race, returned as race. Change phases with manage_season. limitWarnings (when there are any): the training limits this week's weekly sync or applied Garmin suggestion broke; the app never refuses its own writes, so check them with the athlete.",
      inputSchema: { cycleId: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cycleId }) => {
      try {
        await startDueScheduledCycle(userId);
        const cycle = await db.query.trainingCycles.findFirst({
          where: and(
            eq(trainingCycles.id, cycleId),
            eq(trainingCycles.userId, userId),
            liveCycles,
          ),
          with: { slots: { with: { program: true } } },
        });
        if (!cycle) return fail("Training cycle not found");
        // The race the cycle reads: its season's A race, or its own (D8).
        const race = await raceForCycle(userId, cycle);
        // Dated sessions from today on that the user or an assistant changed:
        // a template edit leaves these alone (docs/plans/sessions.md, T7).
        const touchedFutureSessions = await countTouchedFuture(userId, cycle.id);
        // T4: what this week's sync broke, stored on its revision (docs/plans/limits-strength-readiness.md, 6).
        const limitWarnings = cycle.status === "active" ? await syncLimitWarnings(userId, cycle.id, cycle.lastSyncedWeek) : [];
        return ok({ ...cycle, race, slots: cycle.slots.map(liveSlotProgram), touchedFutureSessions, ...(limitWarnings.length && { limitWarnings }) });
      } catch (e) {
        return failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "manage_training_cycle",
    {
      description: [
        "Create, update, delete, start or schedule a training cycle, or change this week's volume.",
        `operation='create': requires name and durationWeeks (${CYCLE_DURATION_WEEKS.join("/")}); optional scheduleType ('day_of_week'|'rotation'), endAction, endMessage, and the endurance fields below.`,
        "operation='update': requires cycleId; any of name, durationWeeks, endAction, endMessage, status ('draft'|'active'|'completed'), the endurance fields, and scheduledStartDate: null (cancels a scheduled start) are applied.",
        "Endurance fields (need the user's endurance features on): raceDate (YYYY-MM-DD) and raceDistance ('full' Ironman or 'half' 70.3), null to clear, only on a cycle in no season (a phase of a season reads the season's races: use manage_race); goal ('build' ramps endurance volume to a peak then tapers, 'maintain' holds it flat); athleteLevel ('novice' recovers every 3rd week, 'intermediate'/'advanced' every 4th). A new goal or level re-derives this week's targets.",
        "operation='delete': requires cycleId. The cycle and the programs it generated can be restored in the app for 90 days, and with restore_revision.",
        `operation='start': requires cycleId. Without startDate, or with today, it becomes active now (completing any other active cycle). With a later startDate (up to ${MAX_SCHEDULE_DAYS} days ahead) it stays a draft scheduled to start that day; on that day it becomes active and the old block completes. Only one cycle is scheduled at a time.`,
        `operation='set_volume': requires cycleId (the active cycle) and pct (${SET_VOLUME_MIN}-${SET_VOLUME_MAX}): this week's endurance volume as a percent of the block's curve, the same factor the weekly sync sets from adherence and readiness (adaptationPct). It rewrites this week's distances and durations at once and lasts one week: next week's sync computes its own percent. For a lasting change, edit the peaks with edit_program_exercise.`,
        `Every operation requires reason; all but create also require expectedVersion (the cycle's version). The result has the new version. ${REVISION_RULES}`,
        `On start, set_volume, and an update to durationWeeks, goal or athleteLevel of the active or a scheduled cycle: ${LIMITS_TEXT}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        ...overrideArgs,
        operation: z.enum(["create", "update", "delete", "start", "set_volume"]),
        cycleId: z.number().int().positive().optional(),
        name: z.string().min(1).max(100).optional(),
        durationWeeks: durationWeeks.optional(),
        scheduleType: z.enum(["day_of_week", "rotation"]).optional(),
        endAction: endActionEnum.optional(),
        endMessage: z.string().max(500).nullable().optional(),
        status: z.enum(["draft", "active", "completed"]).optional(),
        raceDate: dateArg.nullable().optional(),
        raceDistance: z.enum(["full", "half"]).nullable().optional(),
        goal: z.enum(["build", "maintain"]).optional(),
        athleteLevel: z.enum(["novice", "intermediate", "advanced"]).nullable().optional(),
        startDate: dateArg.optional(),
        scheduledStartDate: z.null().optional(),
        pct: z.number().int().min(SET_VOLUME_MIN).max(SET_VOLUME_MAX).optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      const override = overrideFrom(args);
      if (typeof override === "string") return fail(override);
      // The endurance fields, as the cycle form gates the race (D18).
      const endurance: Record<string, unknown> = {};
      if (args.raceDate !== undefined) endurance.raceDate = args.raceDate;
      if (args.raceDistance !== undefined) endurance.raceDistance = args.raceDistance;
      if (args.goal !== undefined) endurance.goal = args.goal;
      if (args.athleteLevel !== undefined) endurance.athleteLevel = args.athleteLevel;
      try {
        if (Object.keys(endurance).length > 0 && !(await enduranceEnabledFor(userId))) {
          return fail(ENDURANCE_FIELDS_OFF);
        }
        if (args.operation === "create") {
          if (!args.name || args.durationWeeks == null) {
            return fail("name and durationWeeks are required to create a cycle");
          }
          const name = args.name;
          const weeks = args.durationWeeks;
          const { result: cycle } = await planWrite(ctx, async (w) => {
            const [row] = await w.tx
              .insert(trainingCycles)
              .values({
                userId,
                name,
                durationWeeks: weeks,
                scheduleType: args.scheduleType ?? "day_of_week",
                endAction: args.endAction ?? "none",
                endMessage: args.endMessage ?? null,
                ...endurance,
              })
              .returning();
            w.create({ type: "cycle", id: row.id });
            return row;
          });
          return ok(cycle);
        }

        if (args.cycleId == null) return fail(`cycleId is required to ${args.operation} a cycle`);
        if (args.expectedVersion == null) {
          return fail(`expectedVersion is required to ${args.operation} a cycle. Read it with get_training_cycle.`);
        }
        const cycleId = args.cycleId;
        const expectedVersion = args.expectedVersion;

        if (args.operation === "update") {
          const existing = await db.query.trainingCycles.findFirst({
            where: and(
              eq(trainingCycles.id, cycleId),
              eq(trainingCycles.userId, userId),
              liveCycles,
            ),
          });
          if (!existing) return fail("Training cycle not found");
          // A cycle in a live season stores no race: the season holds it (D8).
          // Its length belongs to the season too, which re-chains the next phase.
          if ((await liveSeasonId(db, existing.seasonId)) != null) {
            if (args.raceDate != null || args.raceDistance != null) {
              return fail(`${SEASON_CYCLE_RACE} Use manage_race on season ${existing.seasonId}.`);
            }
            if (args.durationWeeks !== undefined && args.durationWeeks !== existing.durationWeeks) {
              return fail(`${SEASON_CYCLE_LENGTH} Use manage_season set_phase on season ${existing.seasonId}.`);
            }
          }

          // Activating must go through operation='start', which deactivates any
          // other active cycle first.
          if (args.status === "active" && existing.status !== "active") {
            return fail(
              "Use operation='start' to activate a cycle — it deactivates any other active cycle first.",
            );
          }

          // Don't let an active cycle be shortened past its elapsed time.
          if (args.durationWeeks && existing.status === "active" && existing.startDate) {
            const { isOver } = cycleWeek(parseDateStr(existing.startDate), args.durationWeeks, await userToday(userId));
            if (isOver) {
              return fail(
                "New duration would end the cycle immediately — choose a longer duration",
              );
            }
          }

          const updates: Record<string, unknown> = {};
          if (args.name !== undefined) updates.name = args.name;
          if (args.durationWeeks !== undefined) {
            updates.durationWeeks = args.durationWeeks;
            // A length in weeks replaces a length in days (T8).
            updates.durationDays = null;
          }
          // A new block length changes every week's targets; clearing the sync
          // stamp makes the next read re-derive them.
          if (args.durationWeeks !== undefined && args.durationWeeks !== existing.durationWeeks) {
            updates.lastSyncedWeek = null;
          }
          if (args.endAction !== undefined) updates.endAction = args.endAction;
          if (args.endMessage !== undefined) updates.endMessage = args.endMessage;
          if (args.status !== undefined) updates.status = args.status;
          if (args.scheduledStartDate === null) updates.scheduledStartDate = null;
          Object.assign(updates, endurance);
          // A new goal or level changes every week's targets, like a new length.
          if (
            (args.goal !== undefined && args.goal !== existing.goal) ||
            (args.athleteLevel !== undefined && args.athleteLevel !== existing.athleteLevel)
          ) {
            updates.lastSyncedWeek = null;
          }

          // A new length, goal or level rescales this week's periodized targets
          // at the next sync (as the app, unchecked), so the limits look at the
          // week as it will run now (docs/plans/ai-coach.md, 2.4).
          // A scheduled draft starts later as the app, unchecked, so its first
          // week is checked the same way, at the old and the new settings.
          let limits: ReturnType<typeof limitSummary> | undefined;
          const running = existing.status === "active" && existing.startDate;
          const scheduled = existing.status === "draft" && existing.scheduledStartDate;
          if (updates.lastSyncedWeek === null && (running || scheduled)) {
            const settings = {
              durationWeeks: args.durationWeeks ?? existing.durationWeeks,
              goal: args.goal ?? existing.goal,
              athleteLevel: args.athleteLevel !== undefined ? args.athleteLevel : existing.athleteLevel,
            };
            const week = running
              ? cycleWeek(parseDateStr(existing.startDate!), settings.durationWeeks, await userToday(userId)).currentWeek
              : 1;
            const pct = running ? existing.adaptationPct : 100;
            const lc = await limitContext(userId);
            const scoped = await cycleScope(cycleId, week, pct, settings);
            const old = running ? null : await cycleScope(cycleId, 1, 100);
            const before = lc.endurance && scoped ? await planFacts(db, scoped.scope, old?.share ?? null, new Set(), lc.doneToday) : NO_FACTS;
            const after = lc.endurance && scoped ? await planFacts(db, scoped.scope, scoped.share, new Set(), lc.doneToday) : NO_FACTS;
            const { blocking, check, unusedOverrides } = evaluateLimits(lc, before, after, override);
            if (blocking.length) throw new LimitRefusedError(blocking);
            ctx.limitCheck = check;
            limits = limitSummary(check, unusedOverrides);
          }

          const { versions } = await planWrite(ctx, async (w) => {
            await w.touch({ type: "cycle", id: cycleId }, { expectedVersion });
            if (Object.keys(updates).length > 0) {
              await w.tx.update(trainingCycles).set(updates).where(eq(trainingCycles.id, cycleId));
            }
          });
          // plan-read: includes deleted (re-reads the row this call just wrote)
          const [cycle] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
          return ok({ ...cycle, version: cycleVersion(versions, cycleId) ?? cycle.version, ...(limits && { limits }) });
        }

        if (args.operation === "delete") {
          const owner = await cycleOwner(cycleId);
          if (!owner || owner.userId !== userId) return fail("Training cycle not found");
          await deleteCycles(ctx, [cycleId], expectedVersion);
          audit("delete_training_cycle", { userId, cycleId });
          return ok({ deleted: true, cycleId });
        }

        const owner = await cycleOwner(cycleId);
        if (!owner || owner.userId !== userId) return fail("Training cycle not found");
        const today = toDateStr(await userToday(userId));

        if (args.operation === "set_volume") {
          if (args.pct == null) return fail("pct is required for set_volume");
          // A block scheduled for today becomes the active one first.
          await startDueScheduledCycle(userId);
          const pct = args.pct;
          const cycle = await db.query.trainingCycles.findFirst({
            where: and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId), liveCycles),
            with: { slots: { with: { program: true } } },
          });
          if (!cycle || cycle.status !== "active" || !cycle.startDate) return fail("set_volume works on the active cycle only");
          const { currentWeek, isOver } = cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, parseDateStr(today), cycle.durationDays);
          if (isOver) return fail("The cycle is over");
          const lc = await limitContext(userId);
          const scoped = await cycleScope(cycleId, currentWeek, pct);
          const before = lc.endurance && scoped ? await planFacts(db, scoped.scope, null, new Set(), lc.doneToday) : NO_FACTS;
          const after = lc.endurance && scoped ? await planFacts(db, scoped.scope, scoped.share, new Set(), lc.doneToday) : NO_FACTS;
          const { blocking, check, unusedOverrides } = evaluateLimits(lc, before, after, override);
          if (blocking.length) throw new LimitRefusedError(blocking);
          await syncPeriodizedTargets(
            cycleId,
            userId,
            cycle.slots.map(liveSlotProgram),
            currentWeek,
            cycle.durationWeeks,
            cycle.goal,
            cycle.athleteLevel,
            { pct, note: `Set by the assistant: ${args.reason}` },
            { ...ctx, limitCheck: check },
            expectedVersion,
          );
          audit("set_cycle_volume", { userId, cycleId, pct });
          // plan-read: includes deleted (re-reads the row this call just wrote)
          const [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
          return ok({ cycleId, week: currentWeek, adaptationPct: row.adaptationPct, version: row.version, limits: limitSummary(check, unusedOverrides) });
        }

        // start: now, or scheduled for a later day.
        const start = args.startDate ?? today;
        if (start < today) return fail("startDate is in the past");
        if (start > toDateStr(addDays(parseDateStr(today), MAX_SCHEDULE_DAYS))) {
          return fail(`startDate is more than ${MAX_SCHEDULE_DAYS} days ahead`);
        }
        // The block's first week, as it will run: before, nothing of it is planned.
        const lc = await limitContext(userId);
        const scoped = await cycleScope(cycleId, 1);
        const after = lc.endurance && scoped ? await planFacts(db, scoped.scope, scoped.share, new Set(), lc.doneToday) : NO_FACTS;
        const { blocking, check, unusedOverrides } = evaluateLimits(lc, NO_FACTS, after, override);
        if (blocking.length) throw new LimitRefusedError(blocking);
        const checked = { ...ctx, limitCheck: check };
        if (start > today) {
          const { versions } = await scheduleCycle(checked, cycleId, start, expectedVersion);
          audit("schedule_training_cycle", { userId, cycleId });
          return ok({
            scheduled: true,
            cycleId,
            startsOn: start,
            version: cycleVersion(versions, cycleId),
            limits: limitSummary(check, unusedOverrides),
          });
        }
        // Any other active cycle completes, in one transaction.
        await activateCycle(checked, cycleId, expectedVersion);
        audit("start_training_cycle", { userId, cycleId });
        // plan-read: includes deleted (re-reads the row this call just wrote)
        const [cycle] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
        return ok({ ...cycle, limits: limitSummary(check, unusedOverrides) });
      } catch (e) {
        if (e instanceof LimitRefusedError) return limitRefusal(e);
        return (await planErrorResult(userId, e)) ?? failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "edit_cycle_slot",
    {
      description: [
        "Upsert or remove a slot in a training cycle.",
        "operation='upsert': requires trainingCycleId and either dayOfWeek (1=Mon..7=Sun, for day_of_week cycles) or orderIndex (1,2,3.. for rotation cycles); optional daySlot (1-3, the session's order in the day on a weekday cycle: a day can hold up to three sessions, for example strength in the morning and a run in the evening; default 1; a rest day is the only slot of its day), label, programId (the program to run; null to clear), notes, autoComplete (true for a day tracked outside the app, which then completes itself; omit to leave unchanged). An existing slot at that day/position is updated, otherwise a new one is created.",
        "With endurance features on, weekday cycles only: workoutId (a library workout from list_workouts, instead of a program; each dated session gets its own copy), priority (key, support or optional; null = derived), brickWithNext (true when the next slot of the day is the run off this ride).",
        "operation='remove': requires slotId and cycleId. The day's other sessions keep their order.",
        "A slot change rewrites the dated sessions nobody moved or changed, from this week's Monday on (list_planned_sessions); done ones, changed ones and earlier ones stay. The result's sessionsRegenerated says how many were made, changed or removed, and sessionsKeptOutByCap lists days left out because they already hold three sessions.",
        `Both require reason and expectedVersion (the cycle's version); the result has the new version. ${REVISION_RULES}`,
        `On upsert: ${LIMITS_TEXT}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        ...overrideArgs,
        operation: z.enum(["upsert", "remove"]),
        trainingCycleId: z.number().int().positive().optional(),
        cycleId: z.number().int().positive().optional(),
        slotId: z.number().int().positive().optional(),
        dayOfWeek: z.number().int().min(1).max(7).optional(),
        orderIndex: z.number().int().positive().optional(),
        daySlot: z.number().int().min(1).max(3).optional(),
        label: z.string().max(100).nullable().optional(),
        programId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        autoComplete: z.boolean().optional(),
        workoutId: z.number().int().positive().nullable().optional(),
        priority: z.enum(["key", "support", "optional"]).nullable().optional(),
        brickWithNext: z.boolean().optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg,
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      const override = overrideFrom(args);
      if (typeof override === "string") return fail(override);
      try {
        if (args.operation === "upsert") {
          const { trainingCycleId, dayOfWeek, orderIndex } = args;
          if (trainingCycleId == null) {
            return fail("trainingCycleId is required to upsert a slot");
          }
          if (dayOfWeek === undefined && orderIndex === undefined) {
            return fail("Provide either dayOfWeek or orderIndex");
          }
          const [cycle] = await db
            .select({
              userId: trainingCycles.userId,
              scheduleType: trainingCycles.scheduleType,
            })
            .from(trainingCycles)
            .where(and(eq(trainingCycles.id, trainingCycleId), liveCycles))
            .limit(1);
          if (!cycle || cycle.userId !== userId) return fail("Training cycle not found");

          // The provided dimension must match the cycle's schedule mode; the
          // other is forced null so we never persist a mixed-mode slot (which
          // would misbehave in schedule resolution and can hit the unique
          // (cycle,day)/(cycle,order) constraints unexpectedly).
          if (cycle.scheduleType === "day_of_week" && dayOfWeek === undefined) {
            return fail("This is a day-of-week cycle — provide dayOfWeek (1=Mon..7=Sun).");
          }
          if (cycle.scheduleType === "rotation" && orderIndex === undefined) {
            return fail("This is a rotation cycle — provide orderIndex (1,2,3..).");
          }
          const effDay = cycle.scheduleType === "day_of_week" ? dayOfWeek ?? null : null;
          const effOrder = cycle.scheduleType === "rotation" ? orderIndex ?? null : null;

          // If assigning a program, verify the user owns it.
          if (args.programId != null) {
            const [prog] = await db
              .select({ userId: programs.userId })
              .from(programs)
              .where(and(eq(programs.id, args.programId), livePrograms))
              .limit(1);
            if (!prog || prog.userId !== userId) return fail("Program not found");
          }

          const workoutArgs = args.workoutId !== undefined || args.priority !== undefined || args.brickWithNext !== undefined;
          if (workoutArgs && !(await enduranceEnabledFor(userId))) return fail("Endurance features are not on for this account");
          if (args.workoutId != null) {
            if (args.programId != null) return fail("Send programId or workoutId, not both");
            const [wk] = await db
              .select({ id: workouts.id })
              .from(workouts)
              .where(and(eq(workouts.id, args.workoutId), eq(workouts.userId, userId), isNull(workouts.deletedAt)));
            if (!wk) return fail("Workout not found");
          }
          const rest = {
            label: args.label ?? null,
            programId: args.workoutId != null ? null : (args.programId ?? null),
            notes: args.notes ?? null,
            ...(args.autoComplete !== undefined && { autoComplete: args.autoComplete }),
            ...(args.workoutId !== undefined && { workoutId: args.workoutId }),
            ...(args.priority !== undefined && { priority: args.priority }),
            ...(args.brickWithNext !== undefined && { brickWithNext: args.brickWithNext }),
          };

          const lc = await limitContext(userId);
          const { result: { result: slot, check, unusedOverrides, regenerated, capped }, versions } = await planWrite(ctx, async (w) => {
            const tx = w.tx;
            await w.touch({ type: "cycle", id: trainingCycleId }, { expectedVersion: args.expectedVersion });
            // A slot changes the week's sessions, not the programs' runs.
            const out = await withLimits(w, lc, { programIds: [], cycleIds: [trainingCycleId] }, override, () =>
              // Up to three sessions a day, keyed by daySlot (docs/plans/sessions.md, 3.1).
              upsertSlotInTx(tx, trainingCycleId, { dayOfWeek: effDay, orderIndex: effOrder, daySlot: args.daySlot }, rest),
            );
            const regenerated = (await w.regenerateSessions()).get(trainingCycleId) ?? 0;
            return { ...out, regenerated, capped: w.regenerationCapped.get(trainingCycleId) ?? [] };
          });
          return ok({
            ...slot,
            cycleVersion: cycleVersion(versions, trainingCycleId),
            sessionsRegenerated: regenerated,
            // Template days left out because the day already holds three sessions.
            sessionsKeptOutByCap: capped,
            limits: limitSummary(check, unusedOverrides),
          });
        }

        // remove
        const { slotId, cycleId } = args;
        if (slotId == null || cycleId == null) {
          return fail("slotId and cycleId are required to remove a slot");
        }
        const owner = await cycleOwner(cycleId);
        if (!owner || owner.userId !== userId) return fail("Training cycle not found");
        const { result: { removed, regenerated }, versions } = await planWrite(ctx, async (w) => {
          await w.touch({ type: "cycle", id: cycleId }, { expectedVersion: args.expectedVersion });
          const removed = await removeSlotInTx(w.tx, cycleId, slotId);
          return { removed, regenerated: (await w.regenerateSessions()).get(cycleId) ?? 0 };
        });
        if (removed.length === 0) return fail("Slot not found");
        audit("remove_cycle_slot", { userId, cycleId, slotId });
        return ok({ removed: true, slotId, cycleVersion: cycleVersion(versions, cycleId), sessionsRegenerated: regenerated });
      } catch (e) {
        if (e instanceof LimitRefusedError) return limitRefusal(e);
        return (await planErrorResult(userId, e)) ?? failInternal("cycles", e);
      }
    },
  );
}
