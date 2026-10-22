import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { muscleRoles } from "@/lib/exercise-art/load";
import { CYCLE_MS, capsule, cycleAt, poseAt, renderSvg } from "@/lib/exercise-art/scene";
import { artSpecSchema, checkSpec, slugify, type ArtSpec } from "@/lib/exercise-art/schema";
import { SPEC_LOADERS } from "@/lib/exercise-art/specs";

const SPEC_DIR = path.resolve(__dirname, "../lib/exercise-art/specs");
const files = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".json"));
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(SPEC_DIR, file), "utf8"));
const curl = artSpecSchema.parse(read("barbell-curl.json"));

describe("exercise illustration specs", () => {
  it.each(files)("%s passes every check", (file) => {
    const raw = read(file);
    expect(checkSpec(raw)).toEqual([]);
    expect(`${slugify((raw as ArtSpec).name)}.json`).toBe(file);
  });

  it("are all in the generated index (run `pnpm art index`)", () => {
    expect(Object.keys(SPEC_LOADERS).sort()).toEqual(files.map((f) => f.replace(/\.json$/, "")).sort());
  });

  it("never paint a fixed colour, so they follow the user's accent and theme", () => {
    for (const file of files) {
      const spec = artSpecSchema.parse(read(file));
      for (const view of ["front", "side"] as const) {
        const svg = renderSvg(spec, view, 0.5, "t");
        expect(svg).toContain("var(--primary)");
        expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
      }
    }
  });
});

describe("checkSpec", () => {
  const withSide = (frame0: Record<string, [number, number]>) => {
    const spec = structuredClone(read("barbell-curl.json")) as ArtSpec;
    spec.views.side.keyframes[0] = { ...spec.views.side.keyframes[0], ...frame0 };
    return spec;
  };

  it("rejects a stretched limb", () => {
    expect(checkSpec(withSide({ wrist: [130, 230] }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/side keyframe 0: elbow-wrist is \d+ long, max 44/)]),
    );
  });

  it("rejects an unknown joint and a joint below the floor", () => {
    const problems = checkSpec(withSide({ tail: [100, 100], toe: [141, 299] }));
    expect(problems).toEqual(expect.arrayContaining([
      'side keyframe 0: unknown joint "tail"',
      expect.stringMatching(/toe is below the floor/),
    ]));
  });

  it("rejects a first keyframe that leaves out a required joint", () => {
    const spec = structuredClone(read("barbell-curl.json")) as ArtSpec;
    delete spec.views.front.keyframes[0].lKnee;
    expect(checkSpec(spec)).toContain("front keyframe 0: missing lKnee");
  });

  it("rejects a secondary muscle that repeats the primary", () => {
    expect(checkSpec({ ...curl, secondary: ["biceps"] })).toContain('secondary repeats the primary muscle "biceps"');
  });
});

describe("motion", () => {
  const len = (p: Record<string, [number, number]>, a: string, b: string) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);

  it("swings the forearm round the elbow instead of shrinking it mid-curl", () => {
    // A straight-line blend of the wrist would cut the forearm to ~17 here.
    const start = len(poseAt(curl, "side", 0), "elbow", "wrist");
    const end = len(poseAt(curl, "side", 1), "elbow", "wrist");
    const middle = len(poseAt(curl, "side", 0.5), "elbow", "wrist");
    expect(middle).toBeGreaterThanOrEqual(Math.min(start, end) - 0.01);
    expect(middle).toBeLessThanOrEqual(Math.max(start, end) + 0.01);
  });

  it("keeps the anchor joint where the keyframes put it", () => {
    expect(poseAt(curl, "side", 0.37).ankle).toEqual([121, 280]);
  });

  it("goes out, holds, and comes back over one cycle", () => {
    expect(cycleAt(0)).toEqual({ t: 0, phase: 0 });
    expect(cycleAt(CYCLE_MS / 2 - 1).t).toBeCloseTo(1, 2);
    expect(cycleAt(CYCLE_MS / 2 + 1).phase).toBe(1);
    expect(cycleAt(CYCLE_MS - 1).t).toBeCloseTo(0, 2);
  });

  it("draws a limb shorter than its taper as a plain circle", () => {
    expect(capsule([10, 10], [10, 11], 6, 4)).not.toContain("L");
  });
});

describe("muscleRoles", () => {
  it("uses a drawn exercise's primary and secondary muscles", () => {
    expect(muscleRoles("chest", { primary: "biceps", secondary: ["forearms"] })).toEqual({ biceps: "primary", forearms: "secondary" });
  });

  it("falls back to the exercise's muscle group", () => {
    expect(muscleRoles("lower_back", null)).toEqual({ lower_back: "primary" });
    expect(Object.values(muscleRoles("full_body", null))).toHaveLength(12);
    expect(muscleRoles("cardio", null)).toEqual({});
    expect(muscleRoles(null, null)).toEqual({});
  });
});
