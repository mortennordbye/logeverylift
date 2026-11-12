/**
 * MCP tools: programs, their exercise slots and planned sets.
 *
 * Mirrors src/lib/actions/programs.ts, scoped to the MCP-authenticated userId.
 * Ownership is enforced on every read and write (program.userId, or
 * programExercise -> program -> userId), matching the Server Actions.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, programs, workoutSessions, workoutSets } from "@/db/schema";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import {
  REVISION_RULES,
  assistantContext,
  expectedVersionArg,
  planErrorResult,
  reasonArg,
  registerRevisionTools,
} from "@/lib/mcp/revisions";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { deletePrograms, planWrite, softDeleteSlot, versionKey, type Tx } from "@/lib/plan-revisions";
import { matchSets } from "@/lib/utils/plan-revisions";
import { periodizationShare } from "@/lib/periodization-sync";
import {
  MAX_BACKOFF_AFTER,
  MAX_BACKOFF_PCT,
  MAX_REQUIRED_HITS,
  MIN_BACKOFF_AFTER,
  MIN_BACKOFF_PCT,
  MIN_REQUIRED_HITS,
  PROGRESSION_ADVANCES,
  PROGRESSION_READINESSES,
  PROGRESSION_REGRESSES,
  PROGRESSION_SCOPES,
  judgingRuleChanged,
  type ProgressionAdvance,
} from "@/lib/utils/progression";
import { reanchoredPeaks } from "@/lib/utils/periodization";
import { REP_RANGE_MESSAGE, repRangeIsWellFormed } from "@/lib/validators/workout";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

/**
 * The retired mode values. Still accepted so an agent mid-conversation does not
 * start failing, and mapped onto the advance axis on the way in; nothing reads
 * the column any more. Do not add to this list — new schemes are axis values.
 */
const PROGRESSION_MODES = [
  "none",
  "manual",
  "weight",
  "smart",
  "double",
  "reps",
  "time",
  "distance",
] as const;

const ADVANCE_FOR_LEGACY_MODE: Record<
  (typeof PROGRESSION_MODES)[number],
  ProgressionAdvance
> = {
  none: "none",
  manual: "manual",
  weight: "load",
  // D-4: smart is retired as a scheme and becomes plain load progression.
  smart: "load",
  double: "double",
  reps: "reps",
  time: "duration",
  distance: "distance",
};

// Planned-set shape shared by the add/update paths of edit_program_exercise.
// Strict: a key the shape does not know fails the call by name. Zod's default
// strips it, and the model was told a write worked when part of it was lost.
// The ranges match the app's own set validators (validators/workout.ts).
const setShape = z
  .object({
    // The stored set this entry updates. Without it, the entry updates the
    // stored set at the same setNumber (docs/plans/revisions.md, 2.3).
    id: z.number().int().positive().optional(),
    setNumber: z.number().int().positive(),
    targetReps: z.number().int().positive().nullable().optional(),
    repRangeMin: z.number().int().positive().max(1000).nullable().optional(),
    repRangeMax: z.number().int().positive().max(1000).nullable().optional(),
    targetRir: z.number().int().min(0).max(5).nullable().optional(),
    weightKg: z.number().nonnegative().max(9999).nullable().optional(),
    durationSeconds: z.number().int().positive().nullable().optional(),
    distanceMeters: z.number().int().positive().nullable().optional(),
    inclinePercent: z.number().int().min(0).max(30).nullable().optional(),
    targetHeartRateZone: z.number().int().min(1).max(5).nullable().optional(),
    sessionRole: z.enum(["work"]).nullable().optional(),
    startDelaySeconds: z.number().int().min(0).max(60).nullable().optional(),
    restTimeSeconds: z.number().int().nonnegative().optional(),
    setType: z.enum(["working", "warmup"]).optional(),
  })
  .strict()
  .refine(repRangeIsWellFormed, { message: REP_RANGE_MESSAGE, path: ["repRangeMin"] });

type SetInput = z.infer<typeof setShape>;

/** Thrown inside the set-list transaction so a refused list writes nothing. */
class SetListRefused extends Error {}

/**
 * Rows logged against a set in the user's open sessions move with it when its
 * position changes, the rule reorderProgramSets uses.
 */
async function moveOpenSessionRows(tx: Tx, userId: string, programSetId: number, setNumber: number) {
  const open = tx
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, false)));
  await tx
    .update(workoutSets)
    .set({ setNumber })
    .where(and(eq(workoutSets.programSetId, programSetId), inArray(workoutSets.sessionId, open)));
}

function setValues(programExerciseId: number, s: SetInput) {
  return {
    programExerciseId,
    setNumber: s.setNumber,
    targetReps: s.targetReps ?? null,
    repRangeMin: s.repRangeMin ?? null,
    repRangeMax: s.repRangeMax ?? null,
    targetRir: s.targetRir ?? null,
    weightKg: s.weightKg != null ? s.weightKg.toString() : null,
    durationSeconds: s.durationSeconds ?? null,
    distanceMeters: s.distanceMeters ?? null,
    inclinePercent: s.inclinePercent ?? null,
    targetHeartRateZone: s.targetHeartRateZone ?? null,
    sessionRole: s.sessionRole ?? null,
    startDelaySeconds: s.startDelaySeconds ?? null,
    restTimeSeconds: s.restTimeSeconds ?? 0,
    setType: s.setType ?? "working",
  };
}

/** Returns the owning userId for a live program exercise, or null if not found. */
async function programExerciseOwner(programExerciseId: number) {
  const [row] = await db
    .select({ userId: programs.userId, programId: programs.id })
    .from(programExercises)
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(and(eq(programExercises.id, programExerciseId), liveProgramExercises, livePrograms))
    .limit(1);
  return row ?? null;
}

const programVersion = (versions: Map<string, number>, programId: number) =>
  versions.get(versionKey({ type: "program", id: programId }));

export function registerProgramTools(server: McpServer, userId: string, clientId?: string) {
  registerRevisionTools(server, userId, clientId);

  server.registerTool(
    "list_programs",
    {
      description:
        "List the current user's workout programs (id, name, version, createdAt), ordered by name. Deleted programs are left out.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const rows = await db
          .select()
          .from(programs)
          .where(and(eq(programs.userId, userId), livePrograms))
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
        "Get one program with its ordered exercise slots and planned sets, and its version. Pass the version as expectedVersion when you change it.",
      inputSchema: { programId: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ programId }) => {
      try {
        const program = await db.query.programs.findFirst({
          where: and(eq(programs.id, programId), eq(programs.userId, userId), livePrograms),
          with: {
            programExercises: {
              where: liveProgramExercises,
              orderBy: (pe, { asc }) => [asc(pe.orderIndex)],
              with: {
                exercise: true,
                programSets: { where: liveProgramSets, orderBy: (ps, { asc }) => [asc(ps.setNumber)] },
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
      description: `Create a new empty workout program. ${REVISION_RULES}`,
      inputSchema: { name: z.string().min(1).max(100), reason: reasonArg },
      annotations: { openWorldHint: false },
    },
    async ({ name, reason }) => {
      try {
        const { result: program } = await planWrite(assistantContext(userId, clientId, reason), async (w) => {
          const [row] = await w.tx.insert(programs).values({ name, userId }).returning();
          w.create({ type: "program", id: row.id });
          return row;
        });
        return ok(program);
      } catch (e) {
        return failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "update_program",
    {
      description: "Rename an existing program. Returns the program with its new version.",
      inputSchema: {
        programId: z.number().int().positive(),
        name: z.string().min(1).max(100),
        reason: reasonArg,
        expectedVersion: expectedVersionArg,
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    async ({ programId, name, reason, expectedVersion }) => {
      try {
        await planWrite(assistantContext(userId, clientId, reason), async (w) => {
          await w.touch({ type: "program", id: programId }, { expectedVersion });
          await w.tx.update(programs).set({ name }).where(eq(programs.id, programId));
        });
        // plan-read: includes deleted (re-reads the row this call just wrote)
        const [updated] = await db.select().from(programs).where(eq(programs.id, programId));
        return ok(updated);
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "delete_program",
    {
      description:
        "Delete a program with its exercises and sets. Logged workouts keep their link. The user can restore it in the app for 90 days, and you can with restore_revision. Refused while the user has a workout in progress on it.",
      inputSchema: {
        programId: z.number().int().positive(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg,
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ programId, reason, expectedVersion }) => {
      try {
        await deletePrograms(assistantContext(userId, clientId, reason), [programId], expectedVersion);
        audit("delete_program", { userId, programId });
        return ok({ deleted: true, programId });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("programs", e);
      }
    },
  );

  server.registerTool(
    "edit_program_exercise",
    {
      description: [
        "Add, update, or remove an exercise slot within a program (including its planned sets).",
        "operation='add': requires programId and exerciseId; optional orderIndex (defaults to end), notes, overloadIncrementKg, overloadIncrementReps, progressionRequiredHits, progressionApplyToPlan, the progression axes (progressionAdvance, progressionScope, progressionRegress, progressionBackoffPct, progressionBackoffAfter, progressionReadiness), and sets[].",
        "progressionAdvance is what moves when the gate is met: 'load' adds weight, 'reps' adds reps at the same weight, 'double' works a rep range (set repRangeMin and repRangeMax on the sets), 'duration' and 'distance' for held or covered targets, 'manual' proposes nothing, 'none' turns progression off. Set targetRir on a set to require reps in reserve before a session counts.",
        "progressionMode is the retired single-axis setting. It is still accepted and mapped onto progressionAdvance, but prefer the axes.",
        "Each set takes setNumber and optional targetReps, repRangeMin and repRangeMax (both or neither, min <= targetReps <= max), targetRir (0-5), weightKg, durationSeconds, distanceMeters, inclinePercent, targetHeartRateZone (1-5), sessionRole ('work' marks a hard interval rep), startDelaySeconds (0-60, prep time before a timed set), restTimeSeconds and setType. Any other key fails the call. All values are metric.",
        "In an active training cycle the weekly sync owns targetHeartRateZone and restTimeSeconds on sets with sessionRole 'work' and rewrites them each week from the block phase. On a set with a peak anchor, a new distanceMeters or durationSeconds sets this week's value and the peak is re-derived from it.",
        "operation='update': requires programExerciseId; any provided slot fields are updated. A new exerciseId must be a built-in exercise or one of the user's own. If sets[] is provided it becomes the slot's full set list: an entry with id updates that set, an entry without id updates the set at the same setNumber, other entries are added, and stored sets that no entry names are removed. Set ids never change, so logged workouts keep their link. A set without sessionRole keeps the role it had.",
        "operation='remove': requires programExerciseId.",
        `Every operation requires reason and expectedVersion (the program's version). The result has the program's new version. ${REVISION_RULES}`,
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
        progressionAdvance: z.enum(PROGRESSION_ADVANCES).optional(),
        progressionScope: z.enum(PROGRESSION_SCOPES).optional(),
        progressionRegress: z.enum(PROGRESSION_REGRESSES).optional(),
        progressionBackoffPct: z
          .number()
          .int()
          .min(MIN_BACKOFF_PCT)
          .max(MAX_BACKOFF_PCT)
          .optional(),
        progressionBackoffAfter: z
          .number()
          .int()
          .min(MIN_BACKOFF_AFTER)
          .max(MAX_BACKOFF_AFTER)
          .optional(),
        progressionReadiness: z.enum(PROGRESSION_READINESSES).optional(),
        // decimal(4,2) column: max is 99.99 — 100 would overflow and throw.
        overloadIncrementKg: z.number().min(0).max(99.99).nullable().optional(),
        overloadIncrementReps: z.number().int().min(0).max(100).optional(),
        // Sessions at target before a bump is suggested; null = shared default.
        progressionRequiredHits: z
          .number()
          .int()
          .min(MIN_REQUIRED_HITS)
          .max(MAX_REQUIRED_HITS)
          .nullable()
          .optional(),
        // When true, accepting a bump also rewrites this slot's planned sets.
        progressionApplyToPlan: z.boolean().optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg,
        sets: z
          .array(setShape)
          .max(50)
          .refine(
            (arr) => new Set(arr.map((s) => s.setNumber)).size === arr.length,
            { message: "setNumber values must be unique within sets" },
          )
          .refine(
            (arr) => {
              const ids = arr.map((s) => s.id).filter((id) => id != null);
              return new Set(ids).size === ids.length;
            },
            { message: "set ids must be unique within sets" },
          )
          .optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        if (args.operation === "add") {
          const { programId, exerciseId } = args;
          if (programId == null || exerciseId == null) {
            return fail("programId and exerciseId are required to add an exercise");
          }

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

          // Insert the slot and its sets atomically — a failed sets insert must
          // not leave a slot with no sets.
          const { result: pe, versions } = await planWrite(ctx, async (w) => {
            const tx = w.tx;
            await w.touch({ type: "program", id: programId }, { expectedVersion: args.expectedVersion });
            let orderIndex = args.orderIndex;
            if (orderIndex === undefined) {
              const existing = await tx
                .select({ id: programExercises.id })
                .from(programExercises)
                .where(and(eq(programExercises.programId, programId), liveProgramExercises));
              orderIndex = existing.length;
            }
            const [inserted] = await tx
              .insert(programExercises)
              .values({
                programId,
                exerciseId,
                orderIndex,
                notes: args.notes ?? null,
                progressionMode: args.progressionMode ?? "manual",
                // The axis wins when both are given; the mode is the fallback
                // for an agent working from the older tool description.
                progressionAdvance:
                  args.progressionAdvance ??
                  ADVANCE_FOR_LEGACY_MODE[args.progressionMode ?? "manual"],
                ...(args.progressionScope != null
                  ? { progressionScope: args.progressionScope }
                  : {}),
                ...(args.progressionRegress != null
                  ? { progressionRegress: args.progressionRegress }
                  : {}),
                ...(args.progressionBackoffPct != null
                  ? { progressionBackoffPct: args.progressionBackoffPct }
                  : {}),
                ...(args.progressionBackoffAfter != null
                  ? { progressionBackoffAfter: args.progressionBackoffAfter }
                  : {}),
                ...(args.progressionReadiness != null
                  ? { progressionReadiness: args.progressionReadiness }
                  : {}),
                overloadIncrementKg:
                  args.overloadIncrementKg != null
                    ? args.overloadIncrementKg.toString()
                    : null,
                overloadIncrementReps: args.overloadIncrementReps ?? 0,
                progressionRequiredHits: args.progressionRequiredHits ?? null,
                progressionApplyToPlan: args.progressionApplyToPlan ?? false,
              })
              .returning();
            if (args.sets && args.sets.length > 0) {
              await tx
                .insert(programSets)
                .values(args.sets.map((s) => setValues(inserted.id, s)));
            }
            return inserted;
          });
          return ok({ ...pe, programVersion: programVersion(versions, programId) });
        }

        if (args.operation === "update") {
          const { programExerciseId } = args;
          if (programExerciseId == null) {
            return fail("programExerciseId is required to update an exercise");
          }
          const owner = await programExerciseOwner(programExerciseId);
          if (!owner || owner.userId !== userId) return fail("Exercise slot not found");
          const [current] = await db
            .select({
              exerciseId: programExercises.exerciseId,
              progressionAdvance: programExercises.progressionAdvance,
              progressionScope: programExercises.progressionScope,
              progressionRequiredHits: programExercises.progressionRequiredHits,
            })
            .from(programExercises)
            .where(and(eq(programExercises.id, programExerciseId), liveProgramExercises));

          // The same check as add: a slot may only point at a built-in
          // exercise or one of the user's own.
          if (args.exerciseId !== undefined && args.exerciseId !== current.exerciseId) {
            const [ex] = await db
              .select({ id: exercises.id })
              .from(exercises)
              .where(
                and(
                  eq(exercises.id, args.exerciseId),
                  or(isNull(exercises.userId), eq(exercises.userId, userId)),
                ),
              )
              .limit(1);
            if (!ex) return fail("Exercise not found");
          }

          const peUpdates: Record<string, unknown> = {};
          if (args.exerciseId !== undefined) {
            peUpdates.exerciseId = args.exerciseId;
            // A learned stack describes the old exercise's machine.
            if (args.exerciseId !== current.exerciseId) peUpdates.weightStack = null;
          }
          if (args.orderIndex !== undefined) peUpdates.orderIndex = args.orderIndex;
          if (args.notes !== undefined) peUpdates.notes = args.notes;
          if (args.progressionMode !== undefined) {
            peUpdates.progressionMode = args.progressionMode;
            peUpdates.progressionAdvance =
              ADVANCE_FOR_LEGACY_MODE[args.progressionMode];
          }
          // After the mode, so an agent that sends both gets the axis it asked
          // for rather than the one derived from the value it sent for parity.
          if (args.progressionAdvance !== undefined)
            peUpdates.progressionAdvance = args.progressionAdvance;
          if (args.progressionScope !== undefined)
            peUpdates.progressionScope = args.progressionScope;
          if (args.progressionRegress !== undefined)
            peUpdates.progressionRegress = args.progressionRegress;
          if (args.progressionBackoffPct !== undefined)
            peUpdates.progressionBackoffPct = args.progressionBackoffPct;
          if (args.progressionBackoffAfter !== undefined)
            peUpdates.progressionBackoffAfter = args.progressionBackoffAfter;
          if (args.progressionReadiness !== undefined)
            peUpdates.progressionReadiness = args.progressionReadiness;
          if (args.overloadIncrementKg !== undefined)
            peUpdates.overloadIncrementKg =
              args.overloadIncrementKg != null
                ? args.overloadIncrementKg.toString()
                : null;
          if (args.overloadIncrementReps !== undefined)
            peUpdates.overloadIncrementReps = args.overloadIncrementReps;
          if (args.progressionRequiredHits !== undefined)
            peUpdates.progressionRequiredHits = args.progressionRequiredHits;
          if (args.progressionApplyToPlan !== undefined)
            peUpdates.progressionApplyToPlan = args.progressionApplyToPlan;
          // E-13, as in setProgramExerciseProgression: an agent changing how
          // sessions are judged restarts the window just as the sheet does.
          if (current && judgingRuleChanged(current, peUpdates)) {
            peUpdates.progressionConfigAt = new Date();
          }

          // Before the transaction: the share runs a due weekly sync, which
          // rewrites this slot's sets, and the replace below must read them after.
          const share =
            args.sets !== undefined ? await periodizationShare(owner.programId, userId) : 1;

          // The slot edits and the set diff in one transaction, as one revision.
          let versions = new Map<string, number>();
          try {
            ({ versions } = await planWrite(ctx, async (w) => {
              const tx = w.tx;
              await w.touch({ type: "program", id: owner.programId }, { expectedVersion: args.expectedVersion });
              if (Object.keys(peUpdates).length > 0) {
                await tx
                  .update(programExercises)
                  .set(peUpdates)
                  .where(eq(programExercises.id, programExerciseId));
              }
              if (args.sets === undefined) return;
              // Matched by id, then by set number, and updated in place, so ids
              // stay and logged rows keep their link (docs/plans/revisions.md,
              // 2.3). The anchors and the role carry over from the matched set,
              // re-derived the way an edit in the app re-derives them (PZ-36).
              const old = await tx
                .select({
                  id: programSets.id,
                  setNumber: programSets.setNumber,
                  distanceMeters: programSets.distanceMeters,
                  durationSeconds: programSets.durationSeconds,
                  peakDistanceMeters: programSets.peakDistanceMeters,
                  peakDurationSeconds: programSets.peakDurationSeconds,
                  sessionRole: programSets.sessionRole,
                })
                .from(programSets)
                .where(and(eq(programSets.programExerciseId, programExerciseId), liveProgramSets));
              const match = matchSets(old, args.sets);
              if ("error" in match) {
                // Throw, so the slot edits above roll back with it and no
                // revision or version step is stored for a refused call.
                throw new SetListRefused(match.error);
              }
              const oldById = new Map(old.map((o) => [o.id, o]));
              for (const { id, input: s } of match.updates) {
                const row = setValues(programExerciseId, s);
                const prev = oldById.get(id)!;
                const mode =
                  row.distanceMeters != null ? "distance" : row.durationSeconds != null ? "duration" : null;
                const peaks = mode ? reanchoredPeaks(prev, row, mode, share) : null;
                // A role sent in the input wins; without one the old set's is kept.
                const sessionRole = s.sessionRole !== undefined ? row.sessionRole : prev.sessionRole;
                await tx
                  .update(programSets)
                  .set({ ...row, ...(peaks ?? {}), sessionRole })
                  .where(eq(programSets.id, id));
                if (prev.setNumber !== row.setNumber) await moveOpenSessionRows(tx, userId, id, row.setNumber);
              }
              if (match.inserts.length > 0) {
                await tx
                  .insert(programSets)
                  .values(match.inserts.map((s) => setValues(programExerciseId, s)));
              }
              if (match.deletes.length > 0) {
                await tx
                  .update(programSets)
                  .set({ deletedAt: new Date() })
                  .where(inArray(programSets.id, match.deletes));
              }
            }));
          } catch (e) {
            if (e instanceof SetListRefused) return fail(e.message);
            throw e;
          }
          return ok({ updated: true, programExerciseId, programVersion: programVersion(versions, owner.programId) });
        }

        // remove
        const { programExerciseId } = args;
        if (programExerciseId == null) {
          return fail("programExerciseId is required to remove an exercise");
        }
        const owner = await programExerciseOwner(programExerciseId);
        if (!owner || owner.userId !== userId) return fail("Exercise slot not found");
        // Soft: logged sets keep their link, and a restore brings it back.
        const { versions } = await planWrite(ctx, async (w) => {
          await w.touch({ type: "program", id: owner.programId }, { expectedVersion: args.expectedVersion });
          await softDeleteSlot(w.tx, programExerciseId);
        });
        audit("remove_program_exercise", { userId, programExerciseId });
        return ok({ removed: true, programExerciseId, programVersion: programVersion(versions, owner.programId) });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("programs", e);
      }
    },
  );
}
