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
import { LIMITS_TEXT, limitRefusal, limitSummary, overrideArgs, overrideFrom } from "@/lib/mcp/limits";
import { liveProgramExercises, liveProgramSets, livePrograms, listedPrograms } from "@/lib/plan-live";
import { deletePrograms, planWrite, softDeleteSlot, versionKey, type Tx } from "@/lib/plan-revisions";
import { matchSets } from "@/lib/utils/plan-revisions";
import { periodizationShare } from "@/lib/periodization-sync";
import { LimitRefusedError, limitContext, programLimitScope, withLimits, type LimitScope } from "@/lib/training-limits";
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
import { StepRowsError, settleStepRows } from "@/lib/program-steps-db";
import { workoutToRows } from "@/lib/utils/program-steps";
import { RIDE_TESTS, inclinePercentSchema, parseWorkout, programStepFieldsSchema, type Workout } from "@/lib/utils/workout-steps";
import { ftpTestWorkout } from "@/lib/utils/ftp-tests";
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
    inclinePercent: inclinePercentSchema.nullable().optional(),
    targetHeartRateZone: z.number().int().min(1).max(5).nullable().optional(),
    sessionRole: z.enum(["work"]).nullable().optional(),
    startDelaySeconds: z.number().int().min(0).max(60).nullable().optional(),
    restTimeSeconds: z.number().int().nonnegative().optional(),
    setType: z.enum(["working", "warmup"]).optional(),
  })
  // Endurance step fields (docs/plans/one-program-model.md); the rules across
  // steps are checked on the whole exercise after the write.
  .extend(programStepFieldsSchema.shape)
  .strict()
  .refine(repRangeIsWellFormed, { message: REP_RANGE_MESSAGE, path: ["repRangeMin"] });

type SetInput = z.infer<typeof setShape>;

/** Thrown inside the set-list transaction so a refused list writes nothing. */
class SetListRefused extends Error {}

/**
 * The refusal for a write to zone or rest on a set the weekly sync owns: a
 * "work" set with a peak anchor (docs/plans/ai-coach.md, 2.2).
 */
export const SYNC_OWNED_REFUSAL =
  "The weekly sync sets targetHeartRateZone and restTimeSeconds on this set from the block phase (it is a 'work' set with a peak anchor). To set them yourself, send sessionRole: null for this set: the sync then leaves its zone and rest alone, and still scales its distance or duration.";

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
    stepKind: s.stepKind ?? null,
    endsOnLap: s.endsOnLap ?? false,
    targets: s.targets ?? null,
    cadenceLow: s.cadenceLow ?? null,
    cadenceHigh: s.cadenceHigh ?? null,
    blockId: s.blockId ?? null,
    blockRound: s.blockRound ?? null,
    stroke: s.stroke ?? null,
    equipment: s.equipment ?? null,
    sendOffSeconds: s.sendOffSeconds ?? null,
    note: s.note ?? null,
    ramp: s.ramp ?? null,
    free: s.free ?? false,
    outdoorTarget: s.outdoorTarget ?? null,
  };
}

const NOT_TARGETS: Record<string, string> = {
  gradient: "gradient is never a target: write the climb in the step's note (for example \"climb at 6%\")",
  grade: "gradient is never a target: write the climb in the step's note (for example \"climb at 6%\")",
  speed: "speed is a result, not a target: give power, heart rate or effort",
};

/**
 * The mistakes a step tree makes most, said plainly before the schema check
 * (docs/plans/bike-ride-logger.md, D12 and 4.1): a gradient or a speed as a
 * target, and an outdoor target that tries to change how a step ends.
 */
function stepTreeHints(input: unknown): string[] {
  const out: string[] = [];
  const nodes = (input as { steps?: unknown })?.steps;
  if (!Array.isArray(nodes)) return out;
  const step = (s: unknown, path: string) => {
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, unknown>;
    for (const k of ["gradient", "grade", "climb"]) if (k in o) out.push(`${path}.${k}: ${NOT_TARGETS.gradient}`);
    for (const f of ["target", "target2", "outdoor"]) {
      const t = o[f] as Record<string, unknown> | undefined;
      if (!t || typeof t !== "object") continue;
      const hint = typeof t.metric === "string" ? NOT_TARGETS[t.metric] : undefined;
      if (hint) out.push(`${path}.${f}: ${hint}`);
      if (f === "outdoor" && "end" in t) out.push(`${path}.outdoor: an outdoor target changes only the target, never how the step ends; the step's end is the same indoors and outdoors`);
    }
  };
  nodes.forEach((n, i) => {
    if (n && typeof n === "object" && (n as { type?: unknown }).type === "repeat") {
      const inner = (n as { steps?: unknown }).steps;
      if (Array.isArray(inner)) inner.forEach((s, j) => step(s, `steps[${i}].steps[${j}]`));
    } else step(n, `steps[${i}]`);
  });
  return out;
}

/**
 * A step tree (the shape of logeverylift://docs/workout-steps) as a set list,
 * for the `workout` argument, with the tree's FTP test (stored on the slot).
 * The reasons when it fails the schema.
 */
function setsFromWorkout(input: unknown): { sets: SetInput[]; test: Workout["test"] | null } | { error: string } {
  const hints = stepTreeHints(input);
  if (hints.length) return { error: `workout: ${hints.slice(0, 5).join("; ")}` };
  const parsed = parseWorkout(input);
  if (!parsed.ok) return { error: `workout: ${parsed.errors.slice(0, 5).map((e) => `${e.path} ${e.message}`).join("; ")}` };
  return {
    test: parsed.workout.test ?? null,
    sets: workoutToRows(parsed.workout).map((r) => ({
      ...r,
      targets: (r.targets as SetInput["targets"]) ?? null,
      stroke: (r.stroke as SetInput["stroke"]) ?? null,
      equipment: (r.equipment as SetInput["equipment"]) ?? null,
      ramp: (r.ramp as SetInput["ramp"]) ?? null,
      outdoorTarget: (r.outdoorTarget as SetInput["outdoorTarget"]) ?? null,
    })),
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
          .where(and(eq(programs.userId, userId), listedPrograms))
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
        "Get one program with its ordered exercise slots and planned sets, and its version. Pass the version as expectedVersion when you change it. A step set holds its step fields as written (stepKind, targets, cadence, note, and on a bike ramp, free and outdoorTarget); a bike slot holds rideTest, the FTP test of its ride or null.",
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
        "Field owners: target reps and weight belong to the progression engine; an edit is a one-off until the next logged session (change the progression settings to change the trend). On a set with a peak anchor, distance or duration is this week's value and the peak is re-derived from it. targetHeartRateZone and restTimeSeconds on a 'work' set with a peak anchor belong to the weekly sync: a different value is refused, and an omitted one keeps the sync's value; send sessionRole: null on that set to take them over. To make a whole week lighter or harder, use manage_training_cycle operation='set_volume', not set edits.",
        "operation='update': requires programExerciseId; any provided slot fields are updated. A new exerciseId must be a built-in exercise or one of the user's own. If sets[] is provided it becomes the slot's full set list: an entry with id updates that set, an entry without id updates the set at the same setNumber, other entries are added, and stored sets that no entry names are removed. Set ids never change, so logged workouts keep their link. A set without sessionRole keeps the role it had.",
        "Endurance steps (swim, bike or run exercises only): a set with stepKind (warmup, work, recovery, cooldown, rest) is one step of a structured session. It ends on exactly one of durationSeconds, distanceMeters or endsOnLap: true. Optional targets (1-2 entries, the shape of a step target in logeverylift://docs/workout-steps; the second caps the first), cadenceLow and cadenceHigh, and for swims stroke, equipment, sendOffSeconds and poolLengthM on the slot; note is a short cue. A repeat block is one set per round: the sets of block 1 round 1, then block 1 round 2, and so on, each with blockId and blockRound, every round the same. Instead of sets[] you can send workout: a step tree with repeats, and it becomes the set list. Either every set of a slot is a step or none is. For a user with endurance features on, a bike or run slot always holds steps: plain bike and run sets are stored as steps (each set one step, its targetHeartRateZone a zone target on LTHR, its rest a rest step after it; a run set with time and distance ends on its time, or on its distance when its weekly-sync anchor is the distance alone, with that pace as a target, the second one when the set has a zone; its inclinePercent becomes the step's incline). The whole slot is checked after the write and a broken one is refused with the set numbers.",
        "Bike steps also take (in sets and in the tree): ramp {anchor ftp or absolute, from, to} in place of the target (no cap with a ramp), free: true for a spin with no target, and an outdoor target (outdoorTarget on a set, outdoor in the tree) that changes only the target on an outdoor ride, never the end; without one the app derives it. A climb, a gradient or terrain is a note on the step (note), never a target, and speed is a result, never a target. A bike tree may carry test: 'ramp' or '20min' for an FTP test ride; it is stored on the slot (get_program shows it as rideTest), a tree without test clears it, and sets[] leaves it. To write the app's own FTP test, send ftpTest: 'ramp' (10 min warm-up, then 1 min steps from 100 W up by 20 W to 500 W; the rider taps Lap when they cannot hold the watts, which ends the ride; FTP = 75% of the best 1 min power) or '20min' (20 min warm-up with two 1 min hard efforts, 5 min easy, 20 min all-out, 10 min cool-down; FTP = 95% of the all-out average) in place of sets[] or workout. Outdoors a test ride is ridden by effort, never a heart rate cap. After the ride get_ride gives the proposed FTP. Ramp, free, outdoor and test on a run or swim are refused. A ride that is running keeps the plan it started with: a program edit applies from the next ride.",
        "operation='remove': requires programExerciseId.",
        `Every operation requires reason and expectedVersion (the program's version). The result has the program's new version. ${REVISION_RULES}`,
        `On add and update: ${LIMITS_TEXT}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        ...overrideArgs,
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
        // Swim slots: pool length in metres (25 yd = 22.86).
        poolLengthM: z.number().min(10).max(100).nullable().optional(),
        // A step tree in place of sets[] (endurance slots).
        workout: z.unknown().optional(),
        // The app's FTP test template as the step tree (a bike slot).
        ftpTest: z.enum(RIDE_TESTS).optional(),
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
      const override = overrideFrom(args);
      if (typeof override === "string") return fail(override);
      // The limits' scope for a write to this program: its runs, and the
      // week of the active (or scheduled) cycle that holds it.
      const scopeFor = (programId: number): Promise<LimitScope> => programLimitScope(db, userId, programId);
      if ([args.workout, args.sets, args.ftpTest].filter((x) => x !== undefined).length > 1) return fail("send one of sets, workout or ftpTest");
      if (args.ftpTest !== undefined) args = { ...args, workout: ftpTestWorkout(args.ftpTest) };
      // A step tree also sets the slot's FTP test: its `test`, or none.
      let rideTest: { rideTest: Workout["test"] | null } | null = null;
      if (args.workout !== undefined) {
        const fromTree = setsFromWorkout(args.workout);
        if ("error" in fromTree) return fail(fromTree.error);
        args = { ...args, sets: fromTree.sets };
        rideTest = { rideTest: fromTree.test };
      }
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
          const [lc, scope] = await Promise.all([limitContext(userId), scopeFor(programId)]);
          const { result: { result: pe, check, unusedOverrides }, versions } = await planWrite(ctx, async (w) => {
            const tx = w.tx;
            await w.touch({ type: "program", id: programId }, { expectedVersion: args.expectedVersion });
            return withLimits(w, lc, scope, override, async () => {
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
                  poolLengthM: args.poolLengthM ?? null,
                  ...rideTest,
                })
                .returning();
              if (args.sets && args.sets.length > 0) {
                await tx
                  .insert(programSets)
                  .values(args.sets.map((s) => setValues(inserted.id, s)));
              }
              await settleStepRows(tx, inserted.id);
              return inserted;
            });
          });
          return ok({ ...pe, programVersion: programVersion(versions, programId), limits: limitSummary(check, unusedOverrides) });
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
          if (args.poolLengthM !== undefined) peUpdates.poolLengthM = args.poolLengthM;
          if (rideTest) peUpdates.rideTest = rideTest.rideTest;
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
          const [lc, scope] = await Promise.all([limitContext(userId), scopeFor(owner.programId)]);
          let versions = new Map<string, number>();
          let limits: ReturnType<typeof limitSummary> | null = null;
          try {
            ({ versions } = await planWrite(ctx, async (w) => {
              const tx = w.tx;
              await w.touch({ type: "program", id: owner.programId }, { expectedVersion: args.expectedVersion });
              const { check, unusedOverrides } = await withLimits(w, lc, scope, override, async () => {
                if (Object.keys(peUpdates).length > 0) {
                  await tx
                    .update(programExercises)
                    .set(peUpdates)
                    .where(eq(programExercises.id, programExerciseId));
                }
                if (args.sets === undefined) {
                  await settleStepRows(tx, programExerciseId);
                  return;
                }
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
                    targetHeartRateZone: programSets.targetHeartRateZone,
                    restTimeSeconds: programSets.restTimeSeconds,
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
                  // Zone and rest on a "work" set with a peak anchor are the
                  // weekly sync's (docs/plans/ai-coach.md, 2.2): a different value
                  // is refused, an omitted one keeps the sync's.
                  const syncOwned =
                    sessionRole === "work" && (prev.peakDistanceMeters != null || prev.peakDurationSeconds != null);
                  if (syncOwned) {
                    if (
                      (s.targetHeartRateZone !== undefined && s.targetHeartRateZone !== prev.targetHeartRateZone) ||
                      (s.restTimeSeconds !== undefined && s.restTimeSeconds !== prev.restTimeSeconds)
                    ) {
                      throw new SetListRefused(`Set ${s.setNumber}: ${SYNC_OWNED_REFUSAL}`);
                    }
                    row.targetHeartRateZone = prev.targetHeartRateZone;
                    row.restTimeSeconds = prev.restTimeSeconds;
                  }
                  await tx
                    .update(programSets)
                    // A round of a repeat block never ramps with the weekly
                    // sync: its rounds must stay the same (one-program-model, 2).
                    .set({ ...row, ...(row.blockId != null ? { peakDistanceMeters: null, peakDurationSeconds: null } : (peaks ?? {})), sessionRole })
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
                await settleStepRows(tx, programExerciseId);
              });
              limits = limitSummary(check, unusedOverrides);
            }));
          } catch (e) {
            if (e instanceof SetListRefused || e instanceof StepRowsError) return fail(e.message);
            throw e;
          }
          return ok({ updated: true, programExerciseId, programVersion: programVersion(versions, owner.programId), limits });
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
        if (e instanceof LimitRefusedError) return limitRefusal(e);
        if (e instanceof StepRowsError) return fail(e.message);
        return (await planErrorResult(userId, e)) ?? failInternal("programs", e);
      }
    },
  );
}
