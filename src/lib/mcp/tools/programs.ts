/**
 * MCP tools: programs, their exercise slots and planned sets.
 *
 * Mirrors src/lib/actions/programs.ts, scoped to the MCP-authenticated userId.
 * Ownership is enforced on every read and write (program.userId, or
 * programExercise -> program -> userId), matching the Server Actions.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, programs } from "@/db/schema";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

const PROGRESSION_MODES = [
  "none",
  "manual",
  "weight",
  "smart",
  "reps",
  "time",
  "distance",
] as const;

// Planned-set shape shared by the add/update paths of edit_program_exercise.
const setShape = z.object({
  setNumber: z.number().int().positive(),
  targetReps: z.number().int().positive().nullable().optional(),
  weightKg: z.number().nonnegative().max(9999).nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  distanceMeters: z.number().int().positive().nullable().optional(),
  inclinePercent: z.number().int().min(0).max(30).nullable().optional(),
  restTimeSeconds: z.number().int().nonnegative().optional(),
  setType: z.enum(["working", "warmup"]).optional(),
});

type SetInput = z.infer<typeof setShape>;

function setValues(programExerciseId: number, s: SetInput) {
  return {
    programExerciseId,
    setNumber: s.setNumber,
    targetReps: s.targetReps ?? null,
    weightKg: s.weightKg != null ? s.weightKg.toString() : null,
    durationSeconds: s.durationSeconds ?? null,
    distanceMeters: s.distanceMeters ?? null,
    inclinePercent: s.inclinePercent ?? null,
    restTimeSeconds: s.restTimeSeconds ?? 0,
    setType: s.setType ?? "working",
  };
}

/** Returns the owning userId for a program exercise, or null if not found. */
async function programExerciseOwner(programExerciseId: number) {
  const [row] = await db
    .select({ userId: programs.userId, programId: programs.id })
    .from(programExercises)
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(eq(programExercises.id, programExerciseId))
    .limit(1);
  return row ?? null;
}

export function registerProgramTools(server: McpServer, userId: string) {
  server.registerTool(
    "list_programs",
    {
      description:
        "List the current user's workout programs (id, name, createdAt), ordered by name.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const rows = await db
          .select()
          .from(programs)
          .where(eq(programs.userId, userId))
          .orderBy(asc(programs.name));
        return ok(rows);
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "get_program",
    {
      description:
        "Get one program with its ordered exercise slots and planned sets.",
      inputSchema: { programId: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ programId }) => {
      try {
        const program = await db.query.programs.findFirst({
          where: and(eq(programs.id, programId), eq(programs.userId, userId)),
          with: {
            programExercises: {
              orderBy: (pe, { asc }) => [asc(pe.orderIndex)],
              with: {
                exercise: true,
                programSets: { orderBy: (ps, { asc }) => [asc(ps.setNumber)] },
              },
            },
          },
        });
        if (!program) return fail("Program not found");
        return ok(program);
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "create_program",
    {
      description: "Create a new empty workout program.",
      inputSchema: { name: z.string().min(1).max(100) },
      annotations: { openWorldHint: false },
    },
    async ({ name }) => {
      try {
        const [program] = await db
          .insert(programs)
          .values({ name, userId })
          .returning();
        return ok(program);
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "update_program",
    {
      description: "Rename an existing program.",
      inputSchema: {
        programId: z.number().int().positive(),
        name: z.string().min(1).max(100),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    async ({ programId, name }) => {
      try {
        const [updated] = await db
          .update(programs)
          .set({ name })
          .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
          .returning();
        if (!updated) return fail("Program not found");
        return ok(updated);
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "delete_program",
    {
      description:
        "Delete a program and all of its exercises and sets. This is permanent.",
      inputSchema: { programId: z.number().int().positive() },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ programId }) => {
      try {
        const [deleted] = await db
          .delete(programs)
          .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
          .returning({ id: programs.id });
        if (!deleted) return fail("Program not found");
        audit("delete_program", { userId, programId });
        return ok({ deleted: true, programId });
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "edit_program_exercise",
    {
      description: [
        "Add, update, or remove an exercise slot within a program (including its planned sets).",
        "operation='add': requires programId and exerciseId; optional orderIndex (defaults to end), notes, progressionMode, overloadIncrementKg, overloadIncrementReps, and sets[].",
        "operation='update': requires programExerciseId; any provided slot fields are updated. If sets[] is provided it REPLACES all existing sets for the slot.",
        "operation='remove': requires programExerciseId.",
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["add", "update", "remove"]),
        programId: z.number().int().positive().optional(),
        programExerciseId: z.number().int().positive().optional(),
        exerciseId: z.number().int().positive().optional(),
        orderIndex: z.number().int().nonnegative().optional(),
        notes: z.string().max(1000).nullable().optional(),
        progressionMode: z.enum(PROGRESSION_MODES).optional(),
        // decimal(4,2) column: max is 99.99 — 100 would overflow and throw.
        overloadIncrementKg: z.number().min(0).max(99.99).nullable().optional(),
        overloadIncrementReps: z.number().int().min(0).max(100).optional(),
        sets: z
          .array(setShape)
          .max(50)
          .refine(
            (arr) => new Set(arr.map((s) => s.setNumber)).size === arr.length,
            { message: "setNumber values must be unique within sets" },
          )
          .optional(),
      },
    },
    async (args) => {
      try {
        if (args.operation === "add") {
          const { programId, exerciseId } = args;
          if (programId == null || exerciseId == null) {
            return fail("programId and exerciseId are required to add an exercise");
          }
          // Verify program ownership.
          const [prog] = await db
            .select({ userId: programs.userId })
            .from(programs)
            .where(eq(programs.id, programId))
            .limit(1);
          if (!prog || prog.userId !== userId) return fail("Program not found");

          // Verify the exercise exists and is accessible (system or owned).
          const [ex] = await db
            .select({ id: exercises.id })
            .from(exercises)
            .where(
              and(
                eq(exercises.id, exerciseId),
                or(isNull(exercises.userId), eq(exercises.userId, userId)),
              ),
            )
            .limit(1);
          if (!ex) return fail("Exercise not found");

          let orderIndex = args.orderIndex;
          if (orderIndex === undefined) {
            const existing = await db
              .select({ id: programExercises.id })
              .from(programExercises)
              .where(eq(programExercises.programId, programId));
            orderIndex = existing.length;
          }

          // Insert the slot and its sets atomically — a failed sets insert must
          // not leave a slot with no sets.
          const pe = await db.transaction(async (tx) => {
            const [inserted] = await tx
              .insert(programExercises)
              .values({
                programId,
                exerciseId,
                orderIndex,
                notes: args.notes ?? null,
                progressionMode: args.progressionMode ?? "manual",
                overloadIncrementKg:
                  args.overloadIncrementKg != null
                    ? args.overloadIncrementKg.toString()
                    : null,
                overloadIncrementReps: args.overloadIncrementReps ?? 0,
              })
              .returning();
            if (args.sets && args.sets.length > 0) {
              await tx
                .insert(programSets)
                .values(args.sets.map((s) => setValues(inserted.id, s)));
            }
            return inserted;
          });
          return ok(pe);
        }

        if (args.operation === "update") {
          const { programExerciseId } = args;
          if (programExerciseId == null) {
            return fail("programExerciseId is required to update an exercise");
          }
          const owner = await programExerciseOwner(programExerciseId);
          if (!owner || owner.userId !== userId) return fail("Exercise slot not found");

          const peUpdates: Record<string, unknown> = {};
          if (args.exerciseId !== undefined) peUpdates.exerciseId = args.exerciseId;
          if (args.orderIndex !== undefined) peUpdates.orderIndex = args.orderIndex;
          if (args.notes !== undefined) peUpdates.notes = args.notes;
          if (args.progressionMode !== undefined)
            peUpdates.progressionMode = args.progressionMode;
          if (args.overloadIncrementKg !== undefined)
            peUpdates.overloadIncrementKg =
              args.overloadIncrementKg != null
                ? args.overloadIncrementKg.toString()
                : null;
          if (args.overloadIncrementReps !== undefined)
            peUpdates.overloadIncrementReps = args.overloadIncrementReps;

          // Apply the slot edits and the wholesale set-replace in one
          // transaction: deleting the old sets must roll back if the re-insert
          // fails, otherwise the slot is left with no sets (data loss).
          await db.transaction(async (tx) => {
            if (Object.keys(peUpdates).length > 0) {
              await tx
                .update(programExercises)
                .set(peUpdates)
                .where(eq(programExercises.id, programExerciseId));
            }
            if (args.sets !== undefined) {
              await tx
                .delete(programSets)
                .where(eq(programSets.programExerciseId, programExerciseId));
              if (args.sets.length > 0) {
                await tx
                  .insert(programSets)
                  .values(args.sets.map((s) => setValues(programExerciseId, s)));
              }
            }
          });
          return ok({ updated: true, programExerciseId });
        }

        // remove
        const { programExerciseId } = args;
        if (programExerciseId == null) {
          return fail("programExerciseId is required to remove an exercise");
        }
        const owner = await programExerciseOwner(programExerciseId);
        if (!owner || owner.userId !== userId) return fail("Exercise slot not found");
        await db
          .delete(programExercises)
          .where(eq(programExercises.id, programExerciseId));
        audit("remove_program_exercise", { userId, programExerciseId });
        return ok({ removed: true, programExerciseId });
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );
}
