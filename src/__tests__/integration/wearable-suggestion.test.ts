import { db } from "@/db";
import { garminDailyMetrics, programSets, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { applyWearablePlanSuggestion, syncActiveCyclePeriodization } from "@/lib/actions/training-cycles";
import { wearableSuggestion } from "@/lib/periodization-sync";
import { toDateStr } from "@/lib/utils/cycle-position";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Wearable signals as a suggestion on the weekly plan (plan 2.14, decision
 * O-3): the sync ignores them; the suggestion reads them; Apply re-scales this
 * week with the suggested percent.
 */

let userId: string;
let cycleId: number;
let setId: number;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

async function garminDay(daysBack: number, hrvState: string) {
  await db.insert(garminDailyMetrics).values({
    userId,
    day: toDateStr(daysAgo(daysBack)),
    modelVersion: 2,
    metrics: { hrv: { state: hrvState }, restingHr: { flag: false }, sleepDebtS: 0, ramp: 2, pmc: { total: { load: 50 } } },
  });
}

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  const run = await createExercise({ name: "Run", category: "cardio", discipline: "run" });
  const { program, slots } = await createProgram(userId, [{ exerciseId: run.id, sets: [{ targetReps: null, weightKg: "0", distanceMeters: 10000, peakDistanceMeters: 10000 }] }]);
  setId = slots[0].setIds[0];
  // Week 3 of a flat "maintain" triathlon block, so the curve is 1 and only the nudge moves the target.
  const [c] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Tri", durationWeeks: 12, scheduleType: "rotation", goal: "maintain", athleteLevel: "intermediate", status: "active", startDate: toDateStr(daysAgo(15)) })
    .returning();
  cycleId = c.id;
  await db.insert(trainingCycleSlots).values({ trainingCycleId: cycleId, programId: program.id, orderIndex: 0 });
  // One completed session in the last week: full adherence, no readiness or RPE logged, so the plain nudge pushes to 105.
  await createSession(userId, program.id, { isCompleted: true, date: toDateStr(daysAgo(1)) });
});

const distance = async () => (await db.select({ d: programSets.distanceMeters }).from(programSets).where(eq(programSets.id, setId)))[0].d;
const pct = async () => (await db.select({ p: trainingCycles.adaptationPct }).from(trainingCycles).where(eq(trainingCycles.id, cycleId)))[0].p;

describe("wearable suggestion", () => {
  it("leaves the weekly sync alone, suggests easing when HRV is fatigued, and Apply scales this week", async () => {
    await garminDay(0, "fatigued");
    await syncActiveCyclePeriodization();
    expect(await pct()).toBe(105);
    expect(await distance()).toBe(10500);

    const s = await wearableSuggestion(userId);
    expect(s).toMatchObject({ pct: 88, current: 105, cycleId, week: 3 });

    expect(await applyWearablePlanSuggestion()).toEqual({ success: true, data: { pct: 88, note: expect.stringMatching(/HRV/) } });
    expect(await pct()).toBe(88);
    expect(await distance()).toBe(8800);
    // Applied: nothing left to suggest.
    expect(await wearableSuggestion(userId)).toBeNull();
  });

  it("suggests nothing without Garmin data, with stale data, or when the signals agree", async () => {
    expect(await wearableSuggestion(userId)).toBeNull();
    await garminDay(5, "fatigued");
    expect(await wearableSuggestion(userId)).toBeNull();
    await garminDay(0, "balanced");
    expect(await wearableSuggestion(userId)).toBeNull();
    expect(await applyWearablePlanSuggestion()).toEqual({ success: true, data: null });
    expect(await pct()).toBe(105);
  });

  it("only reads the signed-in user's own data", async () => {
    await garminDay(0, "fatigued");
    asUser((await createUser()).id);
    expect(await applyWearablePlanSuggestion()).toEqual({ success: true, data: null });
    expect(await pct()).toBe(100);
  });
});
