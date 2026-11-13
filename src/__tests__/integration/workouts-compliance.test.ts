import { db } from "@/db";
import {
  exercises,
  garminActivities,
  illnessPeriods,
  planRevisions,
  plannedSessions,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workoutSets,
  workouts,
} from "@/db/schema";
import { confirmPlannedDone, getHomeEndurance, getIllness, getWorkouts, manageIllness, manageWorkout, restoreIllness } from "@/lib/actions/workouts-compliance";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { registerAthleteProfileTools } from "@/lib/mcp/tools/athlete-profile";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { registerComplianceTools, registerWorkoutLibraryTools } from "@/lib/mcp/tools/workouts-compliance";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { sessionCompliance } from "@/lib/session-compliance";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * Structured workouts, planned vs done and sick periods
 * (docs/plans/workouts-and-compliance.md): the library and its regeneration,
 * workouts and bricks on dated sessions, the answers, Garmin matching, sick
 * periods, compliance, the weekly sync's adherence, the MCP tools and the
 * Server Actions. The clock is fixed at Thu 2026-11-05 12:00 UTC; the users'
 * zone is UTC.
 */

// Garmin is on for admins only when the key is set (src/lib/garmin/access.ts).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TODAY = "2026-11-05";
let me: string;
let other: string;
let runEx: number;
let liftEx: number;

const easyRun = (name = "Easy run", seconds = 2700) => ({
  v: 1,
  sport: "run",
  name,
  steps: [{ type: "work", end: { type: "time", seconds }, target: { metric: "hr", anchor: "lthr", zone: 2 } }],
});
const intervals = {
  v: 1,
  sport: "run",
  name: "5 × 3 min",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 } },
    { type: "repeat", count: 5, steps: [{ type: "work", end: { type: "time", seconds: 180 }, target: { metric: "hr", anchor: "lthr", zone: 4 } }, { type: "recovery", end: { type: "time", seconds: 120 } }] },
  ],
};

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  other = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
  runEx = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  liftEx = (await createExercise()).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

async function cycle(userId: string, slots: Partial<typeof trainingCycleSlots.$inferInsert>[], start = "2026-11-02", weeks = 4) {
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: weeks, status: "active", startDate: start }).returning();
  if (slots.length) await db.insert(trainingCycleSlots).values(slots.map((s) => ({ trainingCycleId: c.id, daySlot: 1, ...s })));
  await getActiveCycleForUser(); // the lazy backfill makes the dated sessions
  return c.id;
}

const sessionsOf = (cycleId: number) =>
  db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt))).orderBy(asc(plannedSessions.date), asc(plannedSessions.position));

const runProgram = async (userId = me, seconds = 2700) => (await createProgram(userId, [{ exerciseId: runEx, sets: [{ durationSeconds: seconds, targetReps: null, weightKg: null }] }])).program.id;
const liftProgram = async (userId = me) => (await createProgram(userId, [{ exerciseId: liftEx, sets: [{}] }])).program.id;
const lib = (userId = me) => mcpTools((s, u) => registerWorkoutLibraryTools(s, u), userId);
const planned = (userId = me) => mcpTools(registerPlannedSessionTools, userId);

async function completed(userId: string, date: string, programId: number | null, sets: { exerciseId: number; durationSeconds?: number }[], plannedSessionId: number | null = null) {
  const [s] = await db
    .insert(workoutSessions)
    .values({ userId, programId, date, startTime: new Date(`${date}T07:00:00Z`), endTime: new Date(`${date}T08:00:00Z`), isCompleted: true, plannedSessionId })
    .returning();
  if (sets.length) {
    await db.insert(workoutSets).values(sets.map((x, i) => ({ sessionId: s.id, exerciseId: x.exerciseId, setNumber: i + 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: x.durationSeconds ?? null })));
  }
  return s.id;
}

describe("the workout library", () => {
  it("creates a workout, refuses an invalid one with every path, and never takes an override", async () => {
    const created = await lib()("manage_workout", { operation: "create", workout: intervals, reason: "Build block" });
    expect(created.isError, created.raw).toBe(false);
    const [row] = await db.select().from(workouts).where(eq(workouts.id, created.data.workoutId));
    expect(row).toMatchObject({ name: "5 × 3 min", sport: "run", userId: me });
    expect((row.workout as { steps: { id: string }[] }).steps[0].id).toBe("s1");

    const bad = await lib()("manage_workout", {
      operation: "create",
      workout: { ...easyRun(), steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 95, high: 90 } }] },
      reason: "x",
    });
    expect(bad.isError).toBe(true);
    expect(bad.raw).toContain("steps[0].target.anchor");
    expect(bad.raw).toContain("steps[0].target.low");
    expect(await db.select().from(workouts).where(eq(workouts.userId, me))).toHaveLength(1);

    const list = await lib()("list_workouts", {});
    expect(list.data.workouts).toEqual([expect.objectContaining({ id: created.data.workoutId, summary: expect.stringContaining("5 × (3 min Z4 HR") })]);
    expect((await lib(other)("list_workouts", {})).data.workouts).toEqual([]);
    const theirs = await lib(other)("manage_workout", { operation: "update", workoutId: created.data.workoutId, name: "Mine", reason: "x", expectedVersion: 1 });
    expect(theirs.isError).toBe(true);
  });

  it("a slot with a library workout copies it into each session; a library edit reaches only untouched sessions from this week on", async () => {
    const w = (await lib()("manage_workout", { operation: "create", workout: easyRun("Tuesday run"), reason: "x" })).data;
    const cycleId = await cycle(me, [{ dayOfWeek: 2, workoutId: w.workoutId }, { dayOfWeek: 4, workoutId: w.workoutId }], "2026-10-26");
    const rows = await sessionsOf(cycleId);
    expect(rows.length).toBeGreaterThan(4);
    expect(rows.every((r) => r.programId == null && (r.workout as { name: string }).name === "Tuesday run" && r.workoutId === w.workoutId)).toBe(true);

    // Touch one future session with its own workout.
    const future = rows.find((r) => r.date === "2026-11-12")!;
    const set = await planned()("manage_planned_session", { operation: "set_workout", id: future.id, workout: easyRun("Own copy"), reason: "x", expectedVersion: future.version });
    expect(set.isError, set.raw).toBe(false);

    const upd = await lib()("manage_workout", { operation: "update", workoutId: w.workoutId, workout: easyRun("Longer run", 3600), reason: "More time", expectedVersion: w.version });
    expect(upd.isError, upd.raw).toBe(false);
    expect(upd.data.sessionsRegenerated).toBeGreaterThan(0);
    const after = await sessionsOf(cycleId);
    const name = (d: string) => (after.find((r) => r.date === d)!.workout as { name: string }).name;
    expect(name("2026-10-27")).toBe("Tuesday run"); // an earlier week never changes
    expect(name("2026-11-03")).toBe("Longer run"); // this week's untouched past day follows (C2 decision 19)
    expect(name("2026-11-10")).toBe("Longer run");
    expect(name("2026-11-12")).toBe("Own copy"); // touched keeps its own

    const del = await lib()("manage_workout", { operation: "delete", workoutId: w.workoutId, reason: "Gone", expectedVersion: upd.data.version });
    expect(del.isError, del.raw).toBe(false);
    const left = await sessionsOf(cycleId);
    expect(left.find((r) => r.date === "2026-11-10")).toBeUndefined(); // untouched future reads the slot as rest
    expect(left.find((r) => r.date === "2026-11-12")).toBeDefined();
    expect(left.find((r) => r.date === "2026-10-27")).toBeDefined();
  });

  it("Server Actions: list, duplicate, rename, delete and restore; refused with the switch off", async () => {
    const w = (await lib()("manage_workout", { operation: "create", workout: easyRun(), reason: "x" })).data;
    const dup = await manageWorkout({ op: "duplicate", id: w.workoutId });
    expect(dup.success).toBe(true);
    if (!dup.success) return;
    expect((await manageWorkout({ op: "rename", id: dup.data.id, name: "Copy two" })).success).toBe(true);
    expect((await manageWorkout({ op: "delete", id: w.workoutId })).success).toBe(true);
    const live = await getWorkouts({});
    expect(live.success && live.data.map((x) => x.name)).toEqual(["Copy two"]);
    const gone = await getWorkouts({ deleted: true });
    expect(gone.success && gone.data.map((x) => x.id)).toEqual([w.workoutId]);
    expect((await manageWorkout({ op: "restore", id: w.workoutId })).success).toBe(true);
    const back = await getWorkouts({});
    expect(back.success && back.data).toHaveLength(2);
    const revs = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "workout"), eq(planRevisions.writer, "user")));
    expect(revs.length).toBeGreaterThanOrEqual(4);

    const lifter = (await createUser({ timeZone: "UTC" })).id;
    asUser(lifter);
    expect(await manageWorkout({ op: "delete", id: w.workoutId })).toMatchObject({ success: false, error: "Endurance features are not on for this account" });
    expect(await getWorkouts({})).toEqual({ success: true, data: [] });
  });
});

describe("workouts and bricks on dated sessions", () => {
  it("set_workout copies, clears the program and runs the limits; a brick moves as one", async () => {
    const run = await runProgram();
    const cycleId = await cycle(me, [{ dayOfWeek: 6, programId: run }]);
    const [sat] = (await sessionsOf(cycleId)).filter((r) => r.date === "2026-11-07");
    const set = await planned()("manage_planned_session", { operation: "set_workout", id: sat.id, workout: intervals, reason: "Intervals", expectedVersion: sat.version });
    expect(set.isError, set.raw).toBe(false);
    expect(set.data.session).toMatchObject({ programId: null, workout: expect.objectContaining({ name: "5 × 3 min" }) });
    expect(set.data.limits.checked).toContain("hard_sessions_per_week");

    const ride = await planned()("manage_planned_session", { operation: "add", cycleId, date: "2026-11-08", workout: { v: 1, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 3600 } }] }, reason: "Brick" });
    expect(ride.isError, ride.raw).toBe(false);
    const runOff = await planned()("manage_planned_session", { operation: "add", cycleId, date: "2026-11-08", workout: easyRun("Off the bike", 1200), brickParentId: ride.data.session.id, reason: "Brick" });
    expect(runOff.isError, runOff.raw).toBe(false);

    const alone = await planned()("manage_planned_session", { operation: "move", id: runOff.data.session.id, date: "2026-11-09", reason: "x", expectedVersion: runOff.data.version });
    expect(alone).toMatchObject({ isError: true, raw: "Error: Move the brick by its first session, or unlink it." });
    const moved = await planned()("manage_planned_session", { operation: "move", id: ride.data.session.id, date: "2026-11-09", reason: "Weather", expectedVersion: ride.data.version });
    expect(moved.isError, moved.raw).toBe(false);
    const [child] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, runOff.data.session.id));
    expect(child).toMatchObject({ date: "2026-11-09", brickParentId: ride.data.session.id });

    const invalid = await planned()("manage_planned_session", { operation: "set_workout", id: sat.id, workout: { v: 1, sport: "run", name: "x", steps: [] }, reason: "x", expectedVersion: set.data.version, overrideLimits: ["hard_sessions_per_week"], overrideReason: "The athlete asked for it" });
    expect(invalid.isError).toBe(true);
    expect(invalid.raw).toContain("The workout is not valid");
  });

  it("refuses the endurance operations with the switch off", async () => {
    const lifter = (await createUser({ timeZone: "UTC" })).id;
    asUser(lifter);
    const p = await liftProgram(lifter);
    const cycleId = await cycle(lifter, [{ dayOfWeek: 6, programId: p }]);
    const [sat] = (await sessionsOf(cycleId)).filter((r) => r.date === "2026-11-07");
    expect(await updatePlannedSession({ op: "set_priority", id: sat.id, priority: "key" })).toMatchObject({ success: false });
    expect(await updatePlannedSession({ op: "miss", id: sat.id })).toMatchObject({ success: false, error: "Endurance features are not on for this account" });
  });
});

describe("planned vs done", () => {
  it("a strength workout no longer clears a planned run for an endurance user; it still does for a lifter", async () => {
    const run = await runProgram();
    const cycleId = await cycle(me, [{ dayOfWeek: 2, programId: run }]);
    await completed(me, "2026-11-03", null, [{ exerciseId: liftEx }]);
    const [tue] = await sessionCompliance(me, "2026-11-03", "2026-11-03", { cycleId });
    expect(tue).toMatchObject({ sport: "run", state: "unconfirmed", band: null });

    const lifter = (await createUser({ timeZone: "UTC" })).id;
    asUser(lifter);
    const lrun = await runProgram(lifter);
    const lc = await cycle(lifter, [{ dayOfWeek: 2, programId: lrun }]);
    await completed(lifter, "2026-11-03", null, [{ exerciseId: liftEx }]);
    const [ltue] = await sessionCompliance(lifter, "2026-11-03", "2026-11-03", { cycleId: lc });
    expect(ltue).toMatchObject({ state: "done", matchedBy: "app" });
  });

  it("a run logged with numbers is done with a band; an endurance slot with autoComplete writes no auto row", async () => {
    const run = await runProgram(me, 3600);
    const cycleId = await cycle(me, [{ dayOfWeek: 2, programId: run, autoComplete: true }, { dayOfWeek: 3, programId: run, autoComplete: true }]);
    await completed(me, "2026-11-03", null, [{ exerciseId: runEx, durationSeconds: 2700 }]);
    const s = await sessionCompliance(me, "2026-11-02", "2026-11-04", { cycleId });
    expect(s.map((x) => [x.date, x.state, x.band, x.ratio])).toEqual([
      ["2026-11-03", "done", "yellow", 0.75],
      ["2026-11-04", "unconfirmed", null, null],
    ]);
    const autos = await db.select().from(workoutSessions).where(and(eq(workoutSessions.userId, me), eq(workoutSessions.source, "auto")));
    expect(autos).toEqual([]);
  });

  it("answers over MCP: done logs a linked workout; missed on a key session suggests a free day; unmiss", async () => {
    const run = await runProgram(me, 5400); // 90 min: the week's long run is key
    const easy = await runProgram(me, 1800);
    const cycleId = await cycle(me, [{ dayOfWeek: 2, programId: run }, { dayOfWeek: 3, programId: easy }, { dayOfWeek: 6, programId: easy }]);
    const rows = await sessionsOf(cycleId);
    const tue = rows.find((r) => r.date === "2026-11-03")!;
    const wed = rows.find((r) => r.date === "2026-11-04")!;

    const done = await lib()("confirm_planned_session", { plannedSessionId: wed.id, outcome: "done", durationSeconds: 1800, distanceMeters: 5000, rpe: 4, reason: "User told me" });
    expect(done.isError, done.raw).toBe(false);
    expect(done.data).toMatchObject({ state: "done", band: "green" });
    const [logged] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, done.data.loggedSessionId));
    expect(logged).toMatchObject({ plannedSessionId: wed.id, date: "2026-11-04", source: "assistant", isCompleted: true });
    const [set] = await db.select({ discipline: exercises.discipline, rpe: workoutSets.rpe, d: workoutSets.distanceMeters }).from(workoutSets).innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId)).where(eq(workoutSets.sessionId, logged.id));
    expect(set).toEqual({ discipline: "run", rpe: 4, d: 5000 });
    const again = await lib()("confirm_planned_session", { plannedSessionId: wed.id, outcome: "done", durationSeconds: 1800, reason: "x" });
    expect(again.isError).toBe(true);

    const missed = await lib()("confirm_planned_session", { plannedSessionId: tue.id, outcome: "missed", missedReason: "Work", reason: "User said", expectedVersion: tue.version });
    expect(missed.isError, missed.raw).toBe(false);
    expect(missed.data).toMatchObject({ state: "missed", priority: "key", band: "red" });
    // Thu (today) is free with no hard neighbour: Wed was easy, Fri empty.
    expect(missed.data.suggestedMoveTo).toEqual({ date: TODAY });

    const list = await planned()("list_planned_sessions", { from: "2026-11-02", to: "2026-11-08" });
    const tueView = list.data.sessions.find((s: { id: number }) => s.id === tue.id);
    expect(tueView).toMatchObject({ state: "missed", missedReason: "Work", suggestedMoveTo: { date: TODAY } });

    const un = await lib()("confirm_planned_session", { plannedSessionId: tue.id, outcome: "unmiss", reason: "Mistake", expectedVersion: missed.data.version });
    expect(un.data).toMatchObject({ state: "unconfirmed" });
    expect((await lib(other)("confirm_planned_session", { plannedSessionId: tue.id, outcome: "missed", reason: "x", expectedVersion: un.data.version })).raw).toBe("Error: Planned session not found");
  });

  it("matches a Garmin run of the day for an admin, and a picked activity", async () => {
    const admin = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
    asUser(admin, "admin");
    const run = await runProgram(admin, 3600);
    const cycleId = await cycle(admin, [{ dayOfWeek: 2, programId: run }, { dayOfWeek: 3, programId: run }]);
    const act = async (day: string, type: string, duration: number) =>
      (await db.insert(garminActivities).values({ userId: admin, garminActivityId: Math.floor(Math.random() * 1e9), startTimeLocal: new Date(`${day}T06:00:00Z`), activityType: type, data: { duration, distance: 10000 } }).returning())[0].id;
    await act("2026-11-03", "running", 3500);
    const odd = await act("2026-11-04", "cycling", 3600); // not a run: never matches
    const s = await sessionCompliance(admin, "2026-11-03", "2026-11-04", { cycleId });
    expect(s.map((x) => [x.date, x.state, x.matchedBy, x.band])).toEqual([
      ["2026-11-03", "done", "garmin", "green"],
      ["2026-11-04", "unconfirmed", null, null],
    ]);
    const wed = (await sessionsOf(cycleId)).find((r) => r.date === "2026-11-04")!;
    const lateRun = await act("2026-11-05", "running", 1800);
    expect((await updatePlannedSession({ op: "pick", id: wed.id, garminActivityId: odd })).success).toBe(true);
    const [picked] = await sessionCompliance(admin, "2026-11-04", "2026-11-04", { cycleId });
    expect(picked).toMatchObject({ state: "done", matchedBy: "pick", garminActivityId: odd });
    expect(await updatePlannedSession({ op: "pick", id: wed.id, garminActivityId: lateRun + 100000 })).toMatchObject({ success: false });
  });

  it("the app's Yes writes one linked workout; home lists the unconfirmed ones", async () => {
    const run = await runProgram();
    const cycleId = await cycle(me, [{ dayOfWeek: 3, programId: run }]);
    const home = await getHomeEndurance();
    expect(home.success && home.data?.unconfirmed.map((s) => s.date)).toEqual(["2026-11-04"]);
    const wed = (await sessionsOf(cycleId)).find((r) => r.date === "2026-11-04")!;
    const yes = await confirmPlannedDone({ plannedSessionId: wed.id, durationSeconds: 2700, distanceMeters: 8000, rpe: 5 });
    expect(yes.success).toBe(true);
    const after = await getHomeEndurance();
    expect(after.success && after.data?.unconfirmed).toEqual([]);
    expect(await confirmPlannedDone({ plannedSessionId: wed.id, durationSeconds: 30 })).toMatchObject({ success: false, error: "Invalid input" });
  });
});

describe("sick periods", () => {
  it("one entry: sessions inside read as illness, no prompt, done wins; overlaps refused; end and restore", async () => {
    const run = await runProgram();
    const cycleId = await cycle(me, [{ dayOfWeek: 1, programId: run }, { dayOfWeek: 2, programId: run }, { dayOfWeek: 3, programId: run }]);
    const added = await manageIllness({ op: "add", startedOn: "2026-11-02", endedOn: null, severity: "mild", notes: "Cold" });
    expect(added.success).toBe(true);
    if (!added.success) return;
    await completed(me, "2026-11-03", null, [{ exerciseId: runEx, durationSeconds: 1200 }]);
    const s = await sessionCompliance(me, "2026-11-02", "2026-11-04", { cycleId });
    expect(s.map((x) => [x.date, x.state, x.band])).toEqual([
      ["2026-11-02", "illness", "illness"],
      ["2026-11-03", "done", "orange"],
      ["2026-11-04", "illness", "illness"],
    ]);
    const home = await getHomeEndurance();
    expect(home.success && home.data).toMatchObject({ unconfirmed: [], returnInfo: { phase: "sick" } });

    expect(await manageIllness({ op: "add", startedOn: "2026-11-04", endedOn: "2026-11-04" })).toMatchObject({ success: false, error: expect.stringContaining("overlaps") });
    expect(await manageIllness({ op: "add", startedOn: "2026-11-06" })).toMatchObject({ success: false, error: "A sick period starts today or earlier." });

    expect((await manageIllness({ op: "end", id: added.data.id, endedOn: "2026-11-03" })).success).toBe(true);
    const [wed] = await sessionCompliance(me, "2026-11-04", "2026-11-04", { cycleId });
    expect(wed.state).toBe("unconfirmed");
    const back = await getHomeEndurance();
    expect(back.success && back.data?.returnInfo).toMatchObject({ phase: "returning", daysSinceEnd: 2 });

    expect((await manageIllness({ op: "delete", id: added.data.id })).success).toBe(true);
    expect(await getIllness()).toEqual({ success: true, data: [] });
    expect((await restoreIllness({ id: added.data.id })).success).toBe(true);
    const list = await getIllness();
    expect(list.success && list.data.map((p) => p.id)).toEqual([added.data.id]);

    const lifter = (await createUser({ timeZone: "UTC" })).id;
    asUser(lifter);
    expect(await manageIllness({ op: "add", startedOn: TODAY })).toMatchObject({ success: false, error: "Endurance features are not on for this account" });
    expect(await db.select().from(illnessPeriods).where(eq(illnessPeriods.userId, lifter))).toEqual([]);
  });

  it("over MCP: manage_illness and get_athlete_profile with the return rule", async () => {
    const add = await lib()("manage_illness", { operation: "add", startedOn: "2026-11-01", endedOn: "2026-11-03", severity: "severe", reason: "User is sick" });
    expect(add.isError, add.raw).toBe(false);
    expect(add.data.returnInfo).toMatchObject({ phase: "returning", seeDoctor: true });
    const profile = await mcpTools((s, u) => registerAthleteProfileTools(s, u, undefined, { endurance: true }), me)("get_athlete_profile", {});
    expect(profile.data.sickPeriods).toEqual([expect.objectContaining({ id: add.data.illnessId, severity: "severe" })]);
    expect(profile.data.returnRule.length).toBeGreaterThanOrEqual(3);
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "illness"), eq(planRevisions.writer, "assistant")));
    expect(rev.reason).toBe("User is sick");
  });
});

describe("compliance, confirm_session and the slot tool", () => {
  it("get_compliance counts complete weeks", async () => {
    const run = await runProgram();
    await cycle(me, [{ dayOfWeek: 1, programId: run }, { dayOfWeek: 3, programId: run }], "2026-10-19", 6);
    for (const d of ["2026-10-19", "2026-10-21", "2026-10-26"]) await completed(me, d, run, [{ exerciseId: runEx, durationSeconds: 2700 }]);
    const r = await mcpTools((s, u) => registerComplianceTools(s, u), me)("get_compliance", { weeks: 3 });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.weeks.map((w: { start: string; counted: number; done: number }) => [w.start, w.counted, w.done])).toEqual([
      ["2026-10-12", 0, 0],
      ["2026-10-19", 2, 2],
      ["2026-10-26", 2, 1],
    ]);
    expect(r.data).toMatchObject({ completeWeeks: 1, countedWeeks: 2, share: 0.5, thisWeek: { counted: 2, done: 0 } });
  });

  it("confirm_session refuses an endurance session with the switch on; edit_cycle_slot sets a workout slot", async () => {
    const run = await runProgram();
    const cycleId = await cycle(me, [{ dayOfWeek: 3, programId: run }]);
    const r = await mcpTools(registerSessionTools, me)("confirm_session", { date: "2026-11-04", programId: run });
    expect(r.isError).toBe(true);
    expect(r.raw).toContain("confirm_planned_session");

    const w = (await lib()("manage_workout", { operation: "create", workout: easyRun("Slot run"), reason: "x" })).data;
    const [c] = await db.select({ version: trainingCycles.version }).from(trainingCycles).where(eq(trainingCycles.id, cycleId));
    const slot = await mcpTools((s, u) => registerCycleTools(s, u), me)("edit_cycle_slot", { operation: "upsert", trainingCycleId: cycleId, dayOfWeek: 5, workoutId: w.workoutId, priority: "key", reason: "Friday run", expectedVersion: c.version });
    expect(slot.isError, slot.raw).toBe(false);
    const fri = (await sessionsOf(cycleId)).find((x) => x.date === "2026-11-06")!;
    expect(fri).toMatchObject({ programId: null, workoutId: w.workoutId, priority: "key" });
  });
});

describe("the weekly sync's adherence", () => {
  it("reads dated sessions for an endurance user: misses ease the block; plan skips leave the count", async () => {
    const run = (await createProgram(me, [{ exerciseId: runEx, sets: [{ durationSeconds: 1800, peakDurationSeconds: 3600, targetReps: null, weightKg: null }] }])).program.id;
    const cycleId = await cycle(me, [{ dayOfWeek: 1, programId: run }, { dayOfWeek: 3, programId: run }], "2026-10-26", 8);
    const slots = [{ programId: run }];
    const eased = await syncPeriodizedTargets(cycleId, me, slots, 2, 8, "build", "intermediate");
    // Mon 2 and Wed 4 missed: adherence 0 of 2.
    expect(eased.pct).toBe(90);

    // Skipped before their day (a plan change): nothing counted, the neutral case.
    await db.update(plannedSessions).set({ status: "skipped", statusOn: "2026-10-30" }).where(and(eq(plannedSessions.cycleId, cycleId), eq(plannedSessions.date, "2026-11-02")));
    await db.update(plannedSessions).set({ status: "skipped", statusOn: "2026-10-30" }).where(and(eq(plannedSessions.cycleId, cycleId), eq(plannedSessions.date, "2026-11-04")));
    await db.update(trainingCycles).set({ lastSyncedWeek: null }).where(eq(trainingCycles.id, cycleId));
    const neutral = await syncPeriodizedTargets(cycleId, me, slots, 2, 8, "build", "intermediate");
    expect(neutral.pct).toBe(100);
  });

  it("keeps PZ-26 for a lifter: a session of the cycle's program counts whatever the dated sessions say", async () => {
    const lifter = (await createUser({ timeZone: "UTC" })).id;
    asUser(lifter);
    const run = (await createProgram(lifter, [{ exerciseId: runEx, sets: [{ durationSeconds: 1800, peakDurationSeconds: 3600, targetReps: null, weightKg: null }] }])).program.id;
    const cycleId = await cycle(lifter, [{ dayOfWeek: 1, programId: run }, { dayOfWeek: 3, programId: run }], "2026-10-26", 8);
    await db.update(plannedSessions).set({ status: "skipped", statusOn: "2026-10-30" }).where(eq(plannedSessions.cycleId, cycleId));
    // Old rule: no completed session of the programs in 7 days, over two slots: eased.
    const r = await syncPeriodizedTargets(cycleId, lifter, [{ programId: run }, { programId: run }], 2, 8, "build", "intermediate");
    expect(r.pct).toBe(90);
  });
});
