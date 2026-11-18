/**
 * FTP test rides (docs/plans/bike-ride-logger.md, 4.9, step 8): the assistant
 * writes the app's test templates with edit_program_exercise ftpTest, a test
 * ride freezes its test, get_ride gives the proposed FTP, and Save on the
 * summary (saveRideFtp) adds the threshold row through addThreshold, only for
 * the ride's owner with endurance features on. Clock: Wed 2026-11-18 12:00 UTC.
 */
import { db } from "@/db";
import { athleteThresholds, programExercises, programSets, users, workoutSets } from "@/db/schema";
import { saveRideFtp } from "@/lib/actions/ride-ftp";
import { sendRideEvent, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { registerEnduranceAppTools } from "@/lib/mcp/tools/endurance-app";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { thresholdValues } from "@/lib/session-compliance";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

const TODAY = "2026-11-18";
const T0 = new Date(`${TODAY}T12:00:00Z`);
const MIN = 60_000;
let me: string;
let other: string;
let bike: number;
let run: number;

const easy = { v: 2, sport: "bike", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 1800 }, target: { metric: "power", anchor: "ftp", zone: 2 } }] };

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

const ftpRows = (userId = me) =>
  db.select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, userId), eq(athleteThresholds.kind, "ftp"), isNull(athleteThresholds.deletedAt)));

/** A bike slot that the assistant turned into an FTP test, and its sets in ride order. */
async function testSlot(test: "ramp" | "20min") {
  const { program, slots } = await createStepProgram(me, bike, easy);
  const programExerciseId = slots[0].programExerciseId;
  const r = await mcpTools(registerProgramTools, me)("edit_program_exercise", { operation: "update", programExerciseId, ftpTest: test, reason: "FTP test", expectedVersion: 1 });
  expect(r.isError, r.raw).toBe(false);
  const sets = await db.select().from(programSets).where(eq(programSets.programExerciseId, programExerciseId)).orderBy(asc(programSets.setNumber));
  return { programId: program.id, programExerciseId, sets };
}

/** A test ride started now in an open workout of today. */
async function startTest(test: "ramp" | "20min") {
  const slot = await testSlot(test);
  const session = await createSession(me, slot.programId, { date: TODAY, startTime: T0 });
  const view = ok(await startRide({ sessionId: session.id, programExerciseId: slot.programExerciseId, mode: "indoor", clientId: `start-${session.id}` }));
  return { ...slot, sessionId: session.id, rideId: view.ride.id, plan: view.plan };
}

/** Ride mode's save of a step when it ends, plus typed watts. */
const save = (sessionId: number, set: { id: number; setNumber: number }, seconds: number, status: "done" | "partial", avgPower?: number) => ({
  sessionId,
  exerciseId: bike,
  setNumber: set.setNumber,
  programSetId: set.id,
  actualReps: 0,
  weightKg: 0,
  durationSeconds: seconds,
  restTimeSeconds: 0,
  isCompleted: true,
  stepStatus: status,
  targetOffsetW: 0,
  extendedSeconds: 0,
  ...(avgPower !== undefined && { avgPower }),
  sources: { durationSeconds: "clock", ...(avgPower !== undefined && { avgPower: "typed" }) },
});

/** A finished 20 min test (55 min) with the all-out step typed at 196 W. */
async function finished20() {
  const r = await startTest("20min");
  vi.setSystemTime(new Date(T0.getTime() + 56 * MIN));
  const seconds = [780, 60, 300, 60, 300, 1200, 600];
  for (const [i, set] of r.sets.entries()) ok(await logWorkoutSet(save(r.sessionId, set, seconds[i], "done", i === 5 ? 196 : undefined)));
  return r;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  other = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  run = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 180, measuredOn: "2026-10-01", source: "manual" });
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("edit_program_exercise ftpTest", () => {
  it("writes the ramp template with its test, and get_program reads it back", async () => {
    const { programId, sets } = await testSlot("ramp");
    expect(sets).toHaveLength(22);
    expect(sets[0]).toMatchObject({ stepKind: "warmup", durationSeconds: 600, ramp: { anchor: "absolute", from: 60, to: 100 } });
    expect(sets.slice(1).map((s) => (s.targets as { low: number }[])[0].low)).toEqual(Array.from({ length: 21 }, (_, i) => 100 + 20 * i));
    const got = (await mcpTools(registerProgramTools, me)("get_program", { programId })).data.programExercises[0];
    expect(got.rideTest).toBe("ramp");
  });

  it("writes the 20 min template", async () => {
    const { programExerciseId, sets } = await testSlot("20min");
    expect(sets.map((s) => [s.stepKind, s.durationSeconds])).toEqual([
      ["warmup", 780],
      ["work", 60],
      ["recovery", 300],
      ["work", 60],
      ["recovery", 300],
      ["work", 1200],
      ["cooldown", 600],
    ]);
    const [pe] = await db.select({ rideTest: programExercises.rideTest }).from(programExercises).where(eq(programExercises.id, programExerciseId));
    expect(pe.rideTest).toBe("20min");
  });

  it("refuses ftpTest with sets or a tree, and on a run slot", async () => {
    const call = mcpTools(registerProgramTools, me);
    const { slots } = await createStepProgram(me, bike, easy);
    const both = await call("edit_program_exercise", { operation: "update", programExerciseId: slots[0].programExerciseId, ftpTest: "ramp", workout: easy, reason: "x", expectedVersion: 1 });
    expect(both.isError).toBe(true);
    expect(both.raw).toContain("send one of sets, workout or ftpTest");
    const runProgram = await createStepProgram(me, run, { v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] });
    const onRun = await call("edit_program_exercise", { operation: "update", programExerciseId: runProgram.slots[0].programExerciseId, ftpTest: "20min", reason: "x", expectedVersion: 1 });
    expect(onRun.isError).toBe(true);
  });
});

describe("a test ride", () => {
  it("freezes its test; get_ride proposes the FTP and Save adds the threshold row once", async () => {
    const r = await finished20();
    expect(r.plan.test).toBe("20min");
    const call = mcpTools(registerEnduranceAppTools, me);
    const before = (await call("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(before.status).toBe("finished");
    expect(before.ftpTest).toMatchObject({ test: "20min", power: 196, powerBasis: "typed", proposedFtp: 186, currentFtp: 180, saved: false, measuredOn: TODAY, protocol: "ftp_20min" });

    expect(ok(await saveRideFtp({ rideId: r.rideId }))).toEqual({ ftp: 186 });
    const rows = await ftpRows();
    const added = rows.find((x) => x.source === "test")!;
    expect(added).toMatchObject({ value: 186, measuredOn: TODAY, protocol: "ftp_20min", testData: { avgPower20: 196 } });
    expect((await thresholdValues(me)).ftp).toBe(186);

    // Saved: a second Save adds nothing, and get_ride says so. The ride keeps its frozen FTP.
    ok(await saveRideFtp({ rideId: r.rideId }));
    expect(await ftpRows()).toHaveLength(2);
    const after = (await call("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(after.ftpTest).toMatchObject({ saved: true, currentFtp: 186 });
    expect(after.plan.ftp).toBe(180);
  });

  it("a ramp test ends on Lap; the highest done step's target gives the FTP", async () => {
    const r = await startTest("ramp");
    // Warm-up 10 min, then 100, 120 and 140 W done; Lap 20 s into 160 W.
    const lapAt = T0.getTime() + (600 + 3 * 60 + 20) * 1000;
    vi.setSystemTime(new Date(lapAt));
    const view = ok(await sendRideEvent({ rideId: r.rideId, clientId: "lap-1", kind: "lap", expectedSeq: 1 }));
    expect(view.ride.status).toBe("finished");
    const seconds = [600, 60, 60, 60];
    for (const [i, set] of r.sets.slice(0, 4).entries()) ok(await logWorkoutSet(save(r.sessionId, set, seconds[i], "done")));
    ok(await logWorkoutSet(save(r.sessionId, r.sets[4], 20, "partial")));

    const ride = (await mcpTools(registerEnduranceAppTools, me)("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(ride.ftpTest).toMatchObject({ test: "ramp", power: 140, powerBasis: "target", proposedFtp: 105, protocol: "ftp_ramp" });

    // Typed watts on the highest done step win over its target.
    await db.update(workoutSets).set({ avgPower: 248, sources: { durationSeconds: "clock", avgPower: "typed" } }).where(and(eq(workoutSets.sessionId, r.sessionId), eq(workoutSets.programSetId, r.sets[3].id)));
    expect(ok(await saveRideFtp({ rideId: r.rideId }))).toEqual({ ftp: 186 });
    expect((await ftpRows()).find((x) => x.source === "test")).toMatchObject({ value: 186, protocol: "ftp_ramp", testData: { best1MinPower: 248 } });
  });

  it("refuses a ride that is not the caller's, a running ride, a ride with no result, and endurance off", async () => {
    const r = await finished20();
    asUser(other);
    expect(await saveRideFtp({ rideId: r.rideId })).toMatchObject({ success: false, error: "Not found" });
    expect(await ftpRows(other)).toHaveLength(0);
    asUser(me);

    const running = await startTest("20min");
    expect(await saveRideFtp({ rideId: running.rideId })).toMatchObject({ success: false, error: "The ride is still running" });

    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    expect(await saveRideFtp({ rideId: r.rideId })).toMatchObject({ success: false, error: "Endurance features are not on for this account" });
    expect(await ftpRows()).toHaveLength(1);
  });

  it("a 20 min test with no watts on the all-out step gives no FTP", async () => {
    const r = await startTest("20min");
    vi.setSystemTime(new Date(T0.getTime() + 56 * MIN));
    const ride = (await mcpTools(registerEnduranceAppTools, me)("get_ride", { workoutSessionId: r.sessionId })).data.ride;
    expect(ride.ftpTest).toMatchObject({ test: "20min", proposedFtp: null });
    expect(await saveRideFtp({ rideId: r.rideId })).toMatchObject({ success: false, error: "This ride gives no FTP" });
  });
});
