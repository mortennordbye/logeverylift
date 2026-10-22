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
  const withFrame0 = (frame0: Record<string, [number, number, number]>) => {
    const spec = structuredClone(read("barbell-curl.json")) as ArtSpec;
    spec.keyframes[0] = { ...spec.keyframes[0], ...frame0 };
    return spec;
  };

  it("rejects a limb that is the wrong length", () => {
    expect(checkSpec(withFrame0({ lWrist: [102, 220, 4] }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/keyframe 0: lElbow-lWrist is [\d.]+ long, must be 42/)]),
    );
  });

  it("rejects an unknown joint and a joint below the floor", () => {
    expect(checkSpec(withFrame0({ tail: [100, 100, 0] } as never)).join("\n")).toMatch(/tail/);
    expect(checkSpec(withFrame0({ lToe: [110, 299, 19] }))).toEqual(expect.arrayContaining([expect.stringMatching(/lToe is below the floor/)]));
  });

  it("rejects a first keyframe that leaves out a joint", () => {
    const spec = structuredClone(read("barbell-curl.json")) as ArtSpec;
    delete spec.keyframes[0].lKnee;
    expect(checkSpec(spec)).toContain("keyframe 0: missing lKnee");
  });

  it("rejects a secondary muscle that repeats the primary", () => {
    expect(checkSpec({ ...curl, secondary: ["biceps"] })).toContain('secondary repeats the primary muscle "biceps"');
  });
});

describe("motion", () => {
  const len = (p: Record<string, number[]>, a: string, b: string) => Math.hypot(...p[a].map((c, i) => c - p[b][i]));

  it("keeps every bone its length through the movement", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      expect(len(poseAt(curl, t), "lElbow", "lWrist")).toBeCloseTo(len(poseAt(curl, 0), "lElbow", "lWrist"), 0);
    }
  });

  it("curls the forearm forward and up, never inward across the body", () => {
    // The first version rotated bones flat in each view, and in the front view
    // the forearm took the short way round: through the torso.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = poseAt(curl, t);
      expect(Math.abs(p.lWrist[0] - p.lElbow[0])).toBeLessThan(4);
      expect(Math.abs(p.rWrist[0] - p.rElbow[0])).toBeLessThan(4);
      expect(p.lWrist[2]).toBeGreaterThanOrEqual(p.lElbow[2]);
    }
  });

  it("keeps the anchor joint where the keyframes put it", () => {
    expect(poseAt(curl, 0.37).lAnkle).toEqual([112, 278, -1]);
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
