import { lapCadence, summaryCadence } from "@/lib/garmin/cadence";
import { describe, expect, it } from "vitest";

/** Average cadence for the coach (docs/plans/strict-targets.md, decision 11). */

describe("summaryCadence", () => {
  it("reads rpm on a ride and Garmin's steps per minute on a run as given", () => {
    expect(summaryCadence("bike", { averageBikingCadenceInRevPerMinute: 81.6 })).toBe(82);
    expect(summaryCadence("run", { averageRunningCadenceInStepsPerMinute: 154.67 })).toBe(155);
  });

  it("is null for other sports, a missing field or a zero", () => {
    expect(summaryCadence("swim", { averageSwimCadenceInStrokesPerMinute: 30 })).toBeNull();
    expect(summaryCadence("bike", {})).toBeNull();
    expect(summaryCadence("run", { averageRunningCadenceInStepsPerMinute: 0 })).toBeNull();
    expect(summaryCadence("run", null)).toBeNull();
  });
});

describe("lapCadence", () => {
  it("keeps a ride lap's rpm with its fraction", () => {
    expect(lapCadence("bike", { avgCadence: 83, avgFractionalCadence: 0.4 })).toBe(83);
    expect(lapCadence("bike", { avgCadence: 79, avgFractionalCadence: 0.74 })).toBe(80);
  });

  it("doubles a run lap: FIT stores run cadence per foot", () => {
    expect(lapCadence("run", { avgCadence: 77, avgFractionalCadence: 0.04 })).toBe(154);
    expect(lapCadence("run", { avgCadence: 86 })).toBe(172);
  });

  it("is null without a cadence or for another sport", () => {
    expect(lapCadence("run", {})).toBeNull();
    expect(lapCadence("swim", { avgCadence: 30 })).toBeNull();
  });
});
