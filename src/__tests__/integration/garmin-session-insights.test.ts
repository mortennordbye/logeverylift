import { db } from "@/db";
import { trainingCycleSlots, trainingCycles, workoutSets } from "@/db/schema";
import { getSessionInsights, type VolumeData } from "@/lib/garmin/queries";
import { ensureCycleSessions } from "@/lib/planned-sessions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";

/**
 * strength_before_key against a real database (plan 4.1): heavy leg sets in
 * yesterday's logged workouts and a key run or ride planned today. The clock
 * is fixed at Thu 2026-11-05 12:00 UTC; users are in UTC.
 */

const TODAY = "2026-11-05";
const YESTERDAY = "2026-11-04";
const MIN = 60;
// getSessionInsights reads only the checklist from the volume data.
const volume = { checklist: [] } as unknown as VolumeData;

let me: string;
let bike: number;
let squat: number;
let bench: number;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Ride ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  squat = (await createExercise({ name: `Squat ${Math.random()}`, bodyArea: "lower_body", movementPattern: "squat", equipment: "barbell" })).id;
  bench = (await createExercise({ name: `Bench ${Math.random()}`, bodyArea: "upper_body", movementPattern: "push", equipment: "barbell" })).id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

/** A weekday cycle with a ride on Thursday (today): hard (a work interval) or easy. */
async function rideToday(userId: string, hard: boolean) {
  const sets = hard
    ? [{ durationSeconds: 40 * MIN, targetReps: null }, { durationSeconds: 10 * MIN, sessionRole: "work", targetReps: null }]
    : [{ durationSeconds: 40 * MIN, targetReps: null }];
  const { program } = await createProgram(userId, [{ exerciseId: bike, sets }]);
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
  await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 4, programId: program.id, label: "Threshold ride" });
  await ensureCycleSessions(userId, c.id);
}

/** A completed workout yesterday with three working sets of 5 on the exercise. */
async function liftedYesterday(userId: string, exerciseId: number) {
  const s = await createSession(userId, null, { date: YESTERDAY, startTime: new Date(`${YESTERDAY}T17:00:00Z`), isCompleted: true });
  await db.insert(workoutSets).values([1, 2, 3].map((setNumber) => ({ sessionId: s.id, exerciseId, setNumber, actualReps: 5, weightKg: "100", restTimeSeconds: 120 })));
}

const fired = async (userId: string) => (await getSessionInsights(userId, volume, TODAY)).filter((i) => i.id === "strength_before_key");

describe("getSessionInsights strength_before_key", () => {
  it("fires for heavy legs yesterday before today's key ride", async () => {
    await rideToday(me, true);
    await liftedYesterday(me, squat);
    const out = await fired(me);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Heavy legs yesterday (3 heavy leg sets). Expect lower power in Threshold ride today.");
  });

  it("stays silent after upper body, before an easy ride, and with no plan", async () => {
    await rideToday(me, true);
    await liftedYesterday(me, bench);
    expect(await fired(me)).toEqual([]);

    const easy = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    await rideToday(easy, false);
    await liftedYesterday(easy, squat);
    expect(await fired(easy)).toEqual([]);

    const noPlan = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    await liftedYesterday(noPlan, squat);
    expect(await fired(noPlan)).toEqual([]);
  });

  it("counts only the user's own lifts", async () => {
    await rideToday(me, true);
    const other = (await createUser({ timeZone: "UTC" })).id;
    await liftedYesterday(other, squat);
    expect(await fired(me)).toEqual([]);
  });
});
