import { db } from "@/db";
import { garminActivities, garminConnections, planRevisions, plannedSessions, trainingCycleSlots, trainingCycles, workoutSessions, workouts } from "@/db/schema";
import { manageWorkout } from "@/lib/actions/workouts-compliance";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { registerAthleteProfileTools } from "@/lib/mcp/tools/athlete-profile";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerWorkoutLibraryTools } from "@/lib/mcp/tools/workouts-compliance";
import { restoreRevision } from "@/lib/plan-revisions";
import { moveSuggestion } from "@/lib/session-answers";
import { sessionCompliance } from "@/lib/session-compliance";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * Review fixes for structured workouts and planned vs done
 * (docs/plans/workouts-and-compliance.md, section 19). Each test failed on the
 * code before its fix. Clock: Thu 2026-11-05 12:00 UTC; zone UTC.
 */

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TODAY = "2026-11-05";
let me: string;
let other: string;
let runEx: number;
let liftEx: number;
let bikeEx: number;

const runWorkout = (name: string, seconds: number) => ({ v: 1, sport: "run", name, steps: [{ type: "work", end: { type: "time", seconds } }] });
const hardRun = { v: 1, sport: "run", name: "Intervals", steps: [{ type: "repeat", count: 4, steps: [{ type: "work", end: { type: "time", seconds: 240 } }, { type: "recovery", end: { type: "time", seconds: 120 } }] }] };

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
  other = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me, "admin");
  runEx = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  bikeEx = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  liftEx = (await createExercise()).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

/** Garmin data so the long-run cap runs: the longest run in 30 days is 80 minutes. */
async function withGarminRuns(userId = me) {
  await db.insert(garminConnections).values({ userId, encryptedKey: "x", lastSyncedAt: new Date() });
  await db.insert(garminActivities).values({ userId, garminActivityId: Math.floor(Math.random() * 1e9), startTimeLocal: new Date("2026-10-28T07:00:00Z"), activityType: "running", data: { duration: 80 * 60, distance: 14000 } });
}

async function cycle(userId: string, slots: Partial<typeof trainingCycleSlots.$inferInsert>[], opts: { start?: string; generate?: boolean } = {}) {
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate: opts.start ?? "2026-11-02" }).returning();
  if (slots.length) await db.insert(trainingCycleSlots).values(slots.map((s) => ({ trainingCycleId: c.id, daySlot: 1, ...s })));
  if (opts.generate !== false) await getActiveCycleForUser();
  return c.id;
}

const sessionsOf = (cycleId: number) =>
  db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt))).orderBy(asc(plannedSessions.date), asc(plannedSessions.position));
const program = async (exerciseId: number, sets: Record<string, unknown>[] = [{}], userId = me) => (await createProgram(userId, [{ exerciseId, sets }])).program.id;
const lib = (userId = me) => mcpTools((s, u) => registerWorkoutLibraryTools(s, u), userId);
const planned = (userId = me) => mcpTools(registerPlannedSessionTools, userId);
const cycles = (userId = me) => mcpTools((s, u) => registerCycleTools(s, u), userId);
const cycleVersion = async (id: number) => (await db.select({ v: trainingCycles.version }).from(trainingCycles).where(eq(trainingCycles.id, id)))[0].v;

async function logged(userId: string, date: string, programId: number | null, exerciseId: number | null, plannedSessionId: number | null = null) {
  const [s] = await db
    .insert(workoutSessions)
    .values({ userId, programId, date, startTime: new Date(`${date}T07:00:00Z`), isCompleted: true, plannedSessionId })
    .returning();
  if (exerciseId != null) {
    const { workoutSets } = await import("@/db/schema");
    await db.insert(workoutSets).values({ sessionId: s.id, exerciseId, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 1800 });
  }
  return s.id;
}

describe("review 1: a run does not clear the day's strength session", () => {
  it("linked or not, the run clears the run and the strength session stays not done", async () => {
    const lift = await program(liftEx);
    const run = await program(runEx, [{ durationSeconds: 1800, targetReps: null, weightKg: null }]);
    const c = await cycle(me, [{ dayOfWeek: 2, programId: lift }, { dayOfWeek: 2, daySlot: 2, programId: run }, { dayOfWeek: 3, programId: lift }, { dayOfWeek: 3, daySlot: 2, programId: run }]);
    const rows = await sessionsOf(c);
    const tueRun = rows.find((r) => r.date === "2026-11-03" && r.position === 2)!;
    await logged(me, "2026-11-03", null, runEx, tueRun.id);
    await logged(me, "2026-11-04", null, runEx);
    const s = await sessionCompliance(me, "2026-11-03", "2026-11-04", { cycleId: c });
    expect(s.map((x) => [x.date, x.position, x.state])).toEqual([
      ["2026-11-03", 1, "missed"],
      ["2026-11-03", 2, "done"],
      ["2026-11-04", 1, "missed"],
      ["2026-11-04", 2, "done"],
    ]);
  });
});

describe("review 2 and 3: the long-run cap and hard sessions see workouts", () => {
  it("refuses an added 4 h run workout over the cap", async () => {
    await withGarminRuns();
    const c = await cycle(me, []);
    const r = await planned()("manage_planned_session", { operation: "add", cycleId: c, date: "2026-11-07", workout: runWorkout("Very long", 4 * 3600), reason: "Long run" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].rule).toBe("long_run_cap");
  });

  it("refuses a slot with a 4 h run library workout over the cap", async () => {
    await withGarminRuns();
    const c = await cycle(me, []);
    const w = (await lib()("manage_workout", { operation: "create", workout: runWorkout("Very long", 4 * 3600), reason: "x" })).data;
    const r = await cycles()("edit_cycle_slot", { operation: "upsert", trainingCycleId: c, dayOfWeek: 6, workoutId: w.workoutId, reason: "Long run", expectedVersion: await cycleVersion(c) });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].rule).toBe("long_run_cap");
  });

  it("counts a hard workout slot on a cycle's template week", async () => {
    const hard = await program(bikeEx, [{ durationSeconds: 300, sessionRole: "work", targetReps: null }]);
    const c = await cycle(me, [{ dayOfWeek: 1, programId: hard }, { dayOfWeek: 3, programId: hard }, { dayOfWeek: 5, programId: hard }], { generate: false });
    const w = (await lib()("manage_workout", { operation: "create", workout: hardRun, reason: "x" })).data;
    const r = await cycles()("edit_cycle_slot", { operation: "upsert", trainingCycleId: c, dayOfWeek: 7, workoutId: w.workoutId, reason: "Fourth", expectedVersion: await cycleVersion(c) });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].rule).toBe("hard_sessions_per_week");
  });

  it("refuses an assistant's library edit that makes the sessions' run too long, accepts an override; a user's rename is not checked", async () => {
    await withGarminRuns();
    const w = (await lib()("manage_workout", { operation: "create", workout: runWorkout("Saturday run", 30 * 60), reason: "x" })).data;
    await cycle(me, [{ dayOfWeek: 6, workoutId: w.workoutId }]);
    const r = await lib()("manage_workout", { operation: "update", workoutId: w.workoutId, workout: runWorkout("Saturday run", 4 * 3600), reason: "Longer", expectedVersion: w.version });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.raw).brokenLimits[0].rule).toBe("long_run_cap");
    const [row] = await db.select().from(workouts).where(eq(workouts.id, w.workoutId));
    expect((row.workout as { steps: { end: { seconds: number } }[] }).steps[0].end.seconds).toBe(1800);
    const ok = await lib()("manage_workout", { operation: "update", workoutId: w.workoutId, workout: runWorkout("Saturday run", 4 * 3600), reason: "Longer", expectedVersion: w.version, overrideLimits: ["long_run_cap"], overrideReason: "The athlete did 3 h last week off the watch" });
    expect(ok.isError, ok.raw).toBe(false);
    expect((await manageWorkout({ op: "rename", id: w.workoutId, name: "Big day" })).success).toBe(true);
  });
});

describe("review 4: a brick does not move a done leg", () => {
  it("refuses to move the first leg when the second is logged", async () => {
    const c = await cycle(me, []);
    const ride = await planned()("manage_planned_session", { operation: "add", cycleId: c, date: TODAY, workout: { v: 1, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 3600 } }] }, reason: "x" });
    const run = await planned()("manage_planned_session", { operation: "add", cycleId: c, date: TODAY, workout: runWorkout("Off the bike", 1200), brickParentId: ride.data.session.id, reason: "x" });
    await logged(me, TODAY, null, runEx, run.data.session.id);
    const r = await planned()("manage_planned_session", { operation: "move", id: ride.data.session.id, date: "2026-11-06", reason: "x", expectedVersion: ride.data.version });
    expect(r.isError).toBe(true);
    expect(r.raw).toContain("logged");
    const [child] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, run.data.session.id));
    expect(child.date).toBe(TODAY);
  });
});

describe("review 7 and 8: restores and the workout slots", () => {
  it("restoring a deleted library workout brings its sessions back; undoing an edit brings the old copy back", async () => {
    const w = (await lib()("manage_workout", { operation: "create", workout: runWorkout("Saturday run", 1800), reason: "x" })).data;
    const c = await cycle(me, [{ dayOfWeek: 6, workoutId: w.workoutId }]);
    const before = (await sessionsOf(c)).length;
    const upd = await lib()("manage_workout", { operation: "update", workoutId: w.workoutId, workout: runWorkout("Saturday run", 2400), reason: "Longer", expectedVersion: w.version });
    const [edit] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "workout"), eq(planRevisions.objectId, w.workoutId))).orderBy(asc(planRevisions.id));
    expect(await restoreRevision({ userId: me, writer: "user" }, edit.id)).not.toBeNull();
    const sat = (await sessionsOf(c)).find((r) => r.date === "2026-11-07")!;
    expect((sat.workout as { steps: { end: { seconds: number } }[] }).steps[0].end.seconds).toBe(1800);

    await lib()("manage_workout", { operation: "delete", workoutId: w.workoutId, reason: "x", expectedVersion: upd.data.version + 1 });
    expect((await sessionsOf(c)).length).toBe(0);
    expect((await manageWorkout({ op: "restore", id: w.workoutId })).success).toBe(true);
    expect((await sessionsOf(c)).length).toBe(before);
  });

  it("a cycle restore clears a slot's workout that no longer exists", async () => {
    const w = (await lib()("manage_workout", { operation: "create", workout: runWorkout("Gone", 1800), reason: "x" })).data;
    const lift = await program(liftEx);
    const c = await cycle(me, [{ dayOfWeek: 1, programId: lift }]);
    await cycles()("edit_cycle_slot", { operation: "upsert", trainingCycleId: c, dayOfWeek: 6, workoutId: w.workoutId, reason: "x", expectedVersion: await cycleVersion(c) });
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, c))).orderBy(desc(planRevisions.id)).limit(1);
    await cycles()("edit_cycle_slot", { operation: "remove", cycleId: c, slotId: (await db.select().from(trainingCycleSlots).where(and(eq(trainingCycleSlots.trainingCycleId, c), eq(trainingCycleSlots.dayOfWeek, 6))))[0].id, reason: "x", expectedVersion: await cycleVersion(c) });
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, "workout"), eq(planRevisions.objectId, w.workoutId)));
    await db.delete(workouts).where(eq(workouts.id, w.workoutId)); // purged
    expect(await restoreRevision({ userId: me, writer: "user" }, rev.id)).not.toBeNull();
    const slots = await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, c));
    expect(slots.find((s) => s.dayOfWeek === 6)?.workoutId).toBeNull();
  });
});

describe("review 13: the suggested day", () => {
  it("is never a day that already holds three sessions, nor next to an unconfirmed hard session", async () => {
    const lift = await program(liftEx);
    const longRun = await program(runEx, [{ durationSeconds: 5400, targetReps: null, weightKg: null }]);
    const hard = await program(runEx, [{ durationSeconds: 600, sessionRole: "work", targetReps: null, weightKg: null }]);
    // Tue long run (missed key); Wed hard (unconfirmed); Fri and Sat hold three strength sessions each.
    const c = await cycle(me, [
      { dayOfWeek: 2, programId: longRun },
      { dayOfWeek: 3, programId: hard },
      ...[5, 6].flatMap((d) => [1, 2, 3].map((daySlot) => ({ dayOfWeek: d, daySlot, programId: lift }))),
    ]);
    const tue = (await sessionsOf(c)).find((r) => r.date === "2026-11-03")!;
    await db.update(plannedSessions).set({ status: "missed", statusOn: TODAY, priority: "key" }).where(eq(plannedSessions.id, tue.id));
    const [s] = await sessionCompliance(me, "2026-11-03", "2026-11-03", { cycleId: c });
    // Thu: next to Wed's hard session (unconfirmed counts). Fri, Sat: full. Sun: free.
    expect(await moveSuggestion(me, s)).toEqual({ date: "2026-11-08" });
  });
});

describe("review 14, 15, 16: picks, template bricks and chains", () => {
  it("refuses to pick an activity for a skipped session", async () => {
    const run = await program(runEx, [{ durationSeconds: 1800, targetReps: null, weightKg: null }]);
    const c = await cycle(me, [{ dayOfWeek: 3, programId: run }]);
    const wed = (await sessionsOf(c))[0];
    const [act] = await db.insert(garminActivities).values({ userId: me, garminActivityId: 77, startTimeLocal: new Date("2026-11-04T07:00:00Z"), activityType: "running", data: { duration: 1800 } }).returning();
    const sk = await planned()("manage_planned_session", { operation: "skip", id: wed.id, reason: "x", expectedVersion: wed.version });
    const r = await lib()("confirm_planned_session", { plannedSessionId: wed.id, outcome: "done", garminActivityId: act.id, reason: "x", expectedVersion: sk.data.version });
    expect(r.isError).toBe(true);
    expect(r.raw).toContain("skipped");
  });

  it("a template change never relinks the brick of a done session", async () => {
    const ride = await program(bikeEx, [{ durationSeconds: 3600, targetReps: null, weightKg: null }]);
    const run = await program(runEx, [{ durationSeconds: 1200, targetReps: null, weightKg: null }]);
    const c = await cycle(me, [{ dayOfWeek: 2, programId: ride, brickWithNext: true }, { dayOfWeek: 2, daySlot: 2, programId: run }]);
    const tueRun = (await sessionsOf(c)).find((r) => r.date === "2026-11-03" && r.position === 2)!;
    expect(tueRun.brickParentId).not.toBeNull();
    await logged(me, "2026-11-03", run, runEx, tueRun.id);
    await cycles()("edit_cycle_slot", { operation: "upsert", trainingCycleId: c, dayOfWeek: 2, programId: ride, brickWithNext: false, reason: "No brick", expectedVersion: await cycleVersion(c) });
    const [after] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, tueRun.id));
    expect(after.brickParentId).toBe(tueRun.brickParentId);
    const nextTue = (await sessionsOf(c)).find((r) => r.date === "2026-11-10" && r.position === 2)!;
    expect(nextTue.brickParentId).toBeNull();
  });

  it("refuses a brick of three: a first leg cannot become a second leg", async () => {
    const c = await cycle(me, []);
    const add = async (name: string, brickParentId?: number) =>
      (await planned()("manage_planned_session", { operation: "add", cycleId: c, date: "2026-11-07", workout: runWorkout(name, 1200), ...(brickParentId && { brickParentId }), reason: "x" })).data;
    const a = await add("A");
    const b = await add("B");
    const cc = await add("C", b.session.id);
    const r = await planned()("manage_planned_session", { operation: "link_brick", id: b.session.id, brickParentId: a.session.id, reason: "x", expectedVersion: b.version });
    expect(r.isError).toBe(true);
    expect(r.raw).toContain("one level");
    void cc;
  });
});

describe("review 18: another user's ids", () => {
  it("are refused for workouts, bricks, picks and sick periods", async () => {
    const theirW = (await lib(other)("manage_workout", { operation: "create", workout: runWorkout("Theirs", 1800), reason: "x" })).data;
    asUser(other);
    const theirC = await cycle(other, []);
    const theirS = (await planned(other)("manage_planned_session", { operation: "add", cycleId: theirC, date: "2026-11-07", workout: runWorkout("Theirs", 1800), reason: "x" })).data;
    const [theirAct] = await db.insert(garminActivities).values({ userId: other, garminActivityId: 88, startTimeLocal: new Date("2026-11-05T07:00:00Z"), activityType: "running", data: { duration: 1800 } }).returning();
    const theirIll = (await lib(other)("manage_illness", { operation: "add", startedOn: "2026-11-01", endedOn: "2026-11-02", reason: "x" })).data;
    asUser(me, "admin");
    const c = await cycle(me, []);
    const mine = (await planned()("manage_planned_session", { operation: "add", cycleId: c, date: TODAY, workout: runWorkout("Mine", 1800), reason: "x" })).data;

    expect((await lib()("get_workout", { workoutId: theirW.workoutId })).raw).toBe("Error: Workout not found");
    expect((await planned()("manage_planned_session", { operation: "set_workout", id: mine.session.id, workoutId: theirW.workoutId, reason: "x", expectedVersion: mine.version })).raw).toBe("Error: Workout not found");
    expect((await planned()("manage_planned_session", { operation: "link_brick", id: mine.session.id, brickParentId: theirS.session.id, reason: "x", expectedVersion: mine.version })).raw).toBe("Error: Brick session not found");
    expect((await lib()("confirm_planned_session", { plannedSessionId: mine.session.id, outcome: "done", garminActivityId: theirAct.id, reason: "x", expectedVersion: mine.version })).raw).toBe("Error: Activity not found");
    expect((await lib()("manage_illness", { operation: "delete", illnessId: theirIll.illnessId, reason: "x", expectedVersion: 1 })).raw).toBe("Error: Sick period not found");
    expect((await lib()("confirm_planned_session", { plannedSessionId: theirS.session.id, outcome: "done", durationSeconds: 1800, reason: "x" })).raw).toBe("Error: Session not found");
    const profile = await mcpTools((s, u) => registerAthleteProfileTools(s, u, undefined, { endurance: true }), me)("get_athlete_profile", {});
    expect(profile.data.sickPeriods).toEqual([]);
  });
});

describe("review 6: list_revisions gates workouts and sick periods", () => {
  it("refuses them with the switch off", async () => {
    const w = (await lib()("manage_workout", { operation: "create", workout: runWorkout("x", 1800), reason: "x" })).data;
    const { users } = await import("@/db/schema");
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    const r = await mcpTools((s, u) => registerProgramTools(s, u), me)("list_revisions", { objectType: "workout", objectId: w.workoutId });
    expect(r.raw).toBe("Error: Endurance features are not on for this account");
  });
});
