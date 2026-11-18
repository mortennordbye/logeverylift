/**
 * "Save the ride" after a ride that ended while the app was closed
 * (docs/plans/bike-ride-logger.md, section 9): the summary offers it while
 * the workout is open and a ridden step has no row yet, also in a program
 * with more exercises, where it saves the ride and leaves the workout open.
 */
import { db } from "@/db";
import { athleteThresholds } from "@/db/schema";
import { getRide, startRide } from "@/lib/actions/rides";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { rideAfterView } from "@/lib/bike-exercise-view";
import { offersSaveTheRide } from "@/lib/utils/ride-results";
import { workoutToRows } from "@/lib/utils/program-steps";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";
import { asUser } from "./setup";

const T0 = new Date("2026-11-17T17:00:00Z").getTime();
let me: string;
let bike: number;
let squat: number;

const ride = {
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 } },
    { type: "cooldown", end: { type: "time", seconds: 300 } },
  ],
};

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  me = (await createUser({ enduranceEnabled: true, timeZone: "UTC" })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  squat = (await createExercise({ name: `Squat ${Math.random()}` })).id;
  await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
  asUser(me);
});
afterEach(() => vi.useRealTimers());

describe("Save the ride", () => {
  it("a multi-exercise ride that ended with the app closed is unsaved until its steps have rows", async () => {
    const parsed = parseWorkout(ride);
    if (!parsed.ok) throw new Error("ride");
    const steps = workoutToRows(parsed.workout).map((r) => ({ ...r, targetReps: null, weightKg: null, restTimeSeconds: 0 }));
    const { program, slots } = await createProgram(me, [
      { exerciseId: squat, sets: [{}] },
      { exerciseId: bike, sets: steps },
    ]);
    const session = await createSession(me, program.id);
    const pe = slots[1].programExerciseId;
    ok(await startRide({ sessionId: session.id, programExerciseId: pe, mode: "indoor", clientId: "s1" }));

    // The app was closed; the ride ran out on the clock.
    vi.setSystemTime(T0 + 1000 * 1000);
    // The page reads the active ride first (bikeExerciseView), which stores it as ended.
    expect(ok(await getRide({}))).toBeNull();
    const after = await rideAfterView(me, pe);
    expect(after).toMatchObject({ status: "finished", sessionOpen: true, unsaved: true });
    expect(offersSaveTheRide(after!, false)).toBe(true);

    for (const [i, id] of slots[1].setIds.entries()) {
      ok(
        await logWorkoutSet({
          sessionId: session.id,
          exerciseId: bike,
          setNumber: i + 1,
          programSetId: id,
          actualReps: 0,
          weightKg: 0,
          durationSeconds: i === 0 ? 600 : 300,
          restTimeSeconds: 0,
          isCompleted: true,
          stepStatus: "done",
          targetOffsetW: 0,
          extendedSeconds: 0,
          sources: { durationSeconds: "clock" },
        }),
      );
    }
    const saved = await rideAfterView(me, pe);
    expect(saved?.unsaved).toBe(false);
    // Saved, in a program with more exercises: Done goes to the workout, the rider finishes it there.
    expect(offersSaveTheRide(saved!, false)).toBe(false);
    // A one-exercise program still offers it while its workout is open: it finishes the workout.
    expect(offersSaveTheRide(saved!, true)).toBe(true);
    expect(offersSaveTheRide({ ...saved!, sessionOpen: false }, true)).toBe(false);
  });
});
