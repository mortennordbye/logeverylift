import { db } from "@/db";
import { plannedSessions, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * A missed key session moves to the day the app suggested (D19). A stale tab
 * can send a suggestion that is no longer free: the server checks the day
 * again and refuses, so two key sessions never stack on one day. The clock is
 * fixed at Thu 2026-11-05 12:00 UTC.
 */

const TODAY = "2026-11-05";
let me: string;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

async function twoMissedKeys() {
  const runEx = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
  // 90 min: a long run is a key session.
  const { program } = await createProgram(me, [{ exerciseId: runEx, sets: [{ durationSeconds: 5400, targetReps: null, weightKg: null }] }]);
  const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: c.id, daySlot: 1, dayOfWeek: 2, programId: program.id },
    { trainingCycleId: c.id, daySlot: 1, dayOfWeek: 3, programId: program.id },
  ]);
  await getActiveCycleForUser();
  const rows = await db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, c.id), isNull(plannedSessions.deletedAt)))
    .orderBy(asc(plannedSessions.date));
  const tue = rows.find((r) => r.date === "2026-11-03")!;
  const wed = rows.find((r) => r.date === "2026-11-04")!;
  expect(await updatePlannedSession({ op: "miss", id: tue.id })).toMatchObject({ success: true });
  expect(await updatePlannedSession({ op: "miss", id: wed.id })).toMatchObject({ success: true });
  return { tue, wed };
}

describe("moving a missed key session to the suggested day", () => {
  it("refuses a stale suggestion when another key session took the day", async () => {
    const { tue, wed } = await twoMissedKeys();
    // Both tabs suggest Thu: tab A moves Tue there first.
    expect(await updatePlannedSession({ op: "move", id: tue.id, date: TODAY, suggested: true })).toMatchObject({ success: true });

    // Tab B still shows "Move to Thu 5 Nov" for Wed.
    const stale = await updatePlannedSession({ op: "move", id: wed.id, date: TODAY, suggested: true });
    expect(stale).toEqual({ success: false, error: "That day is not free any more. Close this and open the session again for a new day." });
    const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, wed.id));
    expect(row.date).toBe("2026-11-04");

    // Sat has no hard day next to it: the new suggestion still moves.
    expect(await updatePlannedSession({ op: "move", id: wed.id, date: "2026-11-07", suggested: true })).toMatchObject({ success: true });
  });

  it("refuses a suggested day next to a key session", async () => {
    const { tue, wed } = await twoMissedKeys();
    expect(await updatePlannedSession({ op: "move", id: tue.id, date: TODAY, suggested: true })).toMatchObject({ success: true });
    const r = await updatePlannedSession({ op: "move", id: wed.id, date: "2026-11-06", suggested: true });
    expect(r).toMatchObject({ success: false });
  });
});
