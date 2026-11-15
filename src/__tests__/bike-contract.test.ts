import { describe, expect, it } from "vitest";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { LONG_RIDE_WORKOUT, TEMPO_LAPS_5, TEMPO_LAPS_7, TEMPO_WORKOUT } from "./fixtures/bike-sessions";

describe("bike contract (docs/plans/bike-sessions.md 10.2)", () => {
  it("parses both bike fixtures", () => {
    expect(parseWorkout(TEMPO_WORKOUT)).toMatchObject({ ok: true });
    expect(parseWorkout(LONG_RIDE_WORKOUT)).toMatchObject({ ok: true });
  });

  it("accepts a one-sided range and rejects an empty one", () => {
    const w = (target: object) => ({ v: 1, sport: "bike", name: "x", steps: [{ type: "work", end: { type: "time", seconds: 60 }, target }] });
    expect(parseWorkout(w({ metric: "hr", anchor: "absolute", high: 140 }))).toMatchObject({ ok: true });
    expect(parseWorkout(w({ metric: "hr", anchor: "absolute" }))).toMatchObject({ ok: false });
  });

  it("rejects a second target on the main target's metric, or with no main target", () => {
    const step = (s: object) => ({ v: 1, sport: "bike", name: "x", steps: [{ type: "work", end: { type: "time", seconds: 60 }, ...s }] });
    const power = { metric: "power", anchor: "ftp", low: 70, high: 80 };
    expect(parseWorkout(step({ target: power, secondary: power }))).toMatchObject({ ok: false });
    expect(parseWorkout(step({ secondary: { metric: "hr", anchor: "absolute", high: 140 } }))).toMatchObject({ ok: false });
  });

  it("keeps gradePercent to bike", () => {
    const w = (sport: string) => ({ v: 1, sport, name: "x", steps: [{ type: "work", end: { type: "time", seconds: 60 }, gradePercent: 4 }] });
    expect(parseWorkout(w("bike"))).toMatchObject({ ok: true });
    expect(parseWorkout(w("run"))).toMatchObject({ ok: false });
  });

  it("has lap fixtures that cover 65 min", () => {
    const total = (laps: { totalTimerTime: number }[]) => laps.reduce((a, l) => a + l.totalTimerTime, 0);
    expect(Math.round(total(TEMPO_LAPS_5) / 60)).toBe(65);
    expect(total(TEMPO_LAPS_7)).toBe(total(TEMPO_LAPS_5));
  });
});
