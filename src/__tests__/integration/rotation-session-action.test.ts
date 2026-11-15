import { db } from "@/db";
import { plannedSessions, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { getPlannedSessions, updateRotationSession } from "@/lib/actions/planned-sessions";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * updateRotationSession: the cycle detail skips, plans again and changes one
 * coming rotation session by its walk position (docs/plans/sessions.md, 4.3).
 * The app sends no version; a stored change on the position is written on
 * top. The clock is fixed at Thu 2026-11-05 12:00 UTC; the zone is UTC.
 */

const TODAY = "2026-11-05";
let me: string;
let upper: number;
let lower: number;
let other: number;
let cycleId: number;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  const ex = await createExercise();
  const make = async () => (await createProgram(me, [{ exerciseId: ex.id, sets: [{}] }])).program.id;
  upper = await make();
  lower = await make();
  other = await make();
  const [c] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Upper / Lower", durationWeeks: 4, status: "active", startDate: "2026-11-02", scheduleType: "rotation" })
    .returning();
  cycleId = c.id;
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: c.id, orderIndex: 1, programId: upper },
    { trainingCycleId: c.id, orderIndex: 2, programId: lower },
  ]);
});

afterEach(() => vi.useRealTimers());

async function walk() {
  const r = await getPlannedSessions({ from: TODAY, to: "2026-11-08", cycleId });
  if (!r.success) throw new Error(r.error);
  return r.data;
}

const overrides = () =>
  db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt)));

describe("updateRotationSession", () => {
  it("skips today's session, and the next one in the order moves up to today", async () => {
    expect((await walk())[0]).toMatchObject({ date: TODAY, rotationPosition: 0, programId: upper, status: "planned" });
    const r = await updateRotationSession({ op: "skip", cycleId, rotationPosition: 0 });
    expect(r.success).toBe(true);
    expect(await overrides()).toEqual([expect.objectContaining({ rotationPosition: 0, status: "skipped" })]);
    // The skip uses up the first missed day of the walk, so today is position 1.
    expect((await walk())[0]).toMatchObject({ date: TODAY, rotationPosition: 1, programId: lower, status: "planned" });
  });

  it("changes a session's program, then skips it and plans it again, with no version from the app", async () => {
    const changed = await updateRotationSession({ op: "change", cycleId, rotationPosition: 1, programId: other });
    expect(changed.success).toBe(true);
    expect((await walk()).find((d) => d.rotationPosition === 1)).toMatchObject({ programId: other, touched: true });

    // A stored change exists on position 1: the action reads its version.
    expect((await updateRotationSession({ op: "skip", cycleId, rotationPosition: 1 })).success).toBe(true);
    expect((await walk()).find((d) => d.rotationPosition === 1)?.status).toBe("skipped");

    expect((await updateRotationSession({ op: "unskip", cycleId, rotationPosition: 1 })).success).toBe(true);
    expect(await overrides()).toHaveLength(0);
    expect((await walk()).find((d) => d.rotationPosition === 1)).toMatchObject({ status: "planned", programId: lower });
  });

  it("refuses to plan again a session that is not skipped", async () => {
    const r = await updateRotationSession({ op: "unskip", cycleId, rotationPosition: 0 });
    expect(r).toEqual({ success: false, error: "That session is not skipped." });
  });

  it("refuses a change without a program", async () => {
    const r = await updateRotationSession({ op: "change", cycleId, rotationPosition: 0 });
    expect(r.success).toBe(false);
    expect(await overrides()).toHaveLength(0);
  });

  it("refuses another user's cycle and changes nothing", async () => {
    asUser((await createUser({ timeZone: "UTC" })).id);
    const r = await updateRotationSession({ op: "skip", cycleId, rotationPosition: 0 });
    expect(r).toEqual({ success: false, error: "Cycle not found" });
    asUser(me);
    expect(await overrides()).toHaveLength(0);
  });

  it("refuses to change to another user's program", async () => {
    const stranger = (await createUser({ timeZone: "UTC" })).id;
    const ex = await createExercise();
    const theirs = (await createProgram(stranger, [{ exerciseId: ex.id, sets: [{}] }])).program.id;
    const r = await updateRotationSession({ op: "change", cycleId, rotationPosition: 0, programId: theirs });
    expect(r.success).toBe(false);
    expect(await overrides()).toHaveLength(0);
  });
});
