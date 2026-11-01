import { db } from "@/db";
import {
  exercisePrs,
  programExercises,
  programSets,
  programs,
  workoutSets,
} from "@/db/schema";
import {
  addProgramSet,
  applyProgressionToPlan,
  exportAllPrograms,
  exportProgram,
  importProgram,
  setProgramExerciseProgression,
  updateProgramExerciseIncrement,
} from "@/lib/actions/programs";
import {
  getProgressiveSuggestions,
  getWorkoutInsight,
  logWorkoutSet,
} from "@/lib/actions/workout-sets";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The progression read and write paths against a real database: the history
 * query feeding the engine, the settings writes that stamp the config clock,
 * and the plan write the chip triggers.
 */

let userId: string;
let exerciseId: number;
let programId: number;
let slotId: number;
let setIds: number[];

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Bench Press" })).id;
  const { program, slots } = await createProgram(userId, [
    { exerciseId, sets: [{ weightKg: "80" }, { weightKg: "80" }, { weightKg: "80" }] },
  ]);
  programId = program.id;
  slotId = slots[0].programExerciseId;
  setIds = slots[0].setIds;
  await db
    .update(programExercises)
    .set({ progressionAdvance: "load", overloadIncrementKg: "2.50" })
    .where(eq(programExercises.id, slotId));
});

type LoggedSpec = { reps: number; weightKg?: string; rir?: number | null };

/**
 * A completed session for the slot, logged the way logWorkoutSet writes rows:
 * tied to its plan slot, working, with the prescribed set count snapshotted.
 */
async function logCompletedSession(date: string, sets: LoggedSpec[]) {
  const session = await createSession(userId, programId, {
    date,
    startTime: new Date(`${date}T10:00:00Z`),
    isCompleted: true,
    feeling: "Good",
  });
  await db.insert(workoutSets).values(
    sets.map((s, i) => ({
      sessionId: session.id,
      exerciseId,
      programExerciseId: slotId,
      programSetId: setIds[i],
      setNumber: i + 1,
      setType: "working",
      prescribedWorkingSets: sets.length,
      targetReps: 8,
      actualReps: s.reps,
      weightKg: s.weightKg ?? "80",
      rir: s.rir ?? null,
      restTimeSeconds: 90,
      isCompleted: true,
    })),
  );
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const allClear = (rir: number | null = null) => [8, 8, 8].map((reps) => ({ reps, rir }));

async function slot() {
  const [row] = await db.select().from(programExercises).where(eq(programExercises.id, slotId));
  return row;
}

describe("getProgressiveSuggestions", () => {
  it("advances every working set once the gate clears", async () => {
    await logCompletedSession(daysAgo(4), allClear());
    await logCompletedSession(daysAgo(2), allClear());

    const r = await getProgressiveSuggestions(programId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    for (const id of setIds) {
      expect(r.data[id]?.reason).toBe("progressed");
      expect(r.data[id]?.suggestedWeightKg).toBe(82.5);
    }
  });

  it("does not offer a missed heavy single back as a retry", async () => {
    await logCompletedSession(daysAgo(4), [{ reps: 1, weightKg: "100" }, { reps: 1, weightKg: "100" }, { reps: 1, weightKg: "100" }]);
    await logCompletedSession(daysAgo(2), allClear());

    const r = await getProgressiveSuggestions(programId);
    if (!r.success) throw new Error(r.error);
    expect(r.data[setIds[0]]?.reason).not.toBe("retry");
  });

  it("returns nothing for a program the caller does not own", async () => {
    await logCompletedSession(daysAgo(4), allClear());
    await logCompletedSession(daysAgo(2), allClear());
    asUser((await createUser()).id);

    const r = await getProgressiveSuggestions(programId);
    expect(r).toEqual({ success: true, data: {} });
  });

  it("reads the effort cap from the set the scope names (D-8)", async () => {
    // Only the last set carries a cap. Under "first" the deciding set is set 1,
    // which has none, so silence is fine. Under "all" the last set decides and
    // its cap was never answered, so the session is unknown.
    await db.update(programSets).set({ targetRir: 2 }).where(eq(programSets.id, setIds[2]));
    await logCompletedSession(daysAgo(4), allClear());
    await logCompletedSession(daysAgo(2), allClear());

    await db.update(programExercises).set({ progressionScope: "first" }).where(eq(programExercises.id, slotId));
    const first = await getProgressiveSuggestions(programId);
    expect(first.success && first.data[setIds[0]]?.reason).toBe("progressed");

    await db.update(programExercises).set({ progressionScope: "all" }).where(eq(programExercises.id, slotId));
    const all = await getProgressiveSuggestions(programId);
    expect(all.success && all.data[setIds[0]]?.reason).toBe("held-unknown");
  });

  it("holds sessions logged before a settings change inert (E-13)", async () => {
    await logCompletedSession(daysAgo(4), allClear());
    await logCompletedSession(daysAgo(2), allClear());
    await db
      .update(programExercises)
      .set({ progressionConfigAt: new Date() })
      .where(eq(programExercises.id, slotId));

    const r = await getProgressiveSuggestions(programId);
    const s = r.success ? r.data[setIds[0]] : undefined;
    expect(s?.reason).toBe("held");
    expect(s?.hitsAchieved).toBe(0);
    // Inert, not dropped: the "Last:" numbers are still there to read.
    expect(s?.basedOnWeightKg).toBe(80);
  });

  it("runs the scheme the sheet shows: a load advance on a timed exercise runs on duration", async () => {
    const plankId = (await createExercise({ name: "Plank", isTimed: true })).id;
    const { slots } = await createProgram(userId, [
      { exerciseId: plankId, sets: [{ weightKg: "0", targetReps: null, durationSeconds: 30 }] },
    ]);
    const plankSlot = slots[0].programExerciseId;
    const plankSet = slots[0].setIds[0];
    await db
      .update(programExercises)
      .set({ progressionAdvance: "load", programId })
      .where(eq(programExercises.id, plankSlot));
    for (const date of [daysAgo(4), daysAgo(2)]) {
      const session = await createSession(userId, programId, {
        date,
        startTime: new Date(`${date}T10:00:00Z`),
        isCompleted: true,
        feeling: "Good",
      });
      await db.insert(workoutSets).values({
        sessionId: session.id,
        exerciseId: plankId,
        programExerciseId: plankSlot,
        programSetId: plankSet,
        setNumber: 1,
        setType: "working",
        prescribedWorkingSets: 1,
        actualReps: 0,
        weightKg: "0",
        durationSeconds: 30,
        restTimeSeconds: 60,
        isCompleted: true,
      });
    }

    const r = await getProgressiveSuggestions(programId);
    expect(r.success && r.data[plankSet]?.reason).toBe("progressed-time");
  });
});

describe("setProgramExerciseProgression — the config stamp", () => {
  it("does not stamp when nothing changes, so re-tapping a preset keeps the dots", async () => {
    const r = await setProgramExerciseProgression({
      programExerciseId: slotId,
      advance: "load",
      scope: "all",
    });
    expect(r.success).toBe(true);
    expect((await slot()).progressionConfigAt).toBeNull();
  });

  it("does not stamp for settings that do not change how a session is judged", async () => {
    await setProgramExerciseProgression({
      programExerciseId: slotId,
      readiness: "reduce",
      regress: "hold",
      backoffPct: 15,
      backoffAfter: 2,
    });
    const row = await slot();
    expect(row.progressionReadiness).toBe("reduce");
    expect(row.progressionConfigAt).toBeNull();
  });

  it("stamps when the scope moves", async () => {
    await setProgramExerciseProgression({ programExerciseId: slotId, scope: "first" });
    expect((await slot()).progressionConfigAt).not.toBeNull();
  });
});

describe("MCP edit_program_exercise update — the config stamp", () => {
  type Handler = (args: Record<string, unknown>) => Promise<unknown>;
  function editTool(): Handler {
    let handler: Handler | undefined;
    const server = {
      registerTool(name: string, _def: unknown, fn: Handler) {
        if (name === "edit_program_exercise") handler = fn;
      },
    } as unknown as McpServer;
    registerProgramTools(server, userId);
    return handler!;
  }

  it("stamps when an agent changes how sessions are judged", async () => {
    await editTool()({ operation: "update", programExerciseId: slotId, progressionScope: "last" });
    const row = await slot();
    expect(row.progressionScope).toBe("last");
    expect(row.progressionConfigAt).not.toBeNull();
  });

  it("leaves the clock alone for an edit that is not a rule change", async () => {
    await editTool()({ operation: "update", programExerciseId: slotId, notes: "Pause at the chest" });
    expect((await slot()).progressionConfigAt).toBeNull();
  });
});

describe("applyProgressionToPlan", () => {
  const optIn = () =>
    db.update(programExercises).set({ progressionApplyToPlan: true }).where(eq(programExercises.id, slotId));
  const weightOf = async (id: number) =>
    (await db.select({ w: programSets.weightKg }).from(programSets).where(eq(programSets.id, id)))[0].w;

  it("writes nothing while the slot has not opted in", async () => {
    const r = await applyProgressionToPlan({
      programExerciseId: slotId,
      updates: [{ programSetId: setIds[0], weightKg: 82.5 }],
    });
    expect(r.success).toBe(true);
    expect(await weightOf(setIds[0])).toBe("80.00");
  });

  it("writes the accepted weight once opted in", async () => {
    await optIn();
    await applyProgressionToPlan({
      programExerciseId: slotId,
      updates: [{ programSetId: setIds[0], weightKg: 82.5 }],
    });
    expect(await weightOf(setIds[0])).toBe("82.50");
  });

  it("refuses another user's slot", async () => {
    await optIn();
    asUser((await createUser()).id);
    const r = await applyProgressionToPlan({
      programExerciseId: slotId,
      updates: [{ programSetId: setIds[0], weightKg: 200 }],
    });
    expect(r.success).toBe(false);
    expect(await weightOf(setIds[0])).toBe("80.00");
  });

  it("drops a set that belongs to another slot or is a warm-up", async () => {
    await optIn();
    await db.update(programSets).set({ setType: "warmup" }).where(eq(programSets.id, setIds[1]));
    const other = await createProgram(userId, [{ exerciseId, sets: [{ weightKg: "50" }] }]);
    const foreignSet = other.slots[0].setIds[0];

    const r = await applyProgressionToPlan({
      programExerciseId: slotId,
      updates: [
        { programSetId: setIds[1], weightKg: 99 },
        { programSetId: foreignSet, weightKg: 99 },
      ],
    });
    expect(r.success).toBe(false);
    expect(await weightOf(setIds[1])).toBe("80.00");
    expect(await weightOf(foreignSet)).toBe("50.00");
  });
});

describe("addProgramSet", () => {
  it("carries the slot's effort cap and rep range onto a new working set", async () => {
    // Under scope "all" the cap is read from the last working set, so a new
    // set without one would silently switch the cap off.
    await db
      .update(programSets)
      .set({ targetRir: 2, repRangeMin: 6, repRangeMax: 10 })
      .where(eq(programSets.programExerciseId, slotId));

    const r = await addProgramSet({
      programExerciseId: slotId,
      setNumber: 4,
      targetReps: 8,
      weightKg: 80,
      restTimeSeconds: 90,
      setType: "working",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.targetRir).toBe(2);
    expect(r.data.repRangeMin).toBe(6);
    expect(r.data.repRangeMax).toBe(10);
  });

  it("leaves a new warm-up set uncapped", async () => {
    await db.update(programSets).set({ targetRir: 2 }).where(eq(programSets.programExerciseId, slotId));
    const r = await addProgramSet({
      programExerciseId: slotId,
      setNumber: 4,
      targetReps: 8,
      weightKg: 40,
      restTimeSeconds: 60,
      setType: "warmup",
    });
    expect(r.success && r.data.targetRir).toBeNull();
  });
});

describe("estimated 1RM records need logged effort (SI-42)", () => {
  async function logOne(rir: number | undefined) {
    const session = await createSession(userId, programId);
    return logWorkoutSet({
      sessionId: session.id,
      exerciseId,
      setNumber: 1,
      programSetId: setIds[0],
      targetReps: 8,
      actualReps: 8,
      weightKg: 80,
      restTimeSeconds: 90,
      isCompleted: true,
      isFailed: false,
      wasEasy: false,
      rir,
    });
  }
  const oneRepMaxRecords = () =>
    db
      .select()
      .from(exercisePrs)
      .where(and(eq(exercisePrs.userId, userId), eq(exercisePrs.prType, "estimated_1rm")));

  it("records none from a set logged without effort", async () => {
    expect((await logOne(undefined)).success).toBe(true);
    expect(await oneRepMaxRecords()).toHaveLength(0);
  });

  it("records one from a near-max set", async () => {
    expect((await logOne(2)).success).toBe(true);
    expect(await oneRepMaxRecords()).toHaveLength(1);
  });

  it("records none from a set with plenty left in reserve", async () => {
    expect((await logOne(4)).success).toBe(true);
    expect(await oneRepMaxRecords()).toHaveLength(0);
  });
});

describe("updateProgramExerciseIncrement", () => {
  it("hands the step back to the automatic ladder with null", async () => {
    await updateProgramExerciseIncrement(slotId, 5);
    expect((await slot()).overloadIncrementKg).toBe("5.00");
    expect((await updateProgramExerciseIncrement(slotId, null)).success).toBe(true);
    expect((await slot()).overloadIncrementKg).toBeNull();
  });
});

describe("getWorkoutInsight on a low-readiness day", () => {
  async function lowReadinessDay(readinessRule: string) {
    await db
      .update(programExercises)
      .set({ progressionReadiness: readinessRule })
      .where(eq(programExercises.id, slotId));
    await logCompletedSession(daysAgo(4), allClear());
    await logCompletedSession(daysAgo(2), allClear());
    await createSession(userId, programId, { readiness: 1 });
    return getWorkoutInsight(programId, { success: true, data: null });
  }

  it("says weights are lighter only when a rule made them lighter, and that the plan is untouched", async () => {
    const insight = await lowReadinessDay("reduce");
    expect(insight.type).toBe("readiness_low");
    expect(insight.detail).toMatch(/lighter today/);
    expect(insight.detail).toMatch(/plan is unchanged/);
  });

  it("says increases are held, not that weights were reduced, under hold", async () => {
    const insight = await lowReadinessDay("hold");
    expect(insight.detail).toMatch(/No weight increases today/);
    expect(insight.detail).not.toMatch(/reduced|lighter/);
  });

  it("claims no adjustment when every exercise ignores readiness", async () => {
    const insight = await lowReadinessDay("ignore");
    expect(insight.detail).not.toMatch(/reduced|lighter|increases/);
  });
});

describe("export and import keep the effort-prompt suppression (SI-43)", () => {
  it("restores the flag on the imported copy, from either export", async () => {
    await db
      .update(programExercises)
      .set({ progressionSuppressEffortPrompt: true })
      .where(eq(programExercises.id, slotId));

    const one = await exportProgram(programId);
    const all = await exportAllPrograms();
    if (!one.success || !all.success) throw new Error("export failed");
    expect(one.data.program.exercises[0].suppressEffortPrompt).toBe(true);
    expect(all.data.programs[0].exercises[0].suppressEffortPrompt).toBe(true);

    const imported = await importProgram(one.data);
    expect(imported.success).toBe(true);
    const rows = await db
      .select({ id: programExercises.id, flag: programExercises.progressionSuppressEffortPrompt })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programs.userId, userId));
    expect(rows).toHaveLength(2);
    const copy = rows.find((r) => r.id !== slotId);
    expect(copy?.flag).toBe(true);
  });
});
