/**
 * The assistant's tools for runs (docs/plans/run-logger.md, step 5):
 * edit_program_exercise writes belt, incline, outdoor and the run test;
 * get_ride reads a run from run mode with the numbers of 4.9 that need no
 * stream; log_step_results and get_step_results carry belt values and their
 * sources. Clock: Fri 2026-11-20 17:00 UTC.
 */
import { db } from "@/db";
import { athleteThresholds, programSets } from "@/db/schema";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const T0 = new Date("2026-11-20T17:00:00Z");
let me: string;
let bike: number;
let run: number;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  await db.insert(athleteThresholds).values([
    { userId: me, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: "2026-11-01", source: "manual" },
    { userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" },
  ]);
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("edit_program_exercise with run steps", () => {
  it("writes belt, incline, an outdoor target and the run test from a tree, and get_program reads them back", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { program, slots } = await createStepProgram(me, run, { v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const outdoor = { metric: "hr", anchor: "lthr", low: 85, high: 89 };
    const test = {
      v: 2,
      sport: "run",
      name: "30 min test",
      test: "30min",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 900 }, belt: 8.5, incline: 1, note: "3 x 1 min pickups" },
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "rpe", anchor: "absolute", low: 10, high: 10 }, belt: 10, incline: 1.5, outdoor },
        { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "rpe", anchor: "absolute", low: 10, high: 10 }, belt: 10.5, incline: 1.5 },
      ],
    };
    const r = await call("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, workout: test, reason: "Run test", expectedVersion: 1 });
    expect(r.isError, r.raw).toBe(false);

    const got = (await call("get_program", { programId: program.id })).data.programExercises[0];
    expect(got.rideTest).toBe("30min");
    expect(got.programSets.map((s: Record<string, unknown>) => [s.beltKmh, s.inclinePercent, s.outdoorTarget, s.note])).toEqual([
      [8.5, 1, null, "3 x 1 min pickups"],
      [10, 1.5, outdoor, null],
      [10.5, 1.5, null, null],
    ]);
  });

  it("writes belt and incline from a set list, and refuses them on a bike and a ramp or free spin on a run", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { slots } = await createStepProgram(me, run, { v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const r = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      sets: [
        { setNumber: 1, stepKind: "work", durationSeconds: 30, beltKmh: 13, inclinePercent: 0.5 },
        { setNumber: 2, stepKind: "recovery", durationSeconds: 90, beltKmh: 7 },
      ],
      reason: "Strides",
      expectedVersion: 1,
    });
    expect(r.isError, r.raw).toBe(false);
    const stored = await db.select().from(programSets).where(eq(programSets.programExerciseId, slots[0].programExerciseId));
    expect(stored.filter((s) => s.deletedAt === null).sort((a, b) => a.setNumber - b.setNumber).map((s) => [s.beltKmh, s.inclinePercent])).toEqual([
      [13, 0.5],
      [7, null],
    ]);

    const b = await createStepProgram(me, bike, { v: 2, sport: "bike", name: "Spin", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const onBike = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: b.slots[0].programExerciseId,
      workout: { v: 2, sport: "bike", name: "Spin", steps: [{ type: "work", end: { type: "time", seconds: 600 }, belt: 9 }] },
      reason: "Spin",
      expectedVersion: 1,
    });
    expect(onBike.isError).toBe(true);
    expect(onBike.raw).toMatch(/belt is only for run steps/);
    const ramp = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: slots[0].programExerciseId,
      workout: { v: 2, sport: "run", name: "Ramp", steps: [{ type: "work", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 } }] },
      reason: "Ramp",
      expectedVersion: 2,
    });
    expect(ramp.isError).toBe(true);
    expect(ramp.raw).toMatch(/ramp is only for bike steps/);
  });
});
