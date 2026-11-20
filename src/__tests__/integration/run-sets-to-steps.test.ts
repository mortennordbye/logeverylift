/**
 * One run model (docs/plans/run-logger.md, step 1; section 7, integration 8
 * and 9): the one-time move of plain run sets to steps, the writers that no
 * longer store a plain run set for a user with endurance features on, and a
 * share of a stepped run to a user without them.
 */
import { db } from "@/db";
import { athleteProfiles, exercises, planRevisions, programExercises, programSets, programShares, programs, trainingCycleSlots, trainingCycles, workoutSessions } from "@/db/schema";
import WorkoutExerciseSetsPage from "@/app/programs/[id]/workout/exercises/[programExerciseId]/page";
import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { setUserEndurance } from "@/lib/actions/admin";
import { copySharedProgram } from "@/lib/actions/program-shares";
import { BIKE_STEPS_REASON, RUN_STEPS_REASON, migrateBikeSetsToSteps, migrateRunSetsToSteps } from "@/lib/bike-sets-to-steps";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { restoreRevision } from "@/lib/plan-revisions";
import { createTriathlonPlan } from "@/lib/triathlon-plan";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { cycleLoad, intervalPhaseRecipe } from "@/lib/utils/periodization";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

let me: string;
let run: number;

const plainRun = [
  // Distance and time: a time end with the pace of 5 km in 25 min.
  { setType: "warmup", durationSeconds: 600, targetHeartRateZone: 1, inclinePercent: 1, restTimeSeconds: 60 },
  { durationSeconds: 1500, distanceMeters: 5000, targetHeartRateZone: 2, restTimeSeconds: 90 },
  // Distance only: a distance end, its anchor and role kept.
  { distanceMeters: 1000, targetHeartRateZone: 4, sessionRole: "work", peakDistanceMeters: 1000, restTimeSeconds: 120 },
  { durationSeconds: 300, targetHeartRateZone: 1, inclinePercent: 0.5, restTimeSeconds: 0 },
].map((s) => ({ targetReps: null, weightKg: null, ...s }));

const liveSets = (programExerciseId: number) =>
  db
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)))
    .orderBy(asc(programSets.setNumber));

const revisionsOf = (programId: number) =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "program"), eq(planRevisions.objectId, programId)))
    .orderBy(asc(planRevisions.id));

/** The plain-set shape of a row, to compare before and after. */
const plainShape = (r: typeof programSets.$inferSelect) => [
  r.id,
  r.setNumber,
  r.setType,
  r.durationSeconds,
  r.distanceMeters,
  r.inclinePercent,
  r.targetHeartRateZone,
  r.restTimeSeconds,
  r.sessionRole,
  r.peakDistanceMeters,
  r.stepKind,
  r.targets,
];

const z = (zone: number) => ({ metric: "hr", anchor: "lthr", zone });

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  asUser(me);
});

describe("migrateRunSetsToSteps", () => {
  it("moves distance only, time and distance, rest and incline once, and a second pass changes nothing", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: plainRun }]);
    const pe = slots[0].programExerciseId;
    const [warmId, , repId] = slots[0].setIds;

    expect(await migrateRunSetsToSteps()).toEqual({ moved: 1, waiting: 0, failed: 0 });
    const rows = await liveSets(pe);
    expect(rows.map((r) => [r.setNumber, r.stepKind, r.durationSeconds, r.distanceMeters, r.targets, r.inclinePercent, r.restTimeSeconds, r.targetHeartRateZone])).toEqual([
      [1, "warmup", 600, null, [z(1)], 1, 0, null],
      [2, "rest", 60, null, null, null, 0, null],
      [3, "work", 1500, null, [z(2), { metric: "pace", anchor: "absolute", low: 3.267, high: 3.4 }], null, 0, null],
      [4, "rest", 90, null, null, null, 0, null],
      [5, "work", null, 1000, [z(4)], null, 0, null],
      [6, "rest", 120, null, null, null, 0, null],
      [7, "recovery", 300, null, [z(1)], 0.5, 0, null],
    ]);
    expect(rows[0].id).toBe(warmId);
    // The rep keeps its row, its anchor and its role, so the weekly sync still owns it.
    expect(rows[4]).toMatchObject({ id: repId, sessionRole: "work", peakDistanceMeters: 1000 });
    expect((await revisionsOf(program.id)).map((r) => [r.action, r.writer, r.reason])).toEqual([
      ["baseline", "user", null],
      ["update", "sync", RUN_STEPS_REASON],
    ]);

    expect(await migrateRunSetsToSteps()).toEqual({ moved: 0, waiting: 0, failed: 0 });
    expect(await liveSets(pe)).toEqual(rows);
    expect(await revisionsOf(program.id)).toHaveLength(2);
  });

  it("a restore brings back the old sets with their incline, and a later pass leaves them", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: plainRun }]);
    const pe = slots[0].programExerciseId;
    const before = (await liveSets(pe)).map(plainShape);
    await migrateRunSetsToSteps();

    const [baseline] = await revisionsOf(program.id);
    await restoreRevision({ userId: me, writer: "user" }, baseline.id);
    expect((await liveSets(pe)).map(plainShape)).toEqual(before);

    await migrateRunSetsToSteps();
    expect((await liveSets(pe)).map(plainShape)).toEqual(before);
  });

  it("a program with a ride and a run moves both, one revision each", async () => {
    const bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
    const plain = [{ targetReps: null, weightKg: null, durationSeconds: 1800, targetHeartRateZone: 2, restTimeSeconds: 0 }];
    const { program, slots } = await createProgram(me, [
      { exerciseId: bike, sets: plain },
      { exerciseId: run, sets: plain },
    ]);
    await migrateBikeSetsToSteps();
    await migrateRunSetsToSteps();
    for (const s of slots) expect((await liveSets(s.programExerciseId)).map((r) => r.stepKind)).toEqual(["work"]);
    expect((await revisionsOf(program.id)).map((r) => r.reason)).toEqual([null, BIKE_STEPS_REASON, RUN_STEPS_REASON]);
  });

  it("leaves a user without endurance features alone, and waits while a workout runs", async () => {
    const lifter = (await createUser()).id;
    const theirs = await createProgram(lifter, [{ exerciseId: run, sets: plainRun }]);
    const before = await liveSets(theirs.slots[0].programExerciseId);
    const mine = await createProgram(me, [{ exerciseId: run, sets: plainRun }]);
    const session = await createSession(me, mine.program.id);

    expect(await migrateRunSetsToSteps()).toEqual({ moved: 0, waiting: 1, failed: 0 });
    expect(await liveSets(theirs.slots[0].programExerciseId)).toEqual(before);
    expect((await liveSets(mine.slots[0].programExerciseId)).every((r) => r.stepKind == null)).toBe(true);

    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, session.id));
    expect(await migrateRunSetsToSteps()).toEqual({ moved: 1, waiting: 0, failed: 0 });
  });

  it("runs for a user when an admin turns endurance on", async () => {
    const admin = (await createUser({ role: "admin" })).id;
    const later = (await createUser()).id;
    const { slots } = await createProgram(later, [{ exerciseId: run, sets: plainRun }]);
    asUser(admin, "admin");
    expect((await setUserEndurance({ userId: later, enabled: true })).success).toBe(true);
    expect((await liveSets(slots[0].programExerciseId))[0].stepKind).toBe("warmup");
  });

  it("the weekly sync still moves a moved zone target, and puts the phase rest on the rest step", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: plainRun }]);
    await migrateRunSetsToSteps();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: "2026-11-02", goal: "build" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 2, programId: program.id });

    await syncPeriodizedTargets(c.id, me, [{ programId: program.id }], 6, 8, "build", "intermediate");
    const recipe = intervalPhaseRecipe(cycleLoad({ goal: "build", athleteLevel: "intermediate" }, 6, 8).phase);
    const rows = await liveSets(slots[0].programExerciseId);
    const rep = rows[4];
    expect(rep.stepKind).toBe("work");
    expect(rep.targets).toEqual([z(recipe.zone)]);
    expect(rep.targetHeartRateZone).toBeNull();
    expect(rows.every((r) => r.restTimeSeconds === 0)).toBe(true);
    expect([rows[5].stepKind, rows[5].durationSeconds]).toEqual(["rest", recipe.restSeconds]);
  });
});

describe("step 1 review fixes", () => {
  const cycleFor = async (programId: number) => {
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: "2026-11-02", goal: "build" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 2, programId });
    await syncPeriodizedTargets(c.id, me, [{ programId }], 6, 8, "build", "intermediate");
  };
  const recipe = () => intervalPhaseRecipe(cycleLoad({ goal: "build", athleteLevel: "intermediate" }, 6, 8).phase);

  it("the weekly sync moves the zone of a tempo set with time and distance", async () => {
    const { program, slots } = await createProgram(me, [
      { exerciseId: run, sets: [{ targetReps: null, weightKg: null, durationSeconds: 1200, distanceMeters: 4000, targetHeartRateZone: 4, sessionRole: "work", peakDurationSeconds: 1200, restTimeSeconds: 0 }] },
    ]);
    await migrateRunSetsToSteps();
    await cycleFor(program.id);
    const [tempo] = await liveSets(slots[0].programExerciseId);
    expect((tempo.targets as { zone?: number }[])[0]).toEqual(z(recipe().zone));
  });

  it("a run slot that already held steps with a rest on a row gets a rest step the sync fills", async () => {
    const { program, slots } = await createProgram(me, [
      {
        exerciseId: run,
        sets: [
          { targetReps: null, weightKg: null, stepKind: "work", durationSeconds: 300, targets: [z(4)], sessionRole: "work", peakDurationSeconds: 300, restTimeSeconds: 120 },
          { targetReps: null, weightKg: null, stepKind: "recovery", durationSeconds: 600, targets: [z(1)], restTimeSeconds: 0 },
        ],
      },
    ]);
    await migrateRunSetsToSteps();
    await cycleFor(program.id);
    const rows = await liveSets(slots[0].programExerciseId);
    expect(rows.map((r) => [r.stepKind, r.restTimeSeconds])).toEqual([
      ["work", 0],
      ["rest", 0],
      ["recovery", 0],
    ]);
    expect(rows[1].durationSeconds).toBe(recipe().restSeconds);
  });

  it("a slot no step can hold stays plain and does not count as moved", async () => {
    const { slots } = await createProgram(me, [{ exerciseId: run, sets: [{ targetReps: null, weightKg: null, durationSeconds: 13 * 3600, restTimeSeconds: 0 }] }]);
    expect((await migrateRunSetsToSteps()).moved).toBe(0);
    expect((await migrateRunSetsToSteps()).moved).toBe(0);
    expect((await liveSets(slots[0].programExerciseId))[0].stepKind).toBeNull();
  });
});

describe("no writer stores a plain run set for an endurance user", () => {
  it("edit_program_exercise turns plain run sets into steps", async () => {
    const call = mcpTools(registerProgramTools, me);
    const [program] = await db.insert(programs).values({ userId: me, name: "Run" }).returning();
    const added = await call("edit_program_exercise", {
      operation: "add",
      programId: program.id,
      exerciseId: run,
      sets: [{ setNumber: 1, durationSeconds: 1800, targetHeartRateZone: 2, inclinePercent: 1, restTimeSeconds: 60 }, { setNumber: 2, durationSeconds: 300, targetHeartRateZone: 1, restTimeSeconds: 0 }],
      reason: "Test",
      expectedVersion: 1,
    });
    expect(added.isError, added.raw).toBe(false);
    expect((await liveSets(added.data.id as number)).map((r) => [r.stepKind, r.durationSeconds, r.inclinePercent, r.restTimeSeconds])).toEqual([
      ["work", 1800, 1, 0],
      ["rest", 60, null, 0],
      ["recovery", 300, null, 0],
    ]);
  });

  it("the triathlon plan writes its runs as steps, with the sync anchor kept", async () => {
    await db.insert(athleteProfiles).values({ userId: me, enduranceLevel: "intermediate" as const, availableDays: [1, 2, 3, 4, 7] });
    const day = (offset: number) => toDateStr(addDays(new Date(), offset));
    await createTriathlonPlan(
      { userId: me, writer: "user" },
      { name: "Half", goal: "Finish", startDate: day(9), race: { name: "Race", raceDate: day(250), distance: "half" } },
    );
    const mine = await db.select({ id: programs.id }).from(programs).where(eq(programs.userId, me));
    const runs = await db
      .select({ stepKind: programSets.stepKind, rest: programSets.restTimeSeconds, peak: programSets.peakDistanceMeters })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(and(inArray(programExercises.programId, mine.map((p) => p.id)), eq(exercises.discipline, "run"), isNull(programSets.deletedAt)));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.stepKind != null && r.rest === 0)).toBe(true);
    expect(runs.some((r) => r.peak != null)).toBe(true);
  });

  it("the step editor's save over plain sets carries no rest on a run step", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: plainRun }]);
    // A workout keeps the slot plain, as on a screen opened before the move.
    await createSession(me, program.id);
    const { saveExerciseSteps } = await import("@/lib/actions/program-steps");
    const res = await saveExerciseSteps({
      programExerciseId: slots[0].programExerciseId,
      workout: { v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 } }, { type: "work", end: { type: "time", seconds: 600 } }] },
    });
    expect(res.success, !res.success ? res.error : "").toBe(true);
    expect((await liveSets(slots[0].programExerciseId)).map((r) => r.restTimeSeconds)).toEqual([0, 0]);
  });
});

/** The props of the first element of `type` in a rendered tree. */
function propsOf<P>(tree: ReactNode, type: unknown): P | null {
  if (Array.isArray(tree)) {
    for (const t of tree) {
      const found = propsOf<P>(t, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(tree)) return null;
  if (tree.type === type) return tree.props as P;
  return propsOf<P>((tree.props as { children?: ReactNode }).children, type);
}

describe("a share of a stepped run to a user without endurance features", () => {
  it("keeps the steps, and today's run screen shows each step row with its label", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: run, sets: plainRun }]);
    await migrateRunSetsToSteps();
    const stepped = await liveSets(slots[0].programExerciseId);

    const friend = (await createUser()).id;
    const [share] = await db.insert(programShares).values({ programId: program.id, sharedByUserId: me, sharedWithUserId: friend }).returning();
    asUser(friend);
    const copied = await copySharedProgram({ shareId: share.id });
    expect(copied.success, !copied.success ? copied.error : "").toBe(true);
    if (!copied.success) return;

    const [pe] = await db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.programId, copied.data.programId));
    const theirs = await liveSets(pe.id);
    const shape = (r: typeof programSets.$inferSelect) => [r.setNumber, r.stepKind, r.durationSeconds, r.distanceMeters, r.targets, r.inclinePercent, r.restTimeSeconds];
    expect(theirs.map(shape)).toEqual(stepped.map(shape));

    // Not the run screen of an endurance user: today's set list, a label per step row.
    const tree = await WorkoutExerciseSetsPage({ params: Promise.resolve({ id: String(copied.data.programId), programExerciseId: String(pe.id) }), searchParams: Promise.resolve({}) });
    const props = propsOf<{ sets: { id: number }[]; stepLabels: Record<number, { title: string; target: string | null }> | null; exerciseDiscipline: string }>(tree, WorkoutSetsClient);
    expect(props?.exerciseDiscipline).toBe("run");
    expect(props?.sets.map((s) => s.id)).toEqual(theirs.map((r) => r.id));
    expect(theirs.map((r) => props?.stepLabels?.[r.id]?.title)).toEqual(["Warm-up", "Rest", "Work", "Rest", "Work", "Rest", "Easy"]);
  });
});
