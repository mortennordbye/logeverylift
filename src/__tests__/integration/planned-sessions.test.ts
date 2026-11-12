import { db } from "@/db";
import {
  dismissedMakeups,
  planRevisions,
  plannedSessions,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
} from "@/db/schema";
import { getPlannedSessions, updatePlannedSession } from "@/lib/actions/planned-sessions";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import {
  getActiveCycleForUser,
  removeCycleSlot,
  startTrainingCycle,
  upsertCycleSlot,
} from "@/lib/actions/training-cycles";
import { completeWorkoutSession, createWorkoutSession } from "@/lib/actions/workout-sessions";
import { purgePlanRevisions } from "@/lib/plan-revisions";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Dated sessions against a real database (docs/plans/sessions.md, 8.2): the
 * lazy backfill, regeneration by every template writer (T7), the per-session
 * changes, several sessions a day, and ownership. The clock is fixed at
 * Thu 2026-11-05 12:00 UTC; the user's zone is UTC.
 */

let me: string;
let lift: number;
let run: number;
let strength: number;
const TODAY = "2026-11-05";

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
  const ex = await createExercise();
  const make = async () => (await createProgram(me, [{ exerciseId: ex.id, sets: [{}] }])).program.id;
  lift = await make();
  run = await make();
  strength = await make();
  at(`${TODAY}T12:00:00Z`);
});

afterEach(() => vi.useRealTimers());

/** An active weekday cycle from Mon 2026-11-02, 4 weeks: Mon lift, Thu lift and a run. */
async function cycle(startDate = "2026-11-02", status: "active" | "draft" = "active") {
  const [c] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 4, status, startDate: status === "active" ? startDate : null })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: c.id, dayOfWeek: 1, programId: lift },
    { trainingCycleId: c.id, dayOfWeek: 4, programId: lift },
    { trainingCycleId: c.id, dayOfWeek: 4, daySlot: 2, programId: run, autoComplete: true },
  ]);
  return c.id;
}

const rows = (cycleId: number) =>
  db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt)))
    .orderBy(asc(plannedSessions.date), asc(plannedSessions.position));

const active = async () => {
  const r = await getActiveCycleForUser();
  if (!r.success) throw new Error(r.error);
  return r.data!;
};

describe("the lazy backfill", () => {
  it("makes the whole block once, even when reads race", async () => {
    const id = await cycle();
    await Promise.all([active(), active(), active()]);
    const all = await rows(id);
    // 4 weeks x (Mon + Thu + Thu run).
    expect(all).toHaveLength(12);
    expect(all.slice(0, 3).map((r) => [r.date, r.position, r.programId])).toEqual([
      ["2026-11-02", 1, lift],
      ["2026-11-05", 1, lift],
      ["2026-11-05", 2, run],
    ]);
    const [c] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, id));
    expect(c.sessionsGeneratedAt).not.toBeNull();
    // No revisions: the cycle's own revision holds the template.
    expect(await db.select().from(planRevisions).where(eq(planRevisions.objectType, "planned_session"))).toEqual([]);
  });

  it("skips a day the user declined before the sessions existed", async () => {
    const id = await cycle();
    await db.insert(dismissedMakeups).values({ userId: me, date: "2026-11-02" });
    await active();
    expect((await rows(id)).find((r) => r.date === "2026-11-02")?.status).toBe("skipped");
  });
});

describe("several sessions a day", () => {
  it("lists today's sessions in order; logging one leaves the other planned", async () => {
    await cycle();
    let info = await active();
    // The run is tracked outside the app: it completes itself.
    expect(info.todaySessions.map((s) => [s.slot.programId, s.done, s.autoSessionId != null])).toEqual([
      [lift, false, false],
      [run, true, true],
    ]);
    expect(info.todaySlot?.programId).toBe(lift);
    const liftRow = (await db.select().from(plannedSessions).where(and(eq(plannedSessions.date, TODAY), eq(plannedSessions.programId, lift))))[0];
    const started = await createWorkoutSession({ date: TODAY, programId: lift, plannedSessionId: liftRow.id });
    if (!started.success) throw new Error(started.error);
    expect(started.data.plannedSessionId).toBe(liftRow.id);
    await completeWorkoutSession({ sessionId: started.data.id });
    info = await active();
    expect(info.todaySessions.map((s) => s.done)).toEqual([true, true]);
  });

  it("misses the second session of a day on its own", async () => {
    const id = await cycle();
    await db.update(trainingCycleSlots).set({ autoComplete: false }).where(eq(trainingCycleSlots.programId, run));
    at("2026-11-06T12:00:00Z");
    await createSession(me, lift, { date: TODAY, startTime: new Date(`${TODAY}T08:00:00Z`), isCompleted: true });
    const info = await active();
    expect(info.missedSlots.map((m) => [m.date, m.slot.programId])).toEqual([
      ["2026-11-02", lift],
      [TODAY, run],
    ]);
    expect((await rows(id)).length).toBe(12);
  });

  it("drops a planned id that is another user's or for another program", async () => {
    const id = await cycle();
    await active();
    const runRow = (await rows(id)).find((r) => r.programId === run)!;
    const wrongProgram = await createWorkoutSession({ date: TODAY, programId: lift, plannedSessionId: runRow.id });
    expect(wrongProgram.success && wrongProgram.data.plannedSessionId).toBeNull();
    asUser((await createUser()).id);
    const other = await createWorkoutSession({ date: TODAY, programId: run, plannedSessionId: runRow.id });
    expect(other.success && other.data.plannedSessionId).toBeNull();
  });

  it("finishing a workout replaces the auto row of its planned session", async () => {
    const id = await cycle();
    await active();
    const runRow = (await rows(id)).find((r) => r.programId === run && r.date === TODAY)!;
    const s = await createWorkoutSession({ date: TODAY, programId: run, plannedSessionId: runRow.id });
    if (!s.success) throw new Error(s.error);
    await completeWorkoutSession({ sessionId: s.data.id });
    const autos = await db.select().from(workoutSessions).where(eq(workoutSessions.source, "auto"));
    expect(autos).toEqual([]);
  });
});

describe("the day's slot rules", () => {
  it("allows three sessions a day, refuses a fourth, a gap and a rest day beside a session", async () => {
    const id = await cycle();
    expect((await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 4, daySlot: 3, programId: strength })).success).toBe(true);
    const fourth = await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 4, daySlot: 4, programId: strength });
    expect(fourth.success).toBe(false);
    const gap = await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, daySlot: 3, programId: strength });
    expect(gap).toEqual({ success: false, error: "Add session 2 of this day first." });
    const rest = await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 4, daySlot: 1, programId: null });
    expect(rest).toEqual({ success: false, error: "A rest day holds no other session. Remove the day's other sessions first." });
  });

  it("closes the gap when a session of the day is removed", async () => {
    const id = await cycle();
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 4, daySlot: 3, programId: strength });
    const [first] = await db.select().from(trainingCycleSlots).where(and(eq(trainingCycleSlots.trainingCycleId, id), eq(trainingCycleSlots.dayOfWeek, 4), eq(trainingCycleSlots.daySlot, 1)));
    await removeCycleSlot(first.id, id);
    const left = await db.select({ p: trainingCycleSlots.programId, n: trainingCycleSlots.daySlot }).from(trainingCycleSlots).where(and(eq(trainingCycleSlots.trainingCycleId, id), eq(trainingCycleSlots.dayOfWeek, 4))).orderBy(asc(trainingCycleSlots.daySlot));
    expect(left).toEqual([{ p: run, n: 1 }, { p: strength, n: 2 }]);
  });
});

describe("regeneration (T7)", () => {
  it("a slot change rewrites untouched sessions from today on; past, touched and done ones stay", async () => {
    const id = await cycle();
    await active();
    const before = await rows(id);
    const moved = before.find((r) => r.date === "2026-11-09")!; // next Monday
    expect((await updatePlannedSession({ op: "move", id: moved.id, date: "2026-11-10" })).success).toBe(true);
    // Monday's program changes to strength.
    expect((await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, programId: strength })).success).toBe(true);
    const after = await rows(id);
    expect(after.find((r) => r.date === "2026-11-02")?.programId).toBe(lift); // past
    expect(after.find((r) => r.id === moved.id)).toMatchObject({ date: "2026-11-10", programId: lift }); // touched
    expect(after.find((r) => r.date === "2026-11-16")?.programId).toBe(strength); // untouched future
    expect(after.find((r) => r.date === "2026-11-16")?.id).toBe(before.find((r) => r.date === "2026-11-16")!.id); // same id
  });

  it("restoring the cycle brings the template's sessions back, from today on", async () => {
    const id = await cycle();
    await active();
    await upsertCycleSlot({ trainingCycleId: id, dayOfWeek: 1, programId: strength });
    expect((await rows(id)).find((r) => r.date === "2026-11-09")?.programId).toBe(strength);
    const [baseline] = await db
      .select({ id: planRevisions.id })
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, id), eq(planRevisions.action, "baseline")));
    expect((await restorePlanRevision({ revisionId: baseline.id })).success).toBe(true);
    const after = await rows(id);
    expect(after.find((r) => r.date === "2026-11-09")?.programId).toBe(lift);
    expect(after.find((r) => r.date === "2026-11-02")?.programId).toBe(lift);
  });

  it("removing a slot removes its untouched future sessions", async () => {
    const id = await cycle();
    await active();
    const [runSlot] = await db.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.programId, run));
    await removeCycleSlot(runSlot.id, id);
    const left = await rows(id);
    // Today's run is done (automatic), so it stays; the three later ones go.
    expect(left.filter((r) => r.programId === run).map((r) => r.date)).toEqual([TODAY]);
  });

  it("starting a draft makes its sessions from today; starting another ends the old one's future", async () => {
    const old = await cycle();
    await active();
    const draft = await cycle("2026-11-02", "draft");
    expect(await rows(draft)).toEqual([]);
    await startTrainingCycle(draft);
    const made = await rows(draft);
    expect(made[0].date).toBe(TODAY);
    expect(made.every((r) => r.date! >= TODAY)).toBe(true);
    const oldLeft = await rows(old);
    expect(oldLeft.map((r) => r.date).every((d) => d! <= TODAY)).toBe(true);
  });
});

describe("changing one session", () => {
  it("move, skip, plan again and reset, each a revision of the session", async () => {
    const id = await cycle();
    await active();
    const r = (await rows(id)).find((x) => x.date === "2026-11-09")!;
    expect((await updatePlannedSession({ op: "move", id: r.id, date: "2026-11-11" })).success).toBe(true);
    expect((await updatePlannedSession({ op: "skip", id: r.id, reason: "Travel" })).success).toBe(true);
    expect((await updatePlannedSession({ op: "unskip", id: r.id })).success).toBe(true);
    expect((await updatePlannedSession({ op: "reset", id: r.id })).success).toBe(true);
    const [back] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, r.id));
    expect(back).toMatchObject({ date: "2026-11-09", status: "planned", touchedAt: null });
    const revs = await db.select().from(planRevisions).where(eq(planRevisions.objectType, "planned_session")).orderBy(asc(planRevisions.id));
    expect(revs.map((x) => [x.action, x.writer])).toEqual([
      ["baseline", "user"],
      ["update", "user"],
      ["update", "user"],
      ["update", "user"],
      ["update", "user"],
    ]);
    // Restore the skipped version.
    expect((await restorePlanRevision({ revisionId: revs[2].id })).success).toBe(true);
    const [restored] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, r.id));
    expect(restored).toMatchObject({ date: "2026-11-11", status: "skipped", skipReason: "Travel" });
  });

  it("a skipped missed session leaves the missed list", async () => {
    const id = await cycle();
    expect((await active()).missedSlots.map((m) => m.date)).toEqual(["2026-11-02"]);
    const monday = (await rows(id)).find((x) => x.date === "2026-11-02")!;
    await updatePlannedSession({ op: "skip", id: monday.id });
    expect((await active()).missedSlots).toEqual([]);
  });

  it("a missed session moves forward, not to a past day; a logged one does not change", async () => {
    const id = await cycle();
    await active();
    const monday = (await rows(id)).find((x) => x.date === "2026-11-02")!;
    expect(await updatePlannedSession({ op: "move", id: monday.id, date: "2026-11-03" })).toEqual({
      success: false,
      error: "A session cannot move to a past day.",
    });
    expect((await updatePlannedSession({ op: "move", id: monday.id, date: "2026-11-06" })).success).toBe(true);
    expect((await active()).missedSlots).toEqual([]);
    // Logged: today's lift.
    const thu = (await rows(id)).find((x) => x.date === TODAY && x.programId === lift)!;
    await createSession(me, lift, { date: TODAY, isCompleted: true, plannedSessionId: thu.id });
    expect(await updatePlannedSession({ op: "skip", id: thu.id })).toEqual({
      success: false,
      error: "This session is logged; past sessions do not change.",
    });
  });

  it("refuses another user's session and changes nothing", async () => {
    const id = await cycle();
    await active();
    const r = (await rows(id))[5];
    asUser((await createUser()).id);
    expect(await updatePlannedSession({ op: "skip", id: r.id })).toEqual({ success: false, error: "Session not found" });
    const list = await getPlannedSessions({ from: "2026-11-02", to: "2026-11-30" });
    expect(list.success && list.data).toEqual([]);
    const [same] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, r.id));
    expect(same.status).toBe("planned");
  });

  it("adds a session by hand, at most three a day, and removes it", async () => {
    const id = await cycle();
    await active();
    const added = await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-07", programId: strength });
    expect(added.success).toBe(true);
    const third = await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-12", programId: strength });
    expect(third.success).toBe(true);
    expect(await updatePlannedSession({ op: "add", cycleId: id, date: "2026-11-12", programId: strength })).toEqual({
      success: false,
      error: "A day holds at most 3 sessions.",
    });
    if (!added.success) return;
    expect((await updatePlannedSession({ op: "remove", id: added.data.id })).success).toBe(true);
    expect((await rows(id)).some((r) => r.id === added.data.id)).toBe(false);
  });
});

describe("listing", () => {
  it("reads done, missed, planned and skipped in a range", async () => {
    const id = await cycle();
    await active();
    const r = await getPlannedSessions({ from: "2026-11-02", to: "2026-11-09" });
    if (!r.success) throw new Error(r.error);
    expect(r.data.map((p) => [p.date, p.programId, p.status])).toEqual([
      ["2026-11-02", lift, "missed"],
      [TODAY, lift, "planned"],
      [TODAY, run, "done"],
      ["2026-11-09", lift, "planned"],
    ]);
    expect(r.data.every((p) => p.cycleId === id)).toBe(true);
    expect(await getPlannedSessions({ from: "2026-11-02", to: "2027-11-02" })).toMatchObject({ success: false });
  });
});

describe("the purge", () => {
  it("deletes a removed session after 90 days, unless a workout was started for it", async () => {
    const id = await cycle();
    await active();
    const [a, b] = await rows(id);
    const old = new Date("2026-07-01T00:00:00Z");
    await db.update(plannedSessions).set({ deletedAt: old }).where(eq(plannedSessions.id, a.id));
    await db.update(plannedSessions).set({ deletedAt: old }).where(eq(plannedSessions.id, b.id));
    await createSession(me, lift, { date: "2026-11-02", isCompleted: true, plannedSessionId: b.id });
    await purgePlanRevisions(new Date(`${TODAY}T12:00:00Z`));
    const left = await db.select({ id: plannedSessions.id }).from(plannedSessions).where(eq(plannedSessions.cycleId, id));
    expect(left.some((r) => r.id === a.id)).toBe(false);
    expect(left.some((r) => r.id === b.id)).toBe(true);
  });
});
