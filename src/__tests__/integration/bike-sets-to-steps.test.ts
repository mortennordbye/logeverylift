/**
 * One ride model (docs/plans/bike-ride-logger.md, step 1, D3): the one-time
 * move of plain bike sets to steps, and the writers that can no longer store a
 * plain bike set for a user with endurance features on.
 */
import { db } from "@/db";
import { athleteProfiles, exercises, planRevisions, programExercises, programSets, programShares, programs, trainingCycleSlots, trainingCycles, workoutSessions } from "@/db/schema";
import { addProgramSet, exportProgram, importProgram, reorderProgramSets, updateProgramSet } from "@/lib/actions/programs";
import { copySharedProgram } from "@/lib/actions/program-shares";
import { setUserEndurance } from "@/lib/actions/admin";
import { BIKE_STEPS_REASON, migrateBikeSetsToSteps } from "@/lib/bike-sets-to-steps";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { restoreRevision } from "@/lib/plan-revisions";
import { createTriathlonPlan } from "@/lib/triathlon-plan";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { cycleLoad, intervalPhaseRecipe } from "@/lib/utils/periodization";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

let me: string;
let bike: number;

const plainRide = [
  { setType: "warmup", durationSeconds: 600, targetHeartRateZone: 1, restTimeSeconds: 60 },
  { durationSeconds: 900, targetHeartRateZone: 3, sessionRole: "work", peakDurationSeconds: 900, restTimeSeconds: 120 },
  { durationSeconds: 300, targetHeartRateZone: 1, restTimeSeconds: 0 },
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
  r.targetHeartRateZone,
  r.restTimeSeconds,
  r.sessionRole,
  r.peakDurationSeconds,
  r.stepKind,
  r.targets,
];

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  asUser(me);
});

describe("migrateBikeSetsToSteps", () => {
  it("turns plain bike sets into steps once, with one sync revision, and a second run changes nothing", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const pe = slots[0].programExerciseId;
    const [, workId] = slots[0].setIds;

    await migrateBikeSetsToSteps();
    const rows = await liveSets(pe);
    expect(rows.map((r) => [r.setNumber, r.stepKind, r.durationSeconds, r.targets, r.restTimeSeconds, r.targetHeartRateZone])).toEqual([
      [1, "warmup", 600, [{ metric: "hr", anchor: "lthr", zone: 1 }], 0, null],
      [2, "rest", 60, null, 0, null],
      [3, "work", 900, [{ metric: "hr", anchor: "lthr", zone: 3 }], 0, null],
      [4, "rest", 120, null, 0, null],
      [5, "recovery", 300, [{ metric: "hr", anchor: "lthr", zone: 1 }], 0, null],
    ]);
    // The work set keeps its row, its anchor and its role, so the weekly sync still owns it.
    expect(rows[2]).toMatchObject({ id: workId, sessionRole: "work", peakDurationSeconds: 900 });
    const revs = await revisionsOf(program.id);
    expect(revs.map((r) => [r.action, r.writer, r.reason])).toEqual([
      ["baseline", "user", null],
      ["update", "sync", BIKE_STEPS_REASON],
    ]);

    const again = await migrateBikeSetsToSteps();
    expect(again).toEqual({ moved: 0, waiting: 0, failed: 0 });
    expect(await liveSets(pe)).toEqual(rows);
    expect(await revisionsOf(program.id)).toHaveLength(2);
  });

  it("a restore brings back the old sets, and a later run leaves them", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const pe = slots[0].programExerciseId;
    const before = (await liveSets(pe)).map(plainShape);
    await migrateBikeSetsToSteps();

    const [baseline] = await revisionsOf(program.id);
    await restoreRevision({ userId: me, writer: "user" }, baseline.id);
    expect((await liveSets(pe)).map(plainShape)).toEqual(before);

    await migrateBikeSetsToSteps();
    expect((await liveSets(pe)).map(plainShape)).toEqual(before);
  });

  it("leaves a user without endurance features, and run and strength exercises, alone", async () => {
    const lifter = (await createUser()).id;
    const theirs = await createProgram(lifter, [{ exerciseId: bike, sets: plainRide }]);
    const run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
    const squat = (await createExercise()).id;
    const mine = await createProgram(me, [
      { exerciseId: run, sets: [{ targetReps: null, weightKg: null, durationSeconds: 1200, targetHeartRateZone: 2 }] },
      { exerciseId: squat, sets: [{}] },
    ]);
    const snapshot = async () => [
      ...(await liveSets(theirs.slots[0].programExerciseId)),
      ...(await liveSets(mine.slots[0].programExerciseId)),
      ...(await liveSets(mine.slots[1].programExerciseId)),
    ];
    const before = await snapshot();

    expect(await migrateBikeSetsToSteps()).toEqual({ moved: 0, waiting: 0, failed: 0 });
    expect(await snapshot()).toEqual(before);
    expect(await revisionsOf(theirs.program.id)).toEqual([]);
  });

  it("waits while a workout is in progress on the program", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const session = await createSession(me, program.id);
    expect(await migrateBikeSetsToSteps()).toEqual({ moved: 0, waiting: 1, failed: 0 });
    expect((await liveSets(slots[0].programExerciseId)).every((r) => r.stepKind == null)).toBe(true);

    // A write during the workout leaves the slot plain too: one policy.
    const res = await updateProgramSet({ id: slots[0].setIds[2], durationSeconds: 360 });
    expect(res.success).toBe(true);
    expect((await liveSets(slots[0].programExerciseId)).every((r) => r.stepKind == null)).toBe(true);

    await db.update(workoutSessions).set({ isCompleted: true }).where(eq(workoutSessions.id, session.id));
    expect(await migrateBikeSetsToSteps()).toEqual({ moved: 1, waiting: 0, failed: 0 });
  });

  it("an abandoned workout older than 10 hours does not hold the move back", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    await createSession(me, program.id, { startTime: new Date(Date.now() - 11 * 3600 * 1000) });
    expect(await migrateBikeSetsToSteps()).toEqual({ moved: 1, waiting: 0, failed: 0 });
    expect((await liveSets(slots[0].programExerciseId))[0].stepKind).toBe("warmup");
  });

  it("a set with time and distance keeps the anchor it ramps on, and its role", async () => {
    const { slots } = await createProgram(me, [
      { exerciseId: bike, sets: [{ targetReps: null, weightKg: null, durationSeconds: 3600, distanceMeters: 30000, sessionRole: "work", peakDurationSeconds: 3600, restTimeSeconds: 0 }] },
    ]);
    await migrateBikeSetsToSteps();
    const [row] = await liveSets(slots[0].programExerciseId);
    expect([row.stepKind, row.durationSeconds, row.distanceMeters, row.peakDurationSeconds, row.sessionRole]).toEqual(["work", 3600, null, 3600, "work"]);
  });

  it("clamps a set under the step minimum, and leaves a slot no step can hold plain without failing", async () => {
    const short = await createProgram(me, [{ exerciseId: bike, sets: [{ targetReps: null, weightKg: null, durationSeconds: 3, restTimeSeconds: 0 }] }]);
    const long = await createProgram(me, [{ exerciseId: bike, sets: [{ targetReps: null, weightKg: null, durationSeconds: 13 * 3600, restTimeSeconds: 0 }] }]);
    expect((await migrateBikeSetsToSteps()).failed).toBe(0);
    expect((await liveSets(short.slots[0].programExerciseId)).map((r) => [r.stepKind, r.durationSeconds])).toEqual([["work", 5]]);
    expect((await liveSets(long.slots[0].programExerciseId))[0].stepKind).toBeNull();
    // A later write to that slot still works and keeps it plain.
    const res = await updateProgramSet({ id: long.slots[0].setIds[0], durationSeconds: 13 * 3600 + 60 });
    expect(res.success, !res.success ? res.error : "").toBe(true);
    expect((await liveSets(long.slots[0].programExerciseId))[0].stepKind).toBeNull();
  });

  it("a rest edit on a moved slot lands on the rest step after the set, never on the set", async () => {
    const { slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const pe = slots[0].programExerciseId;
    await migrateBikeSetsToSteps();
    const [warm, , work, , cool] = await liveSets(pe);

    const edited = await updateProgramSet({ id: work.id, restTimeSeconds: 90 });
    expect(edited.success).toBe(true);
    // The last set had no rest step: one is added after it.
    expect((await updateProgramSet({ id: cool.id, restTimeSeconds: 45 })).success).toBe(true);
    const rows = await liveSets(pe);
    expect(rows.map((r) => [r.setNumber, r.stepKind, r.durationSeconds, r.restTimeSeconds])).toEqual([
      [1, "warmup", 600, 0],
      [2, "rest", 60, 0],
      [3, "work", 900, 0],
      [4, "rest", 90, 0],
      [5, "recovery", 300, 0],
      [6, "rest", 45, 0],
    ]);
    expect(rows[0].id).toBe(warm.id);
  });

  it("a drag on a plain slot that moves it, then the screen's rest writes, leaves no rest on a step", async () => {
    const { slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const pe = slots[0].programExerciseId;
    const [a, b, c] = slots[0].setIds;
    // The screen still shows plain sets: it sends the new order, then the rests it moved.
    expect((await reorderProgramSets(pe, [b, a, c])).success).toBe(true);
    expect((await updateProgramSet({ id: b, restTimeSeconds: 30 })).success).toBe(true);
    const rows = await liveSets(pe);
    expect(rows.every((r) => r.stepKind != null && r.restTimeSeconds === 0)).toBe(true);
    const after = rows.findIndex((r) => r.id === b);
    expect([rows[after + 1].stepKind, rows[after + 1].durationSeconds]).toEqual(["rest", 30]);
  });

  it("the step editor's save over plain sets carries no rest on a bike step", async () => {
    const { slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const pe = slots[0].programExerciseId;
    // A workout keeps the slot plain, as on a screen opened before the move.
    await createSession(me, (await db.select({ id: programExercises.programId }).from(programExercises).where(eq(programExercises.id, pe)))[0].id);
    const { saveExerciseSteps } = await import("@/lib/actions/program-steps");
    const res = await saveExerciseSteps({
      programExerciseId: pe,
      workout: { v: 2, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 600 } }, { type: "work", end: { type: "time", seconds: 600 } }] },
    });
    expect(res.success, !res.success ? res.error : "").toBe(true);
    expect((await liveSets(pe)).map((r) => r.restTimeSeconds)).toEqual([0, 0]);
  });

  it("updateProgramSet returns the row as it is after a move", async () => {
    const { slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    const res = await updateProgramSet({ id: slots[0].setIds[1], durationSeconds: 1200 });
    expect(res.success && [res.data.stepKind, res.data.setNumber, res.data.durationSeconds]).toEqual(["work", 3, 1200]);
  });

  it("the weekly sync still moves a moved zone target", async () => {
    const { program, slots } = await createProgram(me, [{ exerciseId: bike, sets: plainRide }]);
    await migrateBikeSetsToSteps();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: "2026-11-02", goal: "build" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 2, programId: program.id });

    await syncPeriodizedTargets(c.id, me, [{ programId: program.id }], 6, 8, "build", "intermediate");
    const work = (await liveSets(slots[0].programExerciseId))[2];
    expect(work.stepKind).toBe("work");
    expect((work.targets as { zone: number }[])[0].zone).not.toBe(3);
    expect(work.targetHeartRateZone).toBeNull();
    // The phase's rest goes to the rest step after the work step, never onto the step itself.
    const recipe = intervalPhaseRecipe(cycleLoad({ goal: "build", athleteLevel: "intermediate" }, 6, 8).phase);
    const rows = await liveSets(slots[0].programExerciseId);
    expect(rows.every((r) => r.restTimeSeconds === 0)).toBe(true);
    expect([rows[3].stepKind, rows[3].durationSeconds]).toEqual(["rest", recipe.restSeconds]);
  });

  it("runs for a user when an admin turns endurance on", async () => {
    const admin = (await createUser({ role: "admin" })).id;
    const later = (await createUser()).id;
    const { slots } = await createProgram(later, [{ exerciseId: bike, sets: plainRide }]);
    asUser(admin, "admin");
    expect((await setUserEndurance({ userId: later, enabled: true })).success).toBe(true);
    expect((await liveSets(slots[0].programExerciseId))[0].stepKind).toBe("warmup");
  });
});

describe("no writer stores a plain bike set for an endurance user", () => {
  const plainSet = { setNumber: 1, durationSeconds: 1800, targetHeartRateZone: 2, restTimeSeconds: 0 };

  it("edit_program_exercise turns plain bike sets into steps on add and on update", async () => {
    const call = mcpTools(registerProgramTools, me);
    const [program] = await db.insert(programs).values({ userId: me, name: "Ride" }).returning();
    const added = await call("edit_program_exercise", { operation: "add", programId: program.id, exerciseId: bike, sets: [plainSet], reason: "Test", expectedVersion: 1 });
    expect(added.isError, added.raw).toBe(false);
    const pe = added.data.id as number;
    expect((await liveSets(pe)).map((r) => [r.stepKind, r.durationSeconds, r.targets])).toEqual([["work", 1800, [{ metric: "hr", anchor: "lthr", zone: 2 }]]]);

    // A plain list sent over steps: every set is plain, so the slot becomes steps again.
    const [row] = await liveSets(pe);
    const updated = await call("edit_program_exercise", {
      operation: "update",
      programExerciseId: pe,
      sets: [{ id: row.id, setNumber: 1, durationSeconds: 2400, targetHeartRateZone: 3, stepKind: null, targets: null }],
      reason: "Test",
      expectedVersion: added.data.programVersion,
    });
    expect(updated.isError, updated.raw).toBe(false);
    expect((await liveSets(pe)).map((r) => [r.id, r.stepKind, r.durationSeconds, r.targets])).toEqual([[row.id, "work", 2400, [{ metric: "hr", anchor: "lthr", zone: 3 }]]]);
  });

  it("edit_program_exercise keeps plain bike sets for a user without endurance features", async () => {
    const lifter = (await createUser()).id;
    const call = mcpTools(registerProgramTools, lifter);
    const [program] = await db.insert(programs).values({ userId: lifter, name: "Ride" }).returning();
    const added = await call("edit_program_exercise", { operation: "add", programId: program.id, exerciseId: bike, sets: [plainSet], reason: "Test", expectedVersion: 1 });
    expect(added.isError, added.raw).toBe(false);
    expect((await liveSets(added.data.id))[0].stepKind).toBeNull();
  });

  it("a set added in the app to an empty bike exercise is a step", async () => {
    const [program] = await db.insert(programs).values({ userId: me, name: "Ride" }).returning();
    const [pe] = await db.insert(programExercises).values({ programId: program.id, exerciseId: bike, orderIndex: 0 }).returning();
    const res = await addProgramSet({ programExerciseId: pe.id, setNumber: 1, durationSeconds: 1200, restTimeSeconds: 0, setType: "working" });
    expect(res.success, !res.success ? res.error : "").toBe(true);
    expect((await liveSets(pe.id)).map((r) => [r.stepKind, r.durationSeconds])).toEqual([["work", 1200]]);
  });

  it("an imported program and a copied share arrive as steps", async () => {
    // A plain ride of a user without endurance features, exported and shared.
    const friend = (await createUser()).id;
    const { program } = await createProgram(friend, [{ exerciseId: bike, sets: plainRide }]);
    asUser(friend);
    const exported = await exportProgram(program.id);
    expect(exported.success).toBe(true);
    if (!exported.success) return;

    asUser(me);
    const imported = await importProgram(exported.data);
    expect(imported.success, !imported.success ? imported.error : "").toBe(true);
    const [share] = await db.insert(programShares).values({ programId: program.id, sharedByUserId: friend, sharedWithUserId: me }).returning();
    const copied = await copySharedProgram({ shareId: share.id });
    expect(copied.success, !copied.success ? copied.error : "").toBe(true);

    const mine = await db
      .select({ id: programExercises.id })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .where(eq(programs.userId, me));
    expect(mine).toHaveLength(2);
    for (const pe of mine) {
      // The export carries no zone, so the last set is plain work there; the share keeps it.
      expect((await liveSets(pe.id)).map((r) => r.stepKind).slice(0, 4)).toEqual(["warmup", "rest", "work", "rest"]);
      expect((await liveSets(pe.id)).every((r) => r.stepKind != null)).toBe(true);
    }
  });

  it("the triathlon plan writes its rides as steps", async () => {
    await db.insert(athleteProfiles).values({ userId: me, enduranceLevel: "intermediate" as const, availableDays: [1, 2, 3, 4, 7] });
    const day = (offset: number) => toDateStr(addDays(new Date(), offset));
    await createTriathlonPlan(
      { userId: me, writer: "user" },
      { name: "Half", goal: "Finish", startDate: day(9), race: { name: "Race", raceDate: day(250), distance: "half" } },
    );
    const mine = await db.select({ id: programs.id }).from(programs).where(eq(programs.userId, me));
    const rides = await db
      .select({ stepKind: programSets.stepKind, targets: programSets.targets, peak: programSets.peakDistanceMeters })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(and(inArray(programExercises.programId, mine.map((p) => p.id)), eq(exercises.discipline, "bike"), isNull(programSets.deletedAt)));
    expect(rides.length).toBeGreaterThan(0);
    expect(rides.every((r) => r.stepKind != null)).toBe(true);
    // The sync's anchor stays, so the long ride still grows week by week.
    expect(rides.some((r) => r.peak != null)).toBe(true);
  });
});
