import { describe, expect, it } from "vitest";
import { autoLapKm, bigTarget, ftpChips, hrChip, powerSub, rangeText, recordLines, recordShort, stepCount } from "@/lib/utils/bike-view";
import { parseWorkout, type ResolvedForms, type ResolvedStep, type Workout } from "@/lib/utils/workout-steps";
import { LONG_RIDE_WORKOUT, TEMPO_LAPS_5, TEMPO_LAPS_7, TEMPO_WORKOUT, WATCH_FTP } from "./fixtures/bike-sessions";

const parsed = (w: unknown): Workout => {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error("fixture does not parse");
  return r.workout;
};
const tempo = parsed(TEMPO_WORKOUT);
const long = parsed(LONG_RIDE_WORKOUT);

describe("Record on Garmin", () => {
  it("tempo: 5 steps, press Lap 4 times, keep recording in the easy step", () => {
    expect(stepCount(tempo)).toBe(5);
    expect(recordLines(tempo, null)).toEqual([
      "Activity: Indoor Bike. Pair the trainer for watts.",
      "Auto Lap off.",
      "Auto Pause off.",
      "Start at the warm-up. Press Lap at each step change: 4 times.",
      "Keep recording in the easy step. Stop after the cool-down.",
    ]);
  });

  it("names Auto Lap when the last ride had distance laps", () => {
    expect(recordLines(tempo, 5)[1]).toBe("Auto Lap off. It is on now: your last ride has a lap every 5 km.");
  });

  it("long ride: repeats count each round, 7 steps, press Lap 6 times, no easy step", () => {
    expect(stepCount(long)).toBe(7);
    const lines = recordLines(long, null);
    expect(lines[3]).toBe("Start at the warm-up. Press Lap at each step change: 6 times.");
    expect(lines[4]).toBe("Stop after the cool-down.");
  });

  it("one step: no Lap presses", () => {
    const one = parsed({ v: 1, sport: "bike", name: "x", steps: [{ type: "steady", end: { type: "time", seconds: 600 } }] });
    expect(recordLines(one, null)[3]).toBe("Start at the first step. Do not press Lap.");
    expect(recordLines(one, null)[4]).toBe("Stop after the last step.");
  });

  it("short form for the player", () => {
    expect(recordShort(tempo, null)).toBe("Indoor Bike · Auto Lap off · Auto Pause off · press Lap 4 times");
    expect(recordShort(tempo, 5)).toBe("Indoor Bike · Auto Lap off (it is on now) · Auto Pause off · press Lap 4 times");
  });

  it("reads Auto Lap from a ride's laps", () => {
    expect(autoLapKm(TEMPO_LAPS_7)).toBe(5);
    expect(autoLapKm(TEMPO_LAPS_5)).toBeNull();
    expect(autoLapKm(null)).toBeNull();
  });
});

describe("step card parts", () => {
  const forms: ResolvedForms = { watts: { low: 135, high: 144 }, pctFtp: { low: 75, high: 80 }, powerZone: 3, bpm: null, hrZone: null, hrZoneSource: null };
  const hrForms: ResolvedForms = { watts: null, pctFtp: null, powerZone: null, bpm: { low: 141, high: 160 }, hrZone: 3, hrZoneSource: "garmin" };
  const step = {
    type: "work",
    end: { type: "time", seconds: 900 },
    resolved: { low: 135, high: 144, unit: "W", text: "135-144 W", missing: null, forms },
    resolvedSecondary: { low: 141, high: 160, unit: "bpm", text: "141-160 bpm", missing: null, forms: hrForms },
  } as ResolvedStep;

  it("big watts, % FTP and power zone, HR chip with the Garmin zone", () => {
    expect(bigTarget(step.resolved)).toEqual({ value: "135-144", unit: "W" });
    expect(powerSub(step.resolved)).toBe("75-80 % FTP · power Z3");
    expect(hrChip(step)).toBe("141-160 bpm · Garmin Z3");
  });

  it("before the resolver gives forms: the plain text, no zone", () => {
    const plain = { ...step, resolved: { ...step.resolved!, forms: null }, resolvedSecondary: { low: null, high: 140, unit: "bpm", text: "up to 140 bpm", missing: null, forms: null } } as ResolvedStep;
    expect(powerSub(plain.resolved)).toBeNull();
    expect(hrChip(plain)).toBe("under 140 bpm");
  });

  it("range text", () => {
    expect(rangeText({ low: 134.6, high: 144.2 })).toBe("135-144");
    expect(rangeText({ low: null, high: 140 })).toBe("under 140");
    expect(rangeText({ low: 200, high: null })).toBe("over 200");
  });
});

describe("FTP chips", () => {
  it("names the source and warns when the watch differs by more than 5 %", () => {
    expect(ftpChips({ ftp: { value: 186, basis: "best 60 min", source: "garmin", changedFrom: null }, watchFtp: WATCH_FTP, zones: null })).toEqual([
      { text: "FTP 186 W · from your rides", warn: false },
      { text: "Watch FTP differs: 266 W", warn: true },
    ]);
    expect(ftpChips({ ftp: { value: 180, basis: null, source: "manual", changedFrom: null }, watchFtp: 185, zones: null })).toEqual([{ text: "FTP 180 W", warn: false }]);
    expect(ftpChips({ ftp: null, watchFtp: null, zones: null })).toEqual([]);
  });
});
