import { describe, expect, it } from "vitest";
import { loadArtSpec, loadArtThumbs } from "@/lib/exercise-art/load";
import { VIEWBOX, figureViewBox } from "@/lib/exercise-art/scene";
import { weeklyVolumeHeat } from "@/lib/utils/weekly-volume-heat";

describe("weeklyVolumeHeat", () => {
  const row = (muscleGroup: string, setCount: number) => ({ muscleGroup, setCount, targetMin: 10 });

  it("splits the way to the target into thirds and makes the target the top level", () => {
    expect(
      weeklyVolumeHeat([row("chest", 1), row("back", 3), row("quads", 4), row("glutes", 6), row("abs", 7), row("calves", 9), row("biceps", 10), row("triceps", 25)]),
    ).toEqual({ chest: 1, back: 1, quads: 2, glutes: 2, abs: 3, calves: 3, biceps: 4, triceps: 4 });
  });

  it("leaves out untrained muscles and groups the map does not draw", () => {
    expect(weeklyVolumeHeat([row("chest", 0), row("cardio", 5), row("full_body", 12)])).toEqual({});
  });
});

describe("figureViewBox", () => {
  it("is a square tighter than the card frame", async () => {
    const spec = (await loadArtSpec("Squat"))!;
    const [, , w, h] = figureViewBox(spec, "side", 1).split(" ").map(Number);
    const [, , frameW, frameH] = VIEWBOX.split(" ").map(Number);
    expect(w).toBe(h);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(Math.max(frameW, frameH));
  });
});

describe("loadArtThumbs", () => {
  it("keys drawn exercises by id and leaves out the rest", async () => {
    const thumbs = await loadArtThumbs([
      { id: 1, name: "Bench Press" },
      { id: 2, name: "Not An Exercise" },
    ]);
    expect(Object.keys(thumbs)).toEqual(["1"]);
    expect(thumbs[1].svg).toContain("__ID__");
  });
});
