/**
 * The bike step fields (docs/plans/bike-ride-logger.md, step 0) through the
 * readers that touch the database: the assistant's program tool, the step
 * labels and totals of the workout screen, the weekly sync and the training
 * limits.
 */
import { db } from "@/db";
import { athleteThresholds, planRevisions, programExercises, programSets, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { startDueScheduledCycle } from "@/lib/plan-revisions";
import { programStepsView, stepLabels } from "@/lib/program-steps-view";
import { bikeExerciseView } from "@/lib/bike-exercise-view";
import { rideLengthText } from "@/lib/utils/bike-ride-view";
import { loadText } from "@/lib/utils/format";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const OUTDOOR = { metric: "hr", anchor: "lthr", low: 81, high: 89 };
const ride = {
  v: 2,
  sport: "bike",
  name: "Over-unders",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 }, outdoor: { metric: "rpe", anchor: "absolute", low: 3, high: 4 } },
    { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "power", anchor: "ftp", zone: 3 }, outdoor: OUTDOOR },
    { type: "work", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 95, to: 105 } },
    { type: "recovery", end: { type: "time", seconds: 300 }, free: true },
  ],
};

let me: string;
let bike: number;

const liveSets = (programExerciseId: number) =>
  db.select().from(programSets).where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt))).orderBy(asc(programSets.setNumber));

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
  asUser(me);
});

describe("edit_program_exercise", () => {
  it("stores a workout with ramp, free and outdoor targets, and get_program reads them back", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { program } = await createStepProgram(me, bike, { ...ride, steps: [ride.steps[3]] });
    // The work step with the heart rate and cadence the strict check needs (docs/plans/strict-targets.md, decision 2).
    const full = { ...ride, steps: ride.steps.map((s, i) => (i === 1 ? { ...s, target2: { metric: "hr", anchor: "lthr", zone: 3 }, cadence: { low: 85, high: 95 } } : s)) };
    const added = await call("edit_program_exercise", { operation: "add", programId: program.id, exerciseId: bike, workout: full, reason: "Test", expectedVersion: 1 });
    expect(added.isError, added.raw).toBe(false);
    const got = await call("get_program", { programId: program.id });
    const sets = got.data.programExercises[1].programSets;
    expect(sets.map((s: Record<string, unknown>) => [s.ramp, s.free, s.outdoorTarget])).toEqual([
      [{ anchor: "ftp", from: 50, to: 70 }, false, { metric: "rpe", anchor: "absolute", low: 3, high: 4 }],
      [null, false, OUTDOOR],
      [{ anchor: "ftp", from: 95, to: 105 }, false, null],
      [null, true, null],
    ]);
  });

  it("set lists carry the fields too, and a ramp on a run is refused with the set", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { program, slots } = await createStepProgram(me, bike, ride);
    const rows = await liveSets(slots[0].programExerciseId);
    const sets = rows.map((r) => ({ id: r.id, setNumber: r.setNumber, stepKind: r.stepKind, durationSeconds: r.durationSeconds, targets: r.targets, ramp: r.ramp, free: r.free, outdoorTarget: r.outdoorTarget }));
    sets[2] = { ...sets[2], ramp: { anchor: "ftp", from: 100, to: 110 } };
    const res = await call("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, sets, reason: "Test", expectedVersion: 1 });
    expect(res.isError, res.raw).toBe(false);
    expect((await liveSets(slots[0].programExerciseId))[2].ramp).toEqual({ anchor: "ftp", from: 100, to: 110 });

    const run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
    const refused = await call("edit_program_exercise", {
      operation: "add",
      programId: program.id,
      exerciseId: run,
      sets: [{ setNumber: 1, stepKind: "work", endsOnLap: true, ramp: { anchor: "ftp", from: 50, to: 70 } }],
      reason: "Test",
      expectedVersion: 2,
    });
    expect(refused.isError).toBe(true);
    expect(refused.raw).toMatch(/Set 1: ramp ramp is only for bike steps/);
  });
});

describe("the workout screen", () => {
  it("labels a ramp step in watts and leaves the outdoor target out", async () => {
    const { slots } = await createStepProgram(me, bike, ride);
    const labels = await stepLabels(me, slots[0].programExerciseId);
    expect(Object.values(labels!).map((l) => [l.title, l.target])).toEqual([
      ["Warm-up", "100 to 140 W"],
      ["Work", "150-178 W"],
      ["Work", "190 to 210 W"],
      ["Easy", null],
    ]);
  });

  it("sums the planned time and load with the ramps at their midpoints", async () => {
    const { program } = await createStepProgram(me, bike, ride);
    const view = await programStepsView(me, program.id);
    expect(view?.summaries.values().next().value).toBe("10 min warm-up ramp 50 to 70% FTP · 20 min Z3 power · 15 min ramp 95 to 105% FTP · 5 min easy free");
    // 10 min at 0.60, 20 min at Z3's 0.82, 15 min at 1.00, and the free 5 min at the easy default.
    // The same numbers as the bike screen (one source, plannedRideNumbers).
    const sets = await liveSets((await db.select().from(programExercises).where(eq(programExercises.programId, program.id)))[0].id);
    const bikeView = await bikeExerciseView(me, sets[0].programExerciseId, "Bike", sets as never);
    const n = bikeView!.indoor.numbers;
    expect(view?.guided.totals).toBe([rideLengthText(n), n.load.load > 0 ? loadText(n.load) : null].filter(Boolean).join(" · "));
  });

  it("a repeat's dropped last recovery is not in the planned time, as on the bike screen", async () => {
    const tempo = {
      v: 2,
      sport: "bike",
      name: "Tempo",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 55, high: 75 } },
        {
          type: "repeat",
          count: 2,
          steps: [
            { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } },
            { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
          ],
        },
        { type: "cooldown", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
      ],
    };
    const { program, slots } = await createStepProgram(me, bike, tempo);
    const view = await programStepsView(me, program.id);
    const sets = await liveSets(slots[0].programExerciseId);
    const n = (await bikeExerciseView(me, slots[0].programExerciseId, "Bike", sets as never))!.indoor.numbers;
    expect(n.seconds).toBe(65 * 60);
    expect(view?.guided.totals).toBe(`65 min · ${loadText(n.load)}`);
  });
});

describe("the weekly sync", () => {
  it("moves a zone target and leaves ramps, free steps and outdoor targets alone", async () => {
    const { program, slots } = await createStepProgram(me, bike, ride);
    const pe = slots[0].programExerciseId;
    for (const r of await liveSets(pe)) await db.update(programSets).set({ sessionRole: "work", peakDurationSeconds: r.durationSeconds }).where(eq(programSets.id, r.id));
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: "2026-11-02", goal: "build" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 2, programId: program.id });
    const before = await liveSets(pe);

    await syncPeriodizedTargets(c.id, me, [{ programId: program.id }], 6, 8, "build", "intermediate");
    const after = await liveSets(pe);
    for (const [i, r] of after.entries()) {
      expect([r.ramp, r.free, r.outdoorTarget, r.targetHeartRateZone]).toEqual([before[i].ramp, before[i].free, before[i].outdoorTarget, null]);
    }
    expect((after[1].targets as { zone: number }[])[0].zone).not.toBe(3);
    expect([after[0].targets, after[2].targets, after[3].targets]).toEqual([null, null, null]);
  });
});

describe("training limits", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  async function scheduled(workouts: unknown[]) {
    const ids: number[] = [];
    for (const w of workouts) ids.push((await createStepProgram(me, bike, w)).program.id);
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Block", durationWeeks: 4, status: "draft", scheduledStartDate: "2026-11-05" })
      .returning();
    await db.insert(trainingCycleSlots).values(ids.map((programId, i) => ({ trainingCycleId: c.id, dayOfWeek: i + 1, programId })));
    await startDueScheduledCycle(me);
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, c.id))).orderBy(desc(planRevisions.id)).limit(1);
    return rev.limitCheck as { warnings?: { rule: string }[] } | null;
  }
  const one = (step: unknown) => ({ v: 2, sport: "bike", name: "Ride", steps: [step] });
  const hardRamp = one({ type: "work", end: { type: "time", seconds: 1200 }, ramp: { anchor: "ftp", from: 95, to: 105 } });
  const freeHardOutdoor = one({ type: "work", end: { type: "time", seconds: 1200 }, free: true, outdoor: { metric: "hr", anchor: "lthr", zone: 5 } });

  it("counts a work ramp from threshold as a hard session", async () => {
    const check = await scheduled([hardRamp, hardRamp, hardRamp, hardRamp]);
    expect(check?.warnings).toEqual([expect.objectContaining({ rule: "hard_sessions_per_week" })]);
  });

  it("does not count a free step with a hard outdoor target", async () => {
    const check = await scheduled([hardRamp, hardRamp, hardRamp, freeHardOutdoor]);
    expect(check?.warnings ?? []).toEqual([]);
  });
});
