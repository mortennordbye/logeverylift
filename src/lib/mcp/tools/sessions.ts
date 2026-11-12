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
  programs,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { insertAutoSessions } from "@/lib/auto-sessions";
import { startDueScheduledCycle } from "@/lib/plan-revisions";
import { liveCycles, livePrograms, liveSlotProgram } from "@/lib/plan-live";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { rpeFromRir } from "@/lib/utils/rir";
import { WORKOUT_FEELINGS } from "@/lib/validators/workout";
import { lockRecords, rebuildPRsFrom } from "@/lib/workout-records";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
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

export function registerSessionTools(server: McpServer, userId: string) {
  server.registerTool(
    "log_session",
    {
      description: [
        "Log a completed workout the user did outside the app (for example a run they tell you about), with its sets.",
        `date is the day it happened (YYYY-MM-DD, today or up to ${LOG_SESSION_MAX_DAYS_BACK} days back, in the user's time zone). Optional programId (one of the user's programs, when it was a planned session), startTime (ISO), durationMinutes, feeling, notes.`,
        "Each set takes exerciseId (search_exercises), setNumber, and any of reps, weightKg, durationSeconds, distanceMeters, heartRateZone (1-5), rir (0-5), rpe (1-10), notes, setType. All values are metric. Any other key fails the call.",
        "Personal records are rebuilt from this session on. It replaces a day the cycle auto-completed for the same program. Refused when the user already logged that program on that date: read recent_workouts first. The session shows as logged by the assistant; you cannot edit or delete it afterwards (the user can, in History).",
      ].join(" "),
      inputSchema: {
        date: dateStr,
        programId: z.number().int().positive().optional(),
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
        const today = toDateStr(await userToday(userId));
        if (args.date > today) return fail("date is in the future");
        if (args.date < toDateStr(addDays(await userToday(userId), -LOG_SESSION_MAX_DAYS_BACK))) {
          return fail(`date is more than ${LOG_SESSION_MAX_DAYS_BACK} days back`);
        }
        // Without a time: noon on the day, as an auto-completed day, or now if
        // that is still to come today.
        const start = args.startTime
          ? new Date(args.startTime)
          : new Date(Math.min(new Date(`${args.date}T12:00:00`).getTime(), Date.now()));
        if (start.getTime() > Date.now()) return fail("startTime is in the future");

        if (args.programId != null) {
          const [prog] = await db
            .select({ id: programs.id })
            .from(programs)
            .where(and(eq(programs.id, args.programId), eq(programs.userId, userId), livePrograms));
          if (!prog) return fail("Program not found");
          const [dup] = await db
            .select({ id: workoutSessions.id })
            .from(workoutSessions)
            .where(
              and(
                eq(workoutSessions.userId, userId),
                eq(workoutSessions.programId, args.programId),
                eq(workoutSessions.date, args.date),
                eq(workoutSessions.isCompleted, true),
                ne(workoutSessions.source, "auto"),
              ),
            )
            .limit(1);
          if (dup) {
            return fail(`The user already logged this program on ${args.date} (session ${dup.id}). Read recent_workouts.`);
          }
        }

        const exerciseIds = [...new Set(args.sets.map((s) => s.exerciseId))];
        const visible = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(and(inArray(exercises.id, exerciseIds), or(isNull(exercises.userId), eq(exercises.userId, userId))));
        if (visible.length !== exerciseIds.length) return fail("Exercise not found");

        const session = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(workoutSessions)
            .values({
              userId,
              programId: args.programId ?? null,
              date: args.date,
              startTime: start,
              endTime: args.durationMinutes ? new Date(start.getTime() + args.durationMinutes * 60_000) : null,
              feeling: args.feeling ?? null,
              notes: args.notes ?? null,
              isCompleted: true,
              source: "assistant",
            })
            .returning();
          // Dated by when they happened: the records replay orders and dates
          // sets by createdAt. One second apart keeps the input's order.
          await tx.insert(workoutSets).values(
            args.sets.map((s, i) => ({
              sessionId: row.id,
              exerciseId: s.exerciseId,
              setNumber: s.setNumber,
              setType: s.setType ?? "working",
              actualReps: s.reps ?? 0,
              weightKg: String(s.weightKg ?? 0),
              durationSeconds: s.durationSeconds ?? null,
              distanceMeters: s.distanceMeters ?? null,
              heartRateZone: s.heartRateZone ?? null,
              rir: s.rir ?? null,
              rpe: s.rir != null ? rpeFromRir(s.rir) : (s.rpe ?? null),
              restTimeSeconds: 0,
              notes: s.notes ?? null,
              createdAt: new Date(start.getTime() + i * 1000),
            })),
          );
          // As completeWorkoutSession: a logged day replaces its auto row.
          if (args.programId != null) {
            await tx
              .delete(workoutSessions)
              .where(
                and(
                  eq(workoutSessions.userId, userId),
                  eq(workoutSessions.programId, args.programId),
                  eq(workoutSessions.date, args.date),
                  eq(workoutSessions.source, "auto"),
                ),
              );
          }
          for (const exerciseId of exerciseIds.sort((a, b) => a - b)) {
            await lockRecords(tx, userId, exerciseId);
            await rebuildPRsFrom(tx, userId, exerciseId, start);
          }
          return row;
        });

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
        "Mark a planned day of the user's active training cycle as done, with no sets: the same as a day the cycle tracks outside the app. Use it when the user did the session but it is not logged (for example a ride recorded only on a watch). date: a day of the active cycle, not in the future; programId: the program of one of its slots. The day then counts as done for adherence and the weekly sync. To record what was done, use log_session instead.",
      inputSchema: {
        date: dateStr,
        programId: z.number().int().positive(),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    async ({ date, programId }) => {
      try {
        // A block scheduled for today becomes the active one first.
        await startDueScheduledCycle(userId);
        const cycle = await db.query.trainingCycles.findFirst({
          where: and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), liveCycles),
          with: { slots: { where: eq(trainingCycleSlots.programId, programId), with: { program: true } } },
        });
        if (!cycle?.startDate) return fail("No active training cycle");
        if (!cycle.slots.map(liveSlotProgram).some((s) => s.programId === programId)) {
          return fail("That program is not in the active cycle");
        }
        if (date > toDateStr(await userToday(userId))) return fail("date is in the future");
        if (date < cycle.startDate) return fail(`date is before the cycle started (${cycle.startDate})`);

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

        await insertAutoSessions(userId, [{ date, programId }]);
        audit("confirm_session", { userId, programId });
        return ok({ confirmed: true, date, programId, already: false });
      } catch (e) {
        return failInternal("confirm_session", e);
      }
    },
  );
}
