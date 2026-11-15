import { describe, expect, it } from "vitest";
import { carbsTarget, ftpFromTwenty, ftpTestStepKey, minutesOf } from "@/components/features/bike/after/view";
import { ftpTestWorkout } from "@/lib/utils/workout-templates";
import type { Workout, WorkoutStep } from "@/lib/utils/workout-steps";

const step = (seconds: number, note?: string): WorkoutStep => ({ type: "work", end: { type: "time", seconds }, ...(note && { note }) }) as WorkoutStep;
const workout = (name: string) => ({ v: 1, sport: "bike", name, steps: [] }) as unknown as Workout;

describe("after-ride view helpers", () => {
  it("prints done of planned minutes", () => {
    expect(minutesOf(3912, 3900)).toBe("65 of 65 min");
    expect(minutesOf(null, 3900)).toBeNull();
  });

  it("gives 40-60 g carbs per hour", () => {
    expect(carbsTarget(8100)).toEqual({ low: 90, high: 135 });
  });

  it("finds the 20 min all-out step of an FTP test", () => {
    const keyed = [
      { key: "s1", step: step(300, "hard") },
      { key: "s2", step: step(1200, "20 min all out, steady") },
    ];
    expect(ftpTestStepKey(workout("Test"), keyed)).toBe("s2");
    expect(ftpTestStepKey(workout("FTP test"), [{ key: "s3", step: step(1200) }])).toBe("s3");
    expect(ftpTestStepKey(workout("Threshold 2 x 20"), [{ key: "a", step: step(1200) }, { key: "b", step: step(1200) }])).toBeNull();
    expect(ftpFromTwenty(196)).toBe(186);
  });

  it("finds the step of the FTP test template", () => {
    const w = ftpTestWorkout() as unknown as Workout;
    const keyed = w.steps.flatMap((n, i) => (n.type === "repeat" ? [] : [{ key: n.id ?? `s${i}`, step: n }]));
    expect(ftpTestStepKey(w, keyed)).toBe("ftp20");
  });
});
