import { TEMPO_WORKOUT } from "@/__tests__/fixtures/bike-sessions";
import { db } from "@/db";
import { planRevisions, plannedSessions, trainingCycleSlots, trainingCycles, workoutSessions, workouts } from "@/db/schema";
import { undoPlanChangeSet } from "@/lib/actions/plan-revisions";
import { getActiveCycleForUser, upsertCycleSlot } from "@/lib/actions/training-cycles";
import { addWorkoutSession, previewEditedWorkout, saveEditedWorkout, sessionMenuOp } from "@/lib/actions/workout-editor";
import { applySessionOp } from "@/lib/planned-sessions";
import { ftpTestWorkout } from "@/lib/utils/workout-templates";
import { createWorkout } from "@/lib/workouts";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The workout editor's Server Actions (docs/plans/bike-sessions.md, 5.3):
 * save for this session, this and later sessions, or as a new library
 * workout; Undo; the refusals; the session menu; a workout on a template
 * slot. Clock: Thu 2026-11-05 12:00 UTC, zone UTC. The cycle starts Mon
 * 2026-11-02 with the tempo on Tuesdays: 3, 10, 17 and 24 Nov.
 */

const TODAY = "2026-11-05";
let me: string;
let other: string;

/** Tempo as 3 x 12 min: warm-up, 3 x (12 min work, 3 min easy), cool-down. */
const TEMPO_3X12 = {
  v: 1,
  sport: "bike",
  name: "Tempo 3 x 12 min",
  steps: [
    TEMPO_WORKOUT.steps[0],
    { type: "repeat", count: 3, steps: [{ ...TEMPO_WORKOUT.steps[1], end: { type: "time", seconds: 720 } }, { ...TEMPO_WORKOUT.steps[2], end: { type: "time", seconds: 180 } }] },
    TEMPO_WORKOUT.steps[4],
  ],
};

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  other = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

/** A library tempo on every Tuesday of a 4-week block from Mon 2 Nov. */
async function tempoCycle(userId = me) {
  const w = await createWorkout({ userId, writer: "user" }, { workout: TEMPO_WORKOUT });
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
  await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 2, daySlot: 1, workoutId: w.id });
  asUser(userId);
  await getActiveCycleForUser();
  asUser(me);
  const rows = await sessionsOf(c.id);
  const byDate = Object.fromEntries(rows.map((r) => [r.date!, r.id]));
  return { workoutId: w.id, cycleId: c.id, byDate };
}

const sessionsOf = (cycleId: number) =>
  db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt))).orderBy(asc(plannedSessions.date));
const sessionRow = async (id: number) => (await db.select().from(plannedSessions).where(eq(plannedSessions.id, id)))[0];
const nameOf = (json: unknown) => (json as { name: string } | null)?.name;

describe("save for this session", () => {
  it("writes the session's own copy as a user revision, and Undo puts the tempo back", async () => {
    const { byDate } = await tempoCycle();
    const id = byDate["2026-11-10"];
    const r = await saveEditedWorkout({ target: "session", sessionId: id, workout: TEMPO_3X12 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    const row = await sessionRow(id);
    expect(nameOf(row.workout)).toBe("Tempo 3 x 12 min");
    expect(row.workoutId).toBeNull();
    // The other Tuesdays keep the library tempo.
    expect(nameOf((await sessionRow(byDate["2026-11-17"])).workout)).toBe("Tempo 2 x 15 min");
    const revs = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "planned_session"), eq(planRevisions.objectId, id), eq(planRevisions.changeSetId, r.data.changeSetId)));
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ writer: "user", action: "update", userId: me });

    const undo = await undoPlanChangeSet({ changeSetId: r.data.changeSetId });
    expect(undo.success, JSON.stringify(undo)).toBe(true);
    const back = await sessionRow(id);
    expect(nameOf(back.workout)).toBe("Tempo 2 x 15 min");
  });

  it("refuses a session that is done or started, and changes nothing", async () => {
    const { byDate } = await tempoCycle();
    const id = byDate["2026-11-10"];
    await db.insert(workoutSessions).values({ userId: me, date: "2026-11-05", startTime: new Date(), isCompleted: false, plannedSessionId: id });
    const r = await saveEditedWorkout({ target: "session", sessionId: id, workout: TEMPO_3X12 });
    expect(r).toMatchObject({ success: false, error: "This session is started or done. It cannot change." });
    expect(nameOf((await sessionRow(id)).workout)).toBe("Tempo 2 x 15 min");

    // A past Tuesday that was done: the same refusal.
    const past = byDate["2026-11-03"];
    await db.insert(workoutSessions).values({ userId: me, date: "2026-11-03", startTime: new Date(), isCompleted: true, plannedSessionId: past });
    expect(await saveEditedWorkout({ target: "session", sessionId: past, workout: TEMPO_3X12 })).toMatchObject({ success: false });
    expect(nameOf((await sessionRow(past)).workout)).toBe("Tempo 2 x 15 min");
  });

  it("returns the parseWorkout text at each field, and saves nothing", async () => {
    const { byDate } = await tempoCycle();
    const id = byDate["2026-11-10"];
    const bad = { ...TEMPO_WORKOUT, steps: [{ ...TEMPO_WORKOUT.steps[0], target: { metric: "power", anchor: "ftp", low: 300 } }] };
    const r = await saveEditedWorkout({ target: "session", sessionId: id, workout: bad });
    expect(r).toMatchObject({ success: false, fieldErrors: { "steps[0].target.low": ["must be 30-200 % FTP"] } });
    expect(nameOf((await sessionRow(id)).workout)).toBe("Tempo 2 x 15 min");
  });

  it("refuses another user's session", async () => {
    const { byDate } = await tempoCycle(other);
    const r = await saveEditedWorkout({ target: "session", sessionId: byDate["2026-11-10"], workout: TEMPO_3X12 });
    expect(r).toMatchObject({ success: false, error: "Planned session not found" });
    expect(nameOf((await sessionRow(byDate["2026-11-10"])).workout)).toBe("Tempo 2 x 15 min");
  });
});

describe("save for this and later sessions", () => {
  it("updates the library; untouched sessions follow, a hand-changed one keeps its version and is listed", async () => {
    const { workoutId, byDate } = await tempoCycle();
    // 24 Nov was changed by hand.
    const own = { ...TEMPO_WORKOUT, name: "My own tempo" };
    await applySessionOp({ userId: me, writer: "user" }, { op: "set_workout", id: byDate["2026-11-24"], workout: own });

    const preview = await previewEditedWorkout({ sessionId: byDate["2026-11-10"], workoutId, workout: TEMPO_3X12 });
    expect(preview).toMatchObject({ success: true, data: { session: [], later: [], keepOwn: [{ id: byDate["2026-11-24"], date: "2026-11-24" }] } });

    const r = await saveEditedWorkout({ target: "later", workoutId, sessionId: byDate["2026-11-10"], workout: TEMPO_3X12 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    const [lib] = await db.select().from(workouts).where(eq(workouts.id, workoutId));
    expect(lib.name).toBe("Tempo 3 x 12 min");
    expect(nameOf((await sessionRow(byDate["2026-11-10"])).workout)).toBe("Tempo 3 x 12 min");
    expect(nameOf((await sessionRow(byDate["2026-11-17"])).workout)).toBe("Tempo 3 x 12 min");
    expect(nameOf((await sessionRow(byDate["2026-11-24"])).workout)).toBe("My own tempo");
    const [rev] = await db.select().from(planRevisions).where(and(eq(planRevisions.objectType, "workout"), eq(planRevisions.objectId, workoutId), eq(planRevisions.changeSetId, r.data.changeSetId)));
    expect(rev).toMatchObject({ writer: "user", action: "update" });

    expect((await undoPlanChangeSet({ changeSetId: r.data.changeSetId })).success).toBe(true);
    const [libBack] = await db.select().from(workouts).where(eq(workouts.id, workoutId));
    expect(libBack.name).toBe("Tempo 2 x 15 min");
    expect(nameOf((await sessionRow(byDate["2026-11-17"])).workout)).toBe("Tempo 2 x 15 min");
  });

  it("gives a session changed by hand the new library version too", async () => {
    const { workoutId, byDate } = await tempoCycle();
    const id = byDate["2026-11-10"];
    await applySessionOp({ userId: me, writer: "user" }, { op: "set_workout", id, workout: { ...TEMPO_WORKOUT, name: "Mine" } });
    const r = await saveEditedWorkout({ target: "later", workoutId, sessionId: id, workout: TEMPO_3X12 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const row = await sessionRow(id);
    expect(nameOf(row.workout)).toBe("Tempo 3 x 12 min");
    expect(row.workoutId).toBe(workoutId);
  });

  it("refuses another user's library workout", async () => {
    const { workoutId } = await tempoCycle(other);
    expect(await saveEditedWorkout({ target: "later", workoutId, workout: TEMPO_3X12 })).toMatchObject({ success: false, error: "Workout not found" });
    const [lib] = await db.select().from(workouts).where(eq(workouts.id, workoutId));
    expect(lib.name).toBe("Tempo 2 x 15 min");
  });
});

describe("save as a new library workout", () => {
  it("creates it, plans it on a calendar day, and Undo removes both", async () => {
    const { cycleId } = await tempoCycle();
    const r = await saveEditedWorkout({ target: "new", workout: ftpTestWorkout(), plan: { cycleId, date: "2026-11-12" } });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    const [lib] = await db.select().from(workouts).where(eq(workouts.id, r.data.workoutId!));
    expect(lib).toMatchObject({ userId: me, name: "FTP test", sport: "bike" });
    const added = await sessionRow(r.data.sessionId!);
    expect(added).toMatchObject({ userId: me, cycleId, date: "2026-11-12", workoutId: lib.id });
    expect(nameOf(added.workout)).toBe("FTP test");

    expect((await undoPlanChangeSet({ changeSetId: r.data.changeSetId })).success).toBe(true);
    expect((await sessionRow(r.data.sessionId!)).deletedAt).not.toBeNull();
    const [gone] = await db.select().from(workouts).where(eq(workouts.id, lib.id));
    expect(gone.deletedAt).not.toBeNull();
  });

  it("creates one with no day, and refuses another user's cycle", async () => {
    const r = await saveEditedWorkout({ target: "new", workout: TEMPO_3X12 });
    expect(r).toMatchObject({ success: true, data: { sessionId: null } });
    const theirs = await tempoCycle(other);
    const live = () => db.select().from(workouts).where(and(eq(workouts.userId, me), isNull(workouts.deletedAt)));
    const before = (await live()).length;
    expect(await saveEditedWorkout({ target: "new", workout: TEMPO_3X12, plan: { cycleId: theirs.cycleId, date: "2026-11-12" } })).toMatchObject({ success: false });
    // A refused day takes the new library workout back too.
    expect((await live()).length).toBe(before);
  });
});

describe("the calendar's Add session", () => {
  it("adds a library workout on a coming day, and refuses another user's workout", async () => {
    const { cycleId, workoutId } = await tempoCycle();
    const r = await addWorkoutSession({ cycleId, date: "2026-11-13", workoutId });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    expect(await sessionRow(r.data.sessionId)).toMatchObject({ date: "2026-11-13", workoutId });
    const theirs = await tempoCycle(other);
    expect(await addWorkoutSession({ cycleId, date: "2026-11-14", workoutId: theirs.workoutId })).toMatchObject({ success: false, error: "Workout not found" });
  });
});

describe("the session menu", () => {
  it("sets the priority, pulls the newest library copy, and undoes a missed mark", async () => {
    const { workoutId, byDate } = await tempoCycle();
    const id = byDate["2026-11-10"];
    expect(await sessionMenuOp({ op: "set_priority", id, priority: "key" })).toMatchObject({ success: true });
    expect((await sessionRow(id)).priority).toBe("key");

    // The session is touched now: a library change passes it by until "Update from library".
    await db.update(workouts).set({ workout: { ...TEMPO_WORKOUT, name: "New tempo" } }).where(eq(workouts.id, workoutId));
    expect(await sessionMenuOp({ op: "update_from_library", id })).toMatchObject({ success: true });
    expect(nameOf((await sessionRow(id)).workout)).toBe("New tempo");

    const past = byDate["2026-11-03"];
    await applySessionOp({ userId: me, writer: "user" }, { op: "miss", id: past });
    expect((await sessionRow(past)).status).toBe("missed");
    expect(await sessionMenuOp({ op: "unmiss", id: past })).toMatchObject({ success: true });
    expect((await sessionRow(past)).status).toBe("planned");

    asUser(other);
    expect(await sessionMenuOp({ op: "set_priority", id, priority: "optional" })).toMatchObject({ success: false, error: "Session not found" });
    expect((await sessionRow(id)).priority).toBe("key");
  });
});

describe("a workout on a template slot", () => {
  it("puts a library workout on a weekday slot, and refuses another user's workout", async () => {
    const { cycleId, workoutId } = await tempoCycle();
    const r = await upsertCycleSlot({ trainingCycleId: cycleId, dayOfWeek: 4, daySlot: 1, workoutId, label: "Tempo" });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const [slot] = await db.select().from(trainingCycleSlots).where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), eq(trainingCycleSlots.dayOfWeek, 4)));
    expect(slot).toMatchObject({ workoutId, programId: null });

    const theirs = await tempoCycle(other);
    expect(await upsertCycleSlot({ trainingCycleId: cycleId, dayOfWeek: 6, daySlot: 1, workoutId: theirs.workoutId })).toMatchObject({ success: false, error: "Workout not found" });
  });
});
