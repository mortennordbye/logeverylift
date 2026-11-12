/**
 * MCP tools: the exercise library (docs/plans/ai-coach.md, 2.3).
 *
 * An assistant needs an exercise id for edit_program_exercise and log_session;
 * these let it find one, or make a custom one, the way the app does. Visible
 * exercises are the built-in ones and the user's own custom ones, never
 * another user's.
 */

import { db } from "@/db";
import {
  bodyAreaEnum,
  disciplineEnum,
  equipmentEnum,
  exerciseCategoryEnum,
  exerciseTypeEnum,
  exercises,
  movementPatternEnum,
  muscleGroupEnum,
} from "@/db/schema";
import { createCustomExerciseFor } from "@/lib/custom-exercises";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

function shape(e: typeof exercises.$inferSelect) {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    discipline: e.discipline,
    timed: e.isTimed,
    custom: e.userId != null,
    muscleGroup: e.muscleGroup,
    equipment: e.equipment,
    movementPattern: e.movementPattern,
  };
}

export function registerExerciseTools(server: McpServer, userId: string) {
  server.registerTool(
    "search_exercises",
    {
      description:
        "Find exercises in the library: the built-in ones and the user's own custom ones. Matches part of the name (any case); optional filters. Returns id, name, category, discipline (swim, bike or run for endurance exercises), whether it is held for time, whether it is the user's custom one, muscle group, equipment and movement pattern. Use the id with edit_program_exercise or log_session.",
      inputSchema: {
        query: z.string().trim().max(100).optional(),
        category: z.enum(exerciseCategoryEnum).optional(),
        discipline: z.enum(disciplineEnum).optional(),
        muscleGroup: z.enum(muscleGroupEnum).optional(),
        equipment: z.enum(equipmentEnum).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, category, discipline, muscleGroup, equipment, limit }) => {
      try {
        const rows = await db
          .select()
          .from(exercises)
          .where(
            and(
              or(isNull(exercises.userId), eq(exercises.userId, userId)),
              query ? sql`strpos(lower(${exercises.name}), lower(${query})) > 0` : undefined,
              category ? eq(exercises.category, category) : undefined,
              discipline ? eq(exercises.discipline, discipline) : undefined,
              muscleGroup ? eq(exercises.muscleGroup, muscleGroup) : undefined,
              equipment ? eq(exercises.equipment, equipment) : undefined,
            ),
          )
          // An exact name first, then the shortest names (closest matches).
          .orderBy(
            sql`(lower(${exercises.name}) = lower(${query ?? ""})) desc`,
            sql`length(${exercises.name})`,
            asc(exercises.name),
          )
          .limit(limit);
        return ok({ exercises: rows.map(shape) });
      } catch (e) {
        return failInternal("search_exercises", e);
      }
    },
  );

  server.registerTool(
    "create_exercise",
    {
      description:
        "Create a custom exercise for the user, as the app's exercise form does. The name must not match a built-in exercise or one of the user's own (search_exercises first). Set discipline (swim, bike or run) on an endurance exercise: the app's training limits find runs by it. Set isTimed for an exercise held for time rather than counted in reps.",
      inputSchema: {
        name: z.string().trim().min(1).max(100),
        category: z.enum(exerciseCategoryEnum),
        discipline: z.enum(disciplineEnum).optional(),
        isTimed: z.boolean().optional(),
        bodyArea: z.enum(bodyAreaEnum).optional(),
        muscleGroup: z.enum(muscleGroupEnum).optional(),
        equipment: z.enum(equipmentEnum).optional(),
        movementPattern: z.enum(movementPatternEnum).optional(),
        exerciseType: z.enum(exerciseTypeEnum).optional(),
      },
      annotations: { openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await createCustomExerciseFor(userId, args);
        if (!result.success) return fail(result.error);
        audit("create_exercise", { userId, exerciseId: result.data.id });
        return ok(shape(result.data));
      } catch (e) {
        return failInternal("create_exercise", e);
      }
    },
  );
}
