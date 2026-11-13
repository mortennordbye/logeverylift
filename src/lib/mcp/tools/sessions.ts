/**
 * MCP tools: log a session done outside the app, and confirm a planned day as
 * done (docs/plans/ai-coach.md, 2.6). These write logged data, not plan data,
 * so they make no plan revision and run no training limit.
 *
 * A logged session gets source 'assistant', so the user can tell it from one
 * they logged. Its sets link to no planned set: the assistant records what was
 * done, not a row of the plan.
 */

import { db } from "@/db";
import {
  exercises,
  plannedSessions,
  programs,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
} from "@/db/schema";
import { insertAutoSessions } from "@/lib/auto-sessions";
import { startDueScheduledCycle } from "@/lib/plan-revisions";
import { liveCycles, livePlannedSessions, livePrograms, liveSlotProgram } from "@/lib/plan-live";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { instantInZone, localDateStr } from "@/lib/utils/user-date";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { WORKOUT_FEELINGS } from "@/lib/validators/workout";
import { DuplicateSession, writeLoggedSession } from "@/lib/logged-sessions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";

/** How far back log_session reaches. */
export const LOG_SESSION_MAX_DAYS_BACK = 60;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// The ranges of logWorkoutSetSchema (validators/workout.ts). Strict: an
// unknown key fails the call by name instead of being dropped.
const loggedSet = z
  .object({
    exerciseId: z.number().int().positive(),
    setNumber: z.number().int().positive().max(100),
    reps: z.number().int().min(0).max(1000).optional(),
    weightKg: z.number().min(0).max(1000).optional(),
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
    distanceMeters: z.number().int().min(0).max(1_000_000).optional(),
    heartRateZone: z.number().int().min(1).max(5).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(500).optional(),
    setType: z.enum(["working", "warmup"]).optional(),
  })
  .strict();

/** A dated session of the user, live, in a live weekday cycle. */
async function ownPlanned(userId: string, id: number) {
  const [row] = await db
    .select({ id: plannedSessions.id, cycleId: plannedSessions.cycleId, date: plannedSessions.date, programId: plannedSessions.programId, status: plannedSessions.status })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), liveCycles))
    .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId), livePlannedSessions, isNotNull(plannedSessions.date)));
  return row ?? null;
}

export function registerSessionTools(server: McpServer, userId: string) {
  server.registerTool(
    "log_session",
    {
      description: [
        "Log a completed workout the user did outside the app (for example a run they tell you about), with its sets.",
        `date is the day it happened (YYYY-MM-DD, today or up to ${LOG_SESSION_MAX_DAYS_BACK} days back, in the user's time zone). Optional programId (one of the user's programs, when it was a planned session), plannedSessionId (the dated session it was, from list_planned_sessions; its program is used when programId is left out), startTime (ISO with offset; it must fall on date in the user's time zone; default noon there), durationMinutes, feeling, notes.`,
        "Each set takes exerciseId (search_exercises), setNumber, and any of reps, weightKg, durationSeconds, distanceMeters, heartRateZone (1-5), rir (0-5) or rpe (1-10), not both, notes, setType. All values are metric. Any other key fails the call.",
        "Personal records are rebuilt from this session on. It replaces a day the cycle auto-completed for the same program. Refused when the user already logged that program on that date, or, without a program, the same exercises that day: read recent_workouts first. The session shows as logged by the assistant; you cannot edit or delete it afterwards (the user can, in History).",
      ].join(" "),
      inputSchema: {
        date: dateStr,
        programId: z.number().int().positive().optional(),
        plannedSessionId: z.number().int().positive().optional(),
        startTime: z.string().datetime({ offset: true }).optional(),
        durationMinutes: z.number().int().min(1).max(1440).optional(),
        feeling: z.enum(WORKOUT_FEELINGS).optional(),
        notes: z.string().max(2000).optional(),
        sets: z
          .array(loggedSet)
          .min(1)
          .max(100)
          .refine(
            (arr) => new Set(arr.map((s) => `${s.exerciseId}:${s.setNumber}`)).size === arr.length,
            { message: "setNumber values must be unique per exercise" },
          ),
      },
      annotations: { openWorldHint: false },
    },
    async (args) => {
      try {
        const both = args.sets.find((s) => s.rir != null && s.rpe != null);
        if (both) return fail(`Set ${both.setNumber}: send rir or rpe, not both (rpe is derived from rir).`);
        const { timeZone } = await getUserSettings(userId);
        const today = toDateStr(await userToday(userId));
        if (args.date > today) return fail("date is in the future");
        if (args.date < toDateStr(addDays(await userToday(userId), -LOG_SESSION_MAX_DAYS_BACK))) {
          return fail(`date is more than ${LOG_SESSION_MAX_DAYS_BACK} days back`);
        }
        // Without a time: noon on the day in the user's zone, as an
        // auto-completed day, or now if that is still to come today.
        const start = args.startTime
          ? new Date(args.startTime)
          : new Date(Math.min(instantInZone(args.date, 12, 0, timeZone).getTime(), Date.now()));
        if (start.getTime() > Date.now()) return fail("startTime is in the future");
        if (localDateStr(start, timeZone) !== args.date) {
          return fail(`startTime is on ${localDateStr(start, timeZone)} in the user's time zone, not on date ${args.date}`);
        }

        let plannedSessionId: number | null = null;
        if (args.plannedSessionId != null) {
          const planned = await ownPlanned(userId, args.plannedSessionId);
          if (!planned) return fail("Planned session not found");
          if (args.programId != null && planned.programId !== args.programId) return fail("That planned session is for another program");
          // Only on its own day (review 23): a session done another day is logged without it.
          if (planned.date !== args.date) return fail(`That planned session is on ${planned.date}, not ${args.date}; log it without plannedSessionId`);
          args.programId = planned.programId ?? undefined;
          plannedSessionId = planned.id;
        }

        if (args.programId != null) {
          const [prog] = await db
            .select({ id: programs.id })
            .from(programs)
            .where(and(eq(programs.id, args.programId), eq(programs.userId, userId), livePrograms));
          if (!prog) return fail("Program not found");
        }

        const exerciseIds = [...new Set(args.sets.map((s) => s.exerciseId))];
        const visible = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(and(inArray(exercises.id, exerciseIds), or(isNull(exercises.userId), eq(exercises.userId, userId))));
        if (visible.length !== exerciseIds.length) return fail("Exercise not found");

        let session;
        try {
          session = await writeLoggedSession(userId, {
            date: args.date,
            start,
            programId: args.programId ?? null,
            plannedSessionId,
            durationMinutes: args.durationMinutes,
            feeling: args.feeling,
            notes: args.notes ?? null,
            source: "assistant",
            sets: args.sets,
          });
        } catch (e) {
          if (e instanceof DuplicateSession) return fail(e.message);
          throw e;
        }
        audit("log_session", { userId, sessionId: session.id });
        return ok({ logged: true, sessionId: session.id, date: session.date, sets: args.sets.length });
      } catch (e) {
        return failInternal("log_session", e);
      }
    },
  );

  server.registerTool(
    "confirm_session",
    {
      description:
        "Mark a planned day of the user's active training cycle as done, with no sets: the same as a day the cycle tracks outside the app. Use it when the user did the session but it is not logged (for example a ride recorded only on a watch). date: a day of the active cycle, not in the future; programId: the program of one of its slots. Or plannedSessionId alone: a dated session from list_planned_sessions. The day then counts as done for adherence and the weekly sync. To record what was done, use log_session instead.",
      inputSchema: {
        date: dateStr.optional(),
        programId: z.number().int().positive().optional(),
        plannedSessionId: z.number().int().positive().optional(),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        let plannedSessionId: number | null = null;
        let plannedCycleId: number | null = null;
        if (args.plannedSessionId != null) {
          const planned = await ownPlanned(userId, args.plannedSessionId);
          if (!planned?.programId) return fail("Planned session not found");
          if ((args.date && args.date !== planned.date) || (args.programId && args.programId !== planned.programId)) {
            return fail("date and programId must match the planned session; send plannedSessionId alone");
          }
          args.date = planned.date!;
          args.programId = planned.programId;
          plannedSessionId = planned.id;
          plannedCycleId = planned.cycleId;
        }
        if (args.date == null || args.programId == null) return fail("Send date and programId, or plannedSessionId");
        const date = args.date;
        const programId = args.programId;
        // With endurance features on, an endurance session is answered with
        // its numbers, so an auto row cannot hide a miss (decision 21,
        // docs/plans/workouts-and-compliance.md).
        const { enduranceEnabledFor } = await import("@/lib/endurance");
        if (await enduranceEnabledFor(userId)) {
          const { programSports } = await import("@/lib/session-compliance");
          if ((await programSports([programId])).get(programId)) {
            return fail("This is an endurance session: use confirm_planned_session with its time (or a Garmin activity), or mark it missed.");
          }
        }
        // A block scheduled for today becomes the active one first.
        await startDueScheduledCycle(userId);
        const cycle = await db.query.trainingCycles.findFirst({
          where: and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), liveCycles),
          with: { slots: { where: eq(trainingCycleSlots.programId, programId), with: { program: true } } },
        });
        if (!cycle?.startDate) return fail("No active training cycle");
        // A dated session may run a program outside the template (changed or
        // added, review 25); it must belong to the active cycle.
        if (plannedSessionId != null ? plannedCycleId !== cycle.id : !cycle.slots.map(liveSlotProgram).some((s) => s.programId === programId)) {
          return fail(plannedSessionId != null ? "That planned session is not in the active cycle" : "That program is not in the active cycle");
        }
        if (date > toDateStr(await userToday(userId))) return fail("date is in the future");
        if (date < cycle.startDate) return fail(`date is before the cycle started (${cycle.startDate})`);

        // By id: that one session is done or not; a day can hold the program twice.
        if (plannedSessionId != null) {
          const { isPlannedDone } = await import("@/lib/planned-sessions");
          if (await isPlannedDone(userId, plannedSessionId)) return ok({ confirmed: true, date, programId, plannedSessionId, already: true });
          await insertAutoSessions(userId, [{ date, programId, plannedSessionId }]);
          audit("confirm_session", { userId, programId });
          return ok({ confirmed: true, date, programId, plannedSessionId, already: false });
        }

        const [logged] = await db
          .select({ id: workoutSessions.id })
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.programId, programId),
              eq(workoutSessions.date, date),
              eq(workoutSessions.isCompleted, true),
            ),
          )
          .limit(1);
        if (logged) return ok({ confirmed: true, date, programId, already: true });

        // Link the dated session of that day and program, when there is one.
        if (plannedSessionId == null) {
          const [row] = await db
            .select({ id: plannedSessions.id })
            .from(plannedSessions)
            .where(
              and(
                eq(plannedSessions.userId, userId),
                eq(plannedSessions.cycleId, cycle.id),
                eq(plannedSessions.date, date),
                eq(plannedSessions.programId, programId),
                eq(plannedSessions.status, "planned"),
                livePlannedSessions,
              ),
            )
            .limit(1);
          plannedSessionId = row?.id ?? null;
        }
        await insertAutoSessions(userId, [{ date, programId, plannedSessionId }]);
        audit("confirm_session", { userId, programId });
        return ok({ confirmed: true, date, programId, already: false });
      } catch (e) {
        return failInternal("confirm_session", e);
      }
    },
  );
}
