import { describe, expect, it } from "vitest";
import { markerX, powerZoneOf, profileBlocks, profileGeometry } from "@/lib/utils/workout-profile";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { APP_FTP, LONG_RIDE_WORKOUT, TEMPO_WORKOUT } from "./fixtures/bike-sessions";

const parsed = (w: unknown): Workout => {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error("fixture does not parse");
  return r.workout;
};
const tempo = parsed(TEMPO_WORKOUT);
const anchors = { ftp: APP_FTP, lthr_bike: 175 };

describe("profileBlocks", () => {
  it("gives the tempo five blocks at the middle of each % FTP range, coloured by power zone", () => {
    const blocks = profileBlocks(tempo, anchors);
    expect(blocks.map((b) => b.seconds / 60)).toEqual([15, 15, 5, 15, 15]);
    expect(blocks.map((b) => b.pct)).toEqual([66, 77.5, 55, 77.5, 66]);
    expect(blocks.map((b) => b.zone)).toEqual([2, 3, 2, 3, 2]);
  });

  it("expands repeats, marks fuel steps, and uses the one side of a one-sided range", () => {
    const blocks = profileBlocks(parsed(LONG_RIDE_WORKOUT), anchors);
    expect(blocks).toHaveLength(7);
    expect(blocks.reduce((a, b) => a + b.seconds, 0)).toBe(135 * 60);
    expect(blocks.map((b) => b.fuel)).toEqual([false, false, true, true, true, true, false]);
    expect(blocks[6].pct).toBe(61);
  });

  it("turns absolute watts into % FTP, and a step with no power target gets its type's default", () => {
    const w = parsed({
      v: 1,
      sport: "bike",
      name: "x",
      steps: [
        { type: "work", end: { type: "time", seconds: 60 }, target: { metric: "power", anchor: "absolute", low: 171, high: 189 } },
        { type: "recovery", end: { type: "time", seconds: 60 }, target: { metric: "hr", anchor: "absolute", high: 130 } },
        { type: "cooldown", end: { type: "lap" } },
      ],
    });
    const blocks = profileBlocks(w, anchors);
    expect(blocks.map((b) => Math.round(b.pct))).toEqual([100, 55]);
    expect(blocks[0].zone).toBe(4);
  });

  it("zones follow Coggan", () => {
    expect([54, 55, 74, 75, 89, 90, 104, 105].map(powerZoneOf)).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
  });
});

describe("profileGeometry", () => {
  const g = profileGeometry(profileBlocks(tempo, anchors), 390, 90);

  it("puts the blocks side by side over the full width, by time", () => {
    expect(g.totalSeconds).toBe(65 * 60);
    expect(g.base).toBe(76);
    expect(g.rects[0].x).toBeCloseTo(0.5);
    expect(g.rects[1].x).toBeCloseTo(90 + 0.5);
    expect(g.rects[0].w).toBeCloseTo(89);
    expect(g.rects[2].w).toBeCloseTo(29);
    const last = g.rects[4];
    expect(last.x + last.w + 0.5).toBeCloseTo(390);
  });

  it("scales height to % FTP with the FTP line at 100 % of a 110 % top", () => {
    expect(g.ftpY).toBeCloseTo(76 - (100 / 110) * 76);
    expect(g.rects[1].h).toBeCloseTo((77.5 / 110) * 76);
    expect(g.rects[1].y + g.rects[1].h).toBeCloseTo(76);
  });

  it("raises the top above a block over 110 % FTP", () => {
    const hi = profileGeometry([{ seconds: 60, pct: 120, zone: 5, fuel: false }], 100, 50, false);
    expect(hi.rects[0].y).toBeGreaterThan(0);
    expect(hi.base).toBe(50);
    expect(hi.ticks).toEqual([]);
  });

  it("labels the minute axis at 0, the middle and the end", () => {
    expect(g.ticks.map((t) => t.label)).toEqual(["0", "33 min", "65"]);
    expect(g.ticks.map((t) => t.x)).toEqual([0, 195, 390]);
  });

  it("places the now marker by elapsed time, inside the box", () => {
    expect(markerX(g, 0)).toBe(0);
    expect(markerX(g, 32.5 * 60)).toBeCloseTo(195);
    expect(markerX(g, 999 * 60)).toBe(390);
  });
});
