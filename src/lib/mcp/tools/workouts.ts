/**
 * MCP tools: workout history and metrics, read-only.
 *
 * Mirrors the queries in src/lib/actions/metrics.ts and workout-sessions.ts,
 * scoped to the userId resolved from the MCP OAuth access token (never a tool
 * parameter). The private helpers there can't be exported instead: anything
 * exported from a "use server" file is a callable action, and one taking a
 * userId would let a client name somebody else's.
 *
 * Free-text notes are returned: the user's own notes on sessions and sets,
 * and their note per exercise (decision D6 in docs/triathlon-coach-audit.md).
 * The MCP consent page names them, and they never reach friends.
 */

import { db } from "@/db";
import {
  exerciseNotes,
  exercisePrs,
  exercises,
  programs,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import { isUnverifiedPr } from "@/lib/utils/pr-provenance";
import { computeStreakWeeks } from "@/lib/utils/training-streak";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

/** One set, as an assistant needs it. Weights arrive from the database as strings. */
const SET_FIELDS = {
  sessionId: workoutSets.sessionId,
  exerciseName: exercises.name,
  setNumber: workoutSets.setNumber,
  setType: workoutSets.setType,
  reps: workoutSets.actualReps,
  weightKg: workoutSets.weightKg,
  durationSeconds: workoutSets.durationSeconds,
  distanceMeters: workoutSets.distanceMeters,
  heartRateZone: workoutSets.heartRateZone,
  rir: workoutSets.rir,
  rpe: workoutSets.rpe,
  isFailed: workoutSets.isFailed,
  notes: workoutSets.notes,
};

type SetRow = {
  [K in keyof typeof SET_FIELDS]: (typeof SET_FIELDS)[K]["_"]["data"] | null;
};

function shapeSet(s: SetRow) {
  return {
    setNumber: s.setNumber,
    setType: s.setType,
    reps: s.reps,
    weightKg: Number(s.weightKg),
    durationSeconds: s.durationSeconds,
    distanceMeters: s.distanceMeters,
    heartRateZone: s.heartRateZone,
    rir: s.rir,
    rpe: s.rpe,
    isFailed: s.isFailed,
    notes: s.notes,
  };
}

/** Sets in the order they were first logged, grouped under their exercise. */
function byExercise(sets: SetRow[]) {
  const groups = new Map<string, ReturnType<typeof shapeSet>[]>();
  for (const set of sets) {
    const name = String(set.exerciseName);
    groups.set(name, [...(groups.get(name) ?? []), shapeSet(set)]);
  }
  return [...groups].map(([exercise, exerciseSets]) => ({ exercise, sets: exerciseSets }));
}

export function registerWorkoutTools(server: McpServer, userId: string) {
  server.registerTool(
    "recent_workouts",
    {
      description:
        "The user's completed workouts over the last N days, newest first: date, program, duration, how they felt, readiness, the user's notes, and each exercise's sets with reps, weight, effort, any distance or duration, and set notes. Use this for questions like 'what did I lift last week'. Notes are the user's own words: health details in them are private, so use them for coaching only.",
      inputSchema: { days: z.number().int().min(1).max(90).default(14) },
      annotations: READ_ONLY,
    },
    async ({ days }) => {
      try {
        const sessions = await db
          .select({
            id: workoutSessions.id,
            date: workoutSessions.date,
            startTime: workoutSessions.startTime,
            endTime: workoutSessions.endTime,
            feeling: workoutSessions.feeling,
            readiness: workoutSessions.readiness,
            notes: workoutSessions.notes,
            source: workoutSessions.source,
            programName: programs.name,
          })
          .from(workoutSessions)
          // plan-read: includes deleted (history keeps the name of a deleted program)
          .leftJoin(programs, eq(workoutSessions.programId, programs.id))
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.isCompleted, true),
              sql`${workoutSessions.startTime} >= NOW() - make_interval(days => ${days})`,
            ),
          )
          .orderBy(desc(workoutSessions.startTime));
        if (sessions.length === 0) return ok({ days, workouts: [] });

        // Scoped to the sessions above, which are already the user's own.
        const sets = await db
          .select(SET_FIELDS)
          .from(workoutSets)
          .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
          .where(inArray(workoutSets.sessionId, sessions.map((s) => s.id)))
          .orderBy(asc(workoutSets.id));

        return ok({
          days,
          workouts: sessions.map((s) => ({
            date: s.date,
            program: s.programName ?? null,
            // Auto-completed cycle days have no real duration.
            durationMinutes:
              s.source !== "auto" && s.endTime
                ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60_000)
                : null,
            feeling: s.feeling ?? null,
            readiness: s.readiness ?? null,
            notes: s.notes ?? null,
            exercises: byExercise(sets.filter((set) => set.sessionId === s.id)),
          })),
        });
      } catch (e) {
        return failInternal("recent_workouts", e);
      }
    },
  );

  server.registerTool(
    "exercise_history",
    {
      description:
        "The user's sessions of one exercise, newest first, with every set and its notes, each session's notes, and the user's own standing note on the exercise (note). Matches on part of the name among exercises they have logged. If several match and none exactly, returns the candidates to choose from instead.",
      inputSchema: {
        exercise: z.string().trim().min(1).max(100),
        sessions: z.number().int().min(1).max(20).default(10),
      },
      annotations: READ_ONLY,
    },
    async ({ exercise, sessions: limit }) => {
      try {
        const candidates = await db
          .selectDistinct({ id: exercises.id, name: exercises.name })
          .from(workoutSets)
          .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
          .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.isCompleted, true),
              sql`strpos(lower(${exercises.name}), lower(${exercise})) > 0`,
            ),
          )
          .limit(25);
        if (candidates.length === 0) return fail(`No logged exercise matches "${exercise}"`);

        const exact = candidates.filter(
          (c) => c.name.toLowerCase() === exercise.toLowerCase(),
        );
        const chosen = exact.length === 1 ? exact : candidates;
        if (chosen.length > 1) return ok({ candidates: chosen.map((c) => c.name) });
        const [{ id: exerciseId, name }] = chosen;

        const sessions = await db
          .selectDistinct({ id: workoutSessions.id, date: workoutSessions.date, notes: workoutSessions.notes })
          .from(workoutSessions)
          .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.isCompleted, true),
              eq(workoutSets.exerciseId, exerciseId),
            ),
          )
          .orderBy(desc(workoutSessions.date), desc(workoutSessions.id))
          .limit(limit);

        // Scoped to the sessions above, which are already the user's own.
        const sets = sessions.length
          ? await db
              .select(SET_FIELDS)
              .from(workoutSets)
              .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
              .where(
                and(
                  inArray(workoutSets.sessionId, sessions.map((s) => s.id)),
                  eq(workoutSets.exerciseId, exerciseId),
                ),
              )
              .orderBy(asc(workoutSets.setNumber), asc(workoutSets.id))
          : [];

        const [note] = await db
          .select({ note: exerciseNotes.note })
          .from(exerciseNotes)
          .where(and(eq(exerciseNotes.userId, userId), eq(exerciseNotes.exerciseId, exerciseId)));

        return ok({
          exercise: name,
          note: note?.note ?? null,
          sessions: sessions.map((s) => ({
            date: s.date,
            notes: s.notes ?? null,
            sets: sets.filter((set) => set.sessionId === s.id).map(shapeSet),
          })),
        });
      } catch (e) {
        return failInternal("exercise_history", e);
      }
    },
  );

  server.registerTool(
    "personal_records",
    {
      description:
        "The user's standing personal records, newest first: weight, reps at a weight, estimated one-rep max, distance and pace. For pace the value is duration in seconds; for distance it is meters; otherwise kg or reps. `unverified` marks a record that predates reliable logging.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(30) },
      annotations: READ_ONLY,
    },
    async ({ limit }) => {
      try {
        const rows = await db
          .select({
            exercise: exercises.name,
            prType: exercisePrs.prType,
            value: exercisePrs.value,
            weightKg: exercisePrs.weightKg,
            distanceMeters: exercisePrs.distanceMeters,
            achievedAt: exercisePrs.achievedAt,
          })
          .from(exercisePrs)
          .innerJoin(exercises, eq(exercisePrs.exerciseId, exercises.id))
          .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt)))
          .orderBy(desc(exercisePrs.achievedAt))
          .limit(limit);

        return ok({
          records: rows.map((r) => {
            const achievedAt = r.achievedAt.toISOString();
            return {
              exercise: r.exercise,
              type: r.prType,
              value: Number(r.value),
              weightKg: r.weightKg != null ? Number(r.weightKg) : null,
              distanceMeters: r.distanceMeters != null ? Number(r.distanceMeters) : null,
              achievedAt,
              unverified: isUnverifiedPr(r.prType, achievedAt),
            };
          }),
        });
      } catch (e) {
        return failInternal("personal_records", e);
      }
    },
  );

  server.registerTool(
    "weekly_volume",
    {
      description:
        "Sessions and total volume (kg times reps) per week over the last N weeks, oldest first. Weeks with no training are absent.",
      inputSchema: { weeks: z.number().int().min(1).max(52).default(8) },
      annotations: READ_ONLY,
    },
    async ({ weeks }) => {
      try {
        const rows = await db
          .select({
            weekStart: sql<string>`date_trunc('week', ${workoutSessions.startTime})::date`,
            sessions: sql<number>`COUNT(DISTINCT ${workoutSessions.id})`,
            volumeKg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
          })
          .from(workoutSessions)
          .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.isCompleted, true),
              sql`${workoutSessions.startTime} >= NOW() - make_interval(weeks => ${weeks})`,
            ),
          )
          .groupBy(sql`date_trunc('week', ${workoutSessions.startTime})`)
          .orderBy(asc(sql`date_trunc('week', ${workoutSessions.startTime})`));

        return ok({
          weeks: rows.map((r) => ({
            weekStart: r.weekStart,
            sessions: Number(r.sessions),
            volumeKg: Number(r.volumeKg),
          })),
        });
      } catch (e) {
        return failInternal("weekly_volume", e);
      }
    },
  );

  server.registerTool(
    "summary_stats",
    {
      description:
        "Lifetime totals for the user: completed sessions, average session length in minutes, total volume in kg, and the current streak in weeks.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const [[session], [volume], weeks] = await Promise.all([
          db
            .select({
              total: sql<number>`COUNT(*)`,
              // Auto-completed cycle days have zero duration; keep them out of
              // the average while still counting them as sessions.
              avgMinutes: sql<number>`AVG(
                EXTRACT(EPOCH FROM (${workoutSessions.endTime} - ${workoutSessions.startTime})) / 60
              ) FILTER (WHERE ${workoutSessions.source} <> 'auto')`,
            })
            .from(workoutSessions)
            .where(
              and(
                eq(workoutSessions.userId, userId),
                eq(workoutSessions.isCompleted, true),
                isNotNull(workoutSessions.endTime),
              ),
            ),
          db
            .select({
              kg: sql<number>`COALESCE(SUM(CAST(${workoutSets.weightKg} AS numeric) * ${workoutSets.actualReps}), 0)`,
            })
            .from(workoutSets)
            .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
            .where(
              and(
                eq(workoutSessions.userId, userId),
                eq(workoutSessions.isCompleted, true),
              ),
            ),
          db
            .select({
              weekStart: sql<string>`date_trunc('week', ${workoutSessions.startTime})::date`,
            })
            .from(workoutSessions)
            .where(
              and(
                eq(workoutSessions.userId, userId),
                eq(workoutSessions.isCompleted, true),
                sql`${workoutSessions.startTime} >= NOW() - interval '52 weeks'`,
              ),
            )
            .groupBy(sql`date_trunc('week', ${workoutSessions.startTime})`)
            .orderBy(desc(sql`date_trunc('week', ${workoutSessions.startTime})`)),
        ]);

        return ok({
          totalSessions: Number(session?.total ?? 0),
          avgSessionMinutes: Math.round(Number(session?.avgMinutes ?? 0)),
          lifetimeVolumeKg: Number(volume?.kg ?? 0),
          currentStreakWeeks: computeStreakWeeks(weeks.map((w) => w.weekStart)),
        });
      } catch (e) {
        return failInternal("summary_stats", e);
      }
    },
  );
}
