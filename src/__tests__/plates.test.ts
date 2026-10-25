import { describe, expect, it } from "vitest";
import { formatPlates, platesPerSide, warmupRamp } from "@/lib/utils/plates";

describe("platesPerSide", () => {
  it("loads nothing on the empty bar", () => {
    expect(platesPerSide(20)).toEqual({ perSide: [], remainderKg: 0 });
  });

  it("takes the largest plates first", () => {
    expect(platesPerSide(60)).toEqual({ perSide: [20], remainderKg: 0 });
    expect(platesPerSide(142.5)).toEqual({ perSide: [25, 25, 10, 1.25], remainderKg: 0 });
  });

  it("uses the small change plates exactly", () => {
    expect(platesPerSide(61.25)).toEqual({ perSide: [20], remainderKg: 1.25 });
    expect(platesPerSide(62.5)).toEqual({ perSide: [20, 1.25], remainderKg: 0 });
  });

  it("returns no plates below the bar", () => {
    expect(platesPerSide(15)).toEqual({ perSide: [], remainderKg: 0 });
  });

  it("honours another bar and plate set", () => {
    expect(platesPerSide(35, 15, [10, 5])).toEqual({ perSide: [10], remainderKg: 0 });
  });
});

describe("formatPlates", () => {
  it("reads out the plates per side", () => {
    expect(formatPlates(52.5)).toBe("15 + 1.25 per side");
  });

  it("says when the bar is empty", () => {
    expect(formatPlates(20)).toBe("Empty bar");
  });

  it("says what can't be loaded", () => {
    expect(formatPlates(61)).toBe("20 per side, 1 kg short");
  });

  it("has nothing to say below the bar", () => {
    expect(formatPlates(15)).toBeNull();
  });
});

describe("warmupRamp", () => {
  it("ramps 100 kg in four steps", () => {
    expect(warmupRamp(100)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 40, reps: 5 },
      { weightKg: 60, reps: 3 },
      { weightKg: 80, reps: 2 },
    ]);
  });

  it("rounds each step to 2.5 kg", () => {
    expect(warmupRamp(200)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 80, reps: 5 },
      { weightKg: 120, reps: 3 },
      { weightKg: 160, reps: 2 },
    ]);
    expect(warmupRamp(107.5).map((s) => s.weightKg)).toEqual([20, 42.5, 65, 85]);
  });

  it("drops steps below the bar", () => {
    // 40% of 40 is 16 kg, lighter than the bar.
    expect(warmupRamp(40)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 25, reps: 3 },
      { weightKg: 32.5, reps: 2 },
    ]);
  });

  it("drops a step that repeats the one before", () => {
    // 40% of 50 kg is 20 kg, the empty bar again.
    expect(warmupRamp(50).map((s) => s.weightKg)).toEqual([20, 30, 40]);
  });

  it("gives a light working weight only the bar", () => {
    expect(warmupRamp(37.5)).toEqual([{ weightKg: 20, reps: 10 }]);
  });

  it("has nothing to ramp to at the bar", () => {
    expect(warmupRamp(20)).toEqual([]);
  });
});
