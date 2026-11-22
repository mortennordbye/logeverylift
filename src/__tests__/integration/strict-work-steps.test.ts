/**
 * Strict work steps (docs/plans/strict-targets.md, decisions 2 and 3): MCP
 * edit_program_exercise and the step editor's save refuse a new bike or run
 * work step without its targets. An old program without them still loads,
 * copies and takes a small edit.
 */
import { db } from "@/db";
import { programExercises, programSets, programShares } from "@/db/schema";
import { saveExerciseSteps } from "@/lib/actions/program-steps";
import { copySharedProgram } from "@/lib/actions/program-shares";
import { exportProgram, importProgram } from "@/lib/actions/programs";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import type { Workout } from "@/lib/utils/workout-steps";
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const time = (seconds: number) => ({ type: "time" as const, seconds });
const POWER = { metric: "power", anchor: "ftp", low: 88, high: 93 } as const;
const HR = { metric: "hr", anchor: "lthr", zone: 3 } as const;

/** A ride as an old program holds it: work steps with power alone, a rest between them. */
const oldRide: Workout = {
  v: 2,
  sport: "bike",
  name: "Old ride",
  steps: [
    { type: "warmup", end: time(600), target: { metric: "power", anchor: "ftp", zone: 1 } },
    { type: "work", end: time(600), target: POWER },
    { type: "rest", end: time(120) },
    { type: "work", end: time(600), target: POWER },
  ],
};

const liveSets = (programExerciseId: number) =>
  db
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber));

let me: string;
let bike: number;
let run: number;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  asUser(me);
});

describe("edit_program_exercise refuses a new work step without its targets", () => {
  it("a bike tree with power alone is refused with the set and what it lacks, and writes nothing", async () => {
    const { program } = await createProgram(me, []);
    const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", {
      operation: "add",
      programId: program.id,
      exerciseId: bike,
      workout: { v: 2, sport: "bike", name: "Ride", steps: [{ type: "warmup", end: time(600), free: true }, { type: "work", end: time(600), target: POWER }] },
      reason: "Test",
      expectedVersion: 1,
    });
    expect(r.isError).toBe(true);
    expect(r.raw).toContain("Set 2 · A bike work step needs power, heart rate and cadence, missing heart rate and cadence");
    expect(await db.select().from(programExercises).where(eq(programExercises.programId, program.id))).toHaveLength(0);
  });

  it("a run set list without the belt is refused; with belt, heart rate and cadence it is stored", async () => {
    const { program } = await createProgram(me, []);
    const call = mcpTools(registerProgramTools, me);
    const sets = [{ setNumber: 1, stepKind: "work", durationSeconds: 1200, targets: [HR], cadenceLow: 166, cadenceHigh: 176 }];
    const refused = await call("edit_program_exercise", { operation: "add", programId: program.id, exerciseId: run, sets, reason: "Test", expectedVersion: 1 });
    expect(refused.isError).toBe(true);
    expect(refused.raw).toContain("Set 1 · A run work step needs belt speed, heart rate and cadence, missing belt speed");

    const added = await call("edit_program_exercise", { operation: "add", programId: program.id, exerciseId: run, sets: [{ ...sets[0], beltKmh: 9.5 }], reason: "Test", expectedVersion: 1 });
    expect(added.isError, added.raw).toBe(false);
    expect((await liveSets(added.data.id)).map((s) => [s.stepKind, s.beltKmh, s.cadenceLow])).toEqual([["work", 9.5, 166]]);
  });

  it("a full bike tree, a ramp, a free spin and the app's test templates pass", async () => {
    const { program } = await createProgram(me, []);
    const call = mcpTools(registerProgramTools, me);
    const full = await call("edit_program_exercise", {
      operation: "add",
      programId: program.id,
      exerciseId: bike,
      workout: {
        v: 2,
        sport: "bike",
        name: "Ride",
        steps: [
          { type: "work", end: time(600), ramp: { anchor: "ftp", from: 50, to: 75 } },
          { type: "work", end: time(600), target: HR, target2: POWER, cadence: { low: 85, high: 95 } },
          { type: "work", end: time(300), free: true },
        ],
      },
      reason: "Test",
      expectedVersion: 1,
    });
    expect(full.isError, full.raw).toBe(false);
    const ftp = await call("edit_program_exercise", { operation: "update", programExerciseId: full.data.id, ftpTest: "20min", reason: "Test", expectedVersion: full.data.programVersion });
    expect(ftp.isError, ftp.raw).toBe(false);

    const runSlot = await createStepProgram(me, run, { v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: time(600) }] });
    const runTest = await call("edit_program_exercise", { operation: "update", programExerciseId: runSlot.slots[0].programExerciseId, runTest: "treadmill", reason: "Test", expectedVersion: 1 });
    expect(runTest.isError, runTest.raw).toBe(false);
  });
});

describe("an old program without the targets", () => {
  it("still loads and reads back the same steps", async () => {
    const { program, slots } = await createStepProgram(me, bike, oldRide);
    const got = await mcpTools(registerProgramTools, me)("get_program", { programId: program.id });
    expect(got.isError, got.raw).toBe(false);
    const built = buildWorkout((await liveSets(slots[0].programExerciseId)) as StepRow[], { sport: "bike", name: "Old ride" });
    expect("workout" in built && built.workout.steps.map((s) => s.type)).toEqual(["warmup", "work", "rest", "work"]);
  });

  it("still copies: export and import, and a share", async () => {
    const { program, slots } = await createStepProgram(me, bike, oldRide);
    const exported = await exportProgram(program.id);
    expect(exported.success).toBe(true);
    if (!exported.success) return;
    const imported = await importProgram(exported.data);
    expect(imported.success, !imported.success ? imported.error : "").toBe(true);

    const friend = (await createUser({ enduranceEnabled: true })).id;
    const [share] = await db.insert(programShares).values({ programId: program.id, sharedByUserId: me, sharedWithUserId: friend }).returning();
    asUser(friend);
    const copied = await copySharedProgram({ shareId: share.id });
    expect(copied.success, !copied.success ? copied.error : "").toBe(true);
    if (!copied.success) return;
    const [slot] = await db.select().from(programExercises).where(eq(programExercises.programId, copied.data.programId));
    const pick = (r: typeof programSets.$inferSelect) => [r.setNumber, r.stepKind, r.durationSeconds, r.targets];
    expect((await liveSets(slot.id)).map(pick)).toEqual((await liveSets(slots[0].programExerciseId)).map(pick));
  });

  it("takes a rest-only edit over MCP, and refuses a changed target", async () => {
    const { program, slots } = await createStepProgram(me, bike, oldRide);
    const pe = slots[0].programExerciseId;
    const call = mcpTools(registerProgramTools, me);
    const rows = await liveSets(pe);
    // The set list as get_program gives it back, with a longer rest step.
    const sets = rows.map((r) => ({ id: r.id, setNumber: r.setNumber, stepKind: r.stepKind, durationSeconds: r.stepKind === "rest" ? 180 : r.durationSeconds, targets: r.targets }));
    const rest = await call("edit_program_exercise", { operation: "update", programExerciseId: pe, sets, reason: "Longer rest", expectedVersion: program.version });
    expect(rest.isError, rest.raw).toBe(false);
    expect((await liveSets(pe)).map((r) => r.durationSeconds)).toEqual([600, 600, 180, 600]);

    const changed = sets.map((s) => (s.setNumber === 4 ? { ...s, targets: [{ ...POWER, low: 90 }] } : s));
    const refused = await call("edit_program_exercise", { operation: "update", programExerciseId: pe, sets: changed, reason: "Harder", expectedVersion: rest.data.programVersion });
    expect(refused.isError).toBe(true);
    expect(refused.raw).toContain("Set 4 · A bike work step needs power, heart rate and cadence, missing heart rate and cadence");
    expect((await liveSets(pe)).map((r) => r.targets)).toEqual(rows.map((r) => r.targets));
  });

  it("takes a longer step from the step editor, and refuses a new work step without its targets", async () => {
    const { slots } = await createStepProgram(me, bike, oldRide);
    const pe = slots[0].programExerciseId;
    const longer: Workout = { ...oldRide, steps: oldRide.steps.map((s, i) => (i === 1 && s.type !== "repeat" ? { ...s, end: time(900) } : s)) };
    const ok = await saveExerciseSteps({ programExerciseId: pe, workout: longer });
    expect(ok.success, !ok.success ? ok.error : "").toBe(true);
    expect((await liveSets(pe))[1].durationSeconds).toBe(900);

    const added: Workout = { ...longer, steps: [...longer.steps, { type: "work", end: time(300), target: { metric: "power", anchor: "ftp", zone: 4 } }] };
    const refused = await saveExerciseSteps({ programExerciseId: pe, workout: added });
    expect(refused.success).toBe(false);
    expect(!refused.success && refused.error).toBe("Set 5 · A bike work step needs power, heart rate and cadence, missing heart rate and cadence");
    expect(await liveSets(pe)).toHaveLength(4);
  });
});
