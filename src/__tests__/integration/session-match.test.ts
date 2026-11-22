import { db } from "@/db";
import { garminActivities, plannedSessions, rideGarminFills, rides, trainingCycleSlots, trainingCycles, users, workoutSessions, workoutSets } from "@/db/schema";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { pickSessionActivity } from "@/lib/actions/session-match";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { sessionCompliance } from "@/lib/session-compliance";
import { sessionMatch, workoutSessionMatch } from "@/lib/session-match";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The match of a planned session (docs/plans/session-check.md, decisions 4 to
 * 6): each way a session is matched, the activity it names, the candidates to
 * pick from, own rows only, and the Pick action. The clock is fixed at Thu
 * 2026-11-05 12:00 UTC; the users' zone is UTC.
 */

// Garmin is on for premium users only when the key is set (src/lib/garmin/access.ts).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

// Counts the compliance reads (the real function runs).
const reads = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-compliance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-compliance")>();
  return { ...actual, sessionCompliance: (...a: Parameters<typeof actual.sessionCompliance>) => (reads(), actual.sessionCompliance(...a)) };
});

const TODAY = "2026-11-05";
const TUE = "2026-11-03";
const WED = "2026-11-04";
let me: string;
let other: string;
let runEx: number;
let garminSeq = 1000;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
  other = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
  asUser(me, "admin");
  runEx = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

const runProgram = async (userId = me) => (await createProgram(userId, [{ exerciseId: runEx, sets: [{ durationSeconds: 2700, targetReps: null, weightKg: null }] }])).program.id;

/** A cycle with a run on Tuesday and Wednesday; returns the dated sessions of those days. */
async function runWeek(userId = me, program?: number) {
  const programId = program ?? (await runProgram(userId));
  const [c] = await db.insert(trainingCycles).values({ userId, name: "1 General", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
  await db.insert(trainingCycleSlots).values([2, 3].map((dayOfWeek) => ({ trainingCycleId: c.id, daySlot: 1, dayOfWeek, programId })));
  asUser(userId, "admin");
  await getActiveCycleForUser();
  asUser(me, "admin");
  const rows = await db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, c.id), isNull(plannedSessions.deletedAt))).orderBy(asc(plannedSessions.date));
  return { programId, tue: rows.find((r) => r.date === TUE)!, wed: rows.find((r) => r.date === WED)! };
}

async function activity(userId: string, day: string, type: string, opts: { at?: string; duration?: number; name?: string } = {}) {
  const garminActivityId = ++garminSeq;
  const [a] = await db
    .insert(garminActivities)
    .values({
      userId,
      garminActivityId,
      startTimeLocal: new Date(`${day}T${opts.at ?? "07:00"}:00Z`),
      activityType: type,
      data: { duration: opts.duration ?? 2700, distance: 8000, activityName: opts.name ?? `Activity ${garminActivityId}` },
    })
    .returning();
  return a;
}

async function workout(userId: string, date: string, programId: number | null, plannedSessionId: number | null = null) {
  const [s] = await db
    .insert(workoutSessions)
    .values({ userId, programId, date, startTime: new Date(`${date}T07:00:00Z`), endTime: new Date(`${date}T08:00:00Z`), isCompleted: true, plannedSessionId })
    .returning();
  await db.insert(workoutSets).values({ sessionId: s.id, exerciseId: runEx, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 2700 });
  return s.id;
}

async function ride(userId: string, sessionId: number, day: string) {
  const [r] = await db
    .insert(rides)
    .values({ userId, sessionId, mode: "outdoor", sport: "run", status: "finished", plan: {}, seq: 1, startedAt: new Date(`${day}T07:00:00Z`), endedAt: new Date(`${day}T07:45:00Z`) })
    .returning();
  return r.id;
}

describe("sessionMatch: each way a session is matched", () => {
  it("a run the app logged and Garmin filled names the fill's activity and its split", async () => {
    const { programId, tue } = await runWeek();
    // An earlier run of the day, which the app's day rule would take first.
    await activity(me, TUE, "running", { at: "06:00", name: "Early jog" });
    const filled = await activity(me, TUE, "running", { at: "07:01", name: "Morning Run" });
    const sessionId = await workout(me, TUE, programId, tue.id);
    const rideId = await ride(me, sessionId, TUE);
    await db.insert(rideGarminFills).values({ userId: me, rideId, garminActivityId: filled.garminActivityId, previous: { split: "laps", steps: {}, mode: null } });

    const m = await sessionMatch(me, tue.id);
    expect(m).toMatchObject({
      state: "done",
      matchedBy: "link",
      logged: "app_run",
      program: { id: programId, cycleName: "1 General" },
      garmin: { id: filled.id, activityId: filled.garminActivityId, name: "Morning Run", durationSeconds: 2700, fill: "laps" },
      canPick: false,
      candidates: [],
    });
    expect(m!.garmin!.startTime.slice(11, 16)).toBe("07:01");
  });

  it("a run with no standing fill names no activity: its own summary offers Pick", async () => {
    const { programId, tue } = await runWeek();
    const a = await activity(me, TUE, "running");
    const sessionId = await workout(me, TUE, programId, tue.id);
    const rideId = await ride(me, sessionId, TUE);
    await db.insert(rideGarminFills).values({ userId: me, rideId, garminActivityId: a.garminActivityId, previous: { split: "time", steps: {}, mode: null }, declined: true });
    const m = await sessionMatch(me, tue.id);
    expect(m).toMatchObject({ logged: "app_run", garmin: null, canPick: false });
    expect(m!.candidates.map((c) => c.id)).toEqual([a.id]);
  });

  it("an app workout keeps the Garmin activity it took (takenByApp), in sessionCompliance too", async () => {
    const { programId, tue } = await runWeek();
    const a = await activity(me, TUE, "running", { name: "Lunch Run" });
    await workout(me, TUE, programId); // no link: the app matches it by program and day
    const [c] = (await sessionCompliance(me, TUE, TUE)).filter((x) => x.id === tue.id);
    expect(c).toMatchObject({ state: "done", matchedBy: "app", garminActivityId: a.id });
    const m = await sessionMatch(me, tue.id);
    expect(m).toMatchObject({ logged: "app_workout", garmin: { id: a.id, name: "Lunch Run", fill: null }, canPick: false });
  });

  it("a Garmin pair is the watch, and Pick another lists the day's other runs", async () => {
    const { wed } = await runWeek();
    const paired = await activity(me, WED, "running", { duration: 2700 });
    const other2 = await activity(me, WED, "running", { at: "18:00", duration: 600 });
    await activity(me, WED, "cycling"); // another sport: never a candidate
    const m = await sessionMatch(me, wed.id);
    expect(m).toMatchObject({ state: "done", matchedBy: "garmin", logged: "watch", garmin: { id: paired.id, fill: null }, canPick: true });
    expect(m!.candidates.map((c) => c.id)).toEqual([paired.id, other2.id]);

    const r = await pickSessionActivity({ plannedSessionId: wed.id, activityId: other2.id });
    expect(r).toEqual({ success: true, data: null });
    expect(await sessionMatch(me, wed.id)).toMatchObject({ matchedBy: "pick", logged: "watch", garmin: { id: other2.id } });
  });

  it("not matched: a missed session lists the day's runs, and Pick stores one", async () => {
    const { tue } = await runWeek();
    const a = await activity(me, TUE, "running");
    expect((await updatePlannedSession({ op: "miss", id: tue.id })).success).toBe(true);
    const m = await sessionMatch(me, tue.id);
    expect(m).toMatchObject({ state: "missed", matchedBy: null, logged: null, garmin: null, canPick: true });
    expect(m!.candidates.map((c) => c.id)).toEqual([a.id]);

    expect((await pickSessionActivity({ plannedSessionId: tue.id, activityId: a.id })).success).toBe(true);
    const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, tue.id));
    expect(row).toMatchObject({ garminActivityId: a.id, status: "planned" });
    expect(await sessionMatch(me, tue.id)).toMatchObject({ state: "done", matchedBy: "pick", logged: "watch", garmin: { id: a.id } });
  });

  it("an activity another session picked is not a candidate (the pick op refuses it)", async () => {
    const { tue, wed } = await runWeek();
    const a = await activity(me, TUE, "running");
    expect((await pickSessionActivity({ plannedSessionId: wed.id, activityId: a.id })).success).toBe(true);
    expect((await updatePlannedSession({ op: "miss", id: tue.id })).success).toBe(true);
    expect((await sessionMatch(me, tue.id))!.candidates).toEqual([]);
    expect(await pickSessionActivity({ plannedSessionId: tue.id, activityId: a.id })).toEqual({ success: false, error: "That activity is already matched to another session." });
  });

  it("without Garmin there are no Garmin parts", async () => {
    const lifter = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    asUser(lifter);
    const { tue } = await runWeek(lifter);
    await activity(lifter, TUE, "running");
    const m = await sessionMatch(lifter, tue.id);
    expect(m).toMatchObject({ garmin: null, candidates: [], canPick: false });
    asUser(lifter);
    expect((await pickSessionActivity({ plannedSessionId: tue.id, activityId: 1 })).success).toBe(false);
  });
});

describe("own rows only", () => {
  it("another user's session and activities are never read", async () => {
    const { tue } = await runWeek();
    const mine = await activity(me, TUE, "running");
    const theirs = await activity(other, TUE, "running");
    expect((await sessionMatch(me, tue.id))!.garmin!.id).toBe(mine.id);
    expect((await sessionMatch(me, tue.id))!.candidates.map((c) => c.id)).toEqual([mine.id]);
    expect(await sessionMatch(other, tue.id)).toBeNull();

    // The pick checks both rows: their activity on my session, and my session as them.
    expect(await pickSessionActivity({ plannedSessionId: tue.id, activityId: theirs.id })).toEqual({ success: false, error: "Activity not found" });
    asUser(other, "admin");
    expect(await pickSessionActivity({ plannedSessionId: tue.id, activityId: theirs.id })).toEqual({ success: false, error: "Session not found" });
    const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, tue.id));
    expect(row.garminActivityId).toBeNull();
  });

  it("workoutSessionMatch reads only the user's completed workouts, with one compliance read", async () => {
    const { programId, tue, wed } = await runWeek();
    const linked = await workout(me, TUE, programId, tue.id);
    const byDay = await workout(me, WED, programId);
    reads.mockClear();
    expect((await workoutSessionMatch(me, linked))?.match.plannedSessionId).toBe(tue.id);
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockClear();
    expect(await workoutSessionMatch(me, byDay)).toMatchObject({ match: { plannedSessionId: wed.id, matchedBy: "app" }, garminOn: true });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(await workoutSessionMatch(other, linked)).toBeNull();
    await db.update(workoutSessions).set({ isCompleted: false }).where(eq(workoutSessions.id, byDay));
    expect(await workoutSessionMatch(me, byDay)).toBeNull();
  });
});

describe("See every step only when the step page has steps", () => {
  it("a workout with no ride and no Garmin activity has none; one that took an activity, or an ended ride, has them", async () => {
    // A run of steps: the step page splits a Garmin activity into them.
    const steps = { v: 2, sport: "run", name: "Steady run", steps: [{ type: "work", end: { type: "time", seconds: 2700 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] };
    const { programId, tue, wed } = await runWeek(me, (await createStepProgram(me, runEx, steps)).program.id);
    await workout(me, TUE, programId, tue.id); // a "Yes" answer: no ride, no activity that day
    expect(await sessionMatch(me, tue.id)).toMatchObject({ state: "done", logged: "app_workout", hasSteps: false });

    await activity(me, WED, "running");
    const wedWorkout = await workout(me, WED, programId, wed.id);
    expect(await sessionMatch(me, wed.id)).toMatchObject({ logged: "app_workout", hasSteps: true });

    await ride(me, wedWorkout, WED);
    await db.update(users).set({ role: "user" }).where(eq(users.id, me));
    // No Garmin now, but the ended run has its own steps.
    expect(await sessionMatch(me, wed.id)).toMatchObject({ logged: "app_run", garmin: null, hasSteps: true });
  });
});

describe("the Pick action", () => {
  it("refuses an activity far from the session's day, and bad input", async () => {
    const { tue } = await runWeek();
    const far = await activity(me, "2026-10-30", "running");
    const r = await pickSessionActivity({ plannedSessionId: tue.id, activityId: far.id });
    expect(r).toEqual({ success: false, error: "That activity is on 2026-10-30; pick one from the session's day or the day before or after." });
    expect((await pickSessionActivity({ plannedSessionId: "x", activityId: far.id })).success).toBe(false);
  });

  it("refuses a session still to come", async () => {
    const programId = await runProgram();
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, daySlot: 1, dayOfWeek: 6, programId });
    await getActiveCycleForUser();
    const [sat] = await db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, c.id), eq(plannedSessions.date, "2026-11-07")));
    const a = await activity(me, TODAY, "running");
    expect((await sessionMatch(me, sat.id))).toMatchObject({ canPick: false, candidates: [], garmin: null });
    expect(await pickSessionActivity({ plannedSessionId: sat.id, activityId: a.id })).toEqual({ success: false, error: "Only a session of today or earlier can be matched to an activity." });
  });
});
