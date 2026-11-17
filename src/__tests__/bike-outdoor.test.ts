import { outdoorTarget, powerLowPct, powerZone } from "@/lib/utils/bike-outdoor";
import type { WorkoutStep } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** Derived outdoor targets (docs/plans/bike-ride-logger.md, 4.2). LTHR 171, FTP 180. */
const withHr = { ftp: 180, lthr_bike: 171 };
const time = (seconds: number) => ({ type: "time" as const, seconds });
const work = (low: number, high: number, seconds = 900): WorkoutStep => ({ type: "work", end: time(seconds), target: { metric: "power", anchor: "ftp", low, high } });

describe("powerZone", () => {
  it("uses the zone table's low ends, with zones 6 and 7 above it", () => {
    expect([54, 55, 74.9, 75, 89, 90, 104, 105, 120, 121, 150, 151].map(powerZone)).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);
  });
  it("takes the low end of a range, a zone or a ramp, and watts over the FTP", () => {
    expect(powerLowPct(work(75, 80), 180)).toBe(75);
    expect(powerLowPct({ target: { metric: "power", anchor: "ftp", zone: 3 } }, 180)).toBe(75);
    expect(powerLowPct({ ramp: { anchor: "ftp", from: 70, to: 50 } }, 180)).toBe(50);
    expect(powerLowPct({ target: { metric: "power", anchor: "absolute", low: 90, high: 100 } }, 180)).toBe(50);
    expect(powerLowPct({ target: { metric: "power", anchor: "absolute", low: 90, high: 100 } }, undefined)).toBeNull();
  });
});

describe("outdoorTarget", () => {
  it("warm-up, cool-down and ramp: a heart rate cap at 81% LTHR", () => {
    const ramp: WorkoutStep = { type: "work", end: time(900), ramp: { anchor: "ftp", from: 55, to: 75 } };
    for (const s of [ramp, { ...work(55, 70), type: "warmup" as const }, { ...work(50, 60), type: "cooldown" as const }]) {
      expect(outdoorTarget(s, 900, withHr)).toEqual({ main: { low: null, high: 139, unit: "bpm", text: "HR under 139", missing: null }, second: null });
    }
  });
  it("recovery, zone 1 and free spin: effort 2", () => {
    const easy = { main: expect.objectContaining({ text: "Effort 2", unit: "RPE" }), second: null };
    expect(outdoorTarget({ type: "recovery", end: time(300), target: { metric: "power", anchor: "ftp", zone: 1 } }, 300, withHr)).toEqual(easy);
    expect(outdoorTarget(work(40, 50), 900, withHr)).toEqual(easy);
    expect(outdoorTarget({ type: "work", end: time(600), free: true }, 600, withHr)).toEqual(easy);
  });
  it("work of 5 min or more in zone 2 to 4: the heart rate range of the same zone", () => {
    expect(outdoorTarget(work(60, 70), 900, withHr)?.main.text).toBe("HR 139-152");
    expect(outdoorTarget(work(75, 80), 300, withHr)?.main.text).toBe("HR 154-159");
    expect(outdoorTarget(work(95, 100), 600, withHr)).toEqual({ main: expect.objectContaining({ low: 161, high: 169, text: "HR 161-169" }), second: null });
  });
  it("work of 3 to 5 min in zone 2 to 4: the heart rate range and the effort as a second line", () => {
    expect(outdoorTarget(work(91, 95), 240, withHr)).toEqual({ main: expect.objectContaining({ text: "HR 161-169" }), second: expect.objectContaining({ text: "Effort 7" }) });
  });
  it("work under 3 min, or zone 5 and above: an effort", () => {
    expect(outdoorTarget(work(110, 120), 600, withHr)?.main.text).toBe("Effort 8");
    expect(outdoorTarget(work(130, 140), 120, withHr)?.main.text).toBe("Effort 9");
    expect(outdoorTarget(work(160, 170), 30, withHr)?.main.text).toBe("Effort 10");
    expect(outdoorTarget(work(80, 85), 120, withHr)?.main.text).toBe("Effort 6");
  });
  it("without a bike LTHR, heart rate targets become efforts", () => {
    const ftpOnly = { ftp: 180 };
    expect(outdoorTarget(work(60, 70), 900, ftpOnly)?.main.text).toBe("Effort 4");
    expect(outdoorTarget(work(80, 85), 900, ftpOnly)?.main.text).toBe("Effort 6");
    expect(outdoorTarget(work(92, 98), 240, ftpOnly)).toEqual({ main: expect.objectContaining({ text: "Effort 7" }), second: null });
    expect(outdoorTarget({ ...work(55, 70), type: "warmup" }, 900, ftpOnly)?.main.text).toBe("Effort 2");
  });
  it("a written outdoor target wins when it resolves; a rest and an unknown zone get none", () => {
    const written: WorkoutStep = { ...work(75, 80), outdoor: { metric: "hr", anchor: "lthr", low: 83, high: 89 } };
    expect(outdoorTarget(written, 900, withHr)?.main.text).toBe("HR 142-152");
    expect(outdoorTarget(written, 900, { ftp: 180 })?.main.text).toBe("Effort 6");
    expect(outdoorTarget({ ...work(75, 80), outdoor: { metric: "rpe", anchor: "absolute", low: 5, high: 6 } }, 900, withHr)?.main.text).toBe("Effort 5-6");
    expect(outdoorTarget({ type: "rest", end: time(60) }, 60, withHr)).toBeNull();
    expect(outdoorTarget({ type: "work", end: time(600), target: { metric: "cadence", anchor: "absolute", low: 90, high: 100 } }, 600, withHr)).toBeNull();
  });
});
