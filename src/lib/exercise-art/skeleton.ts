/**
 * The two fixed skeletons every exercise illustration is posed on.
 *
 * An exercise only supplies joint positions; which bones exist, how thick each
 * limb is and which muscles it carries are decided here, once, so every
 * drawing in the app has the same figure. Coordinates live in a 250 x 300 box,
 * y down, floor at y = 290. The side view faces right; "far" limbs are the
 * ones on the other side of the body. In the front view `l*` is the limb on
 * the left of the screen.
 */

import type { muscleGroupEnum } from "@/db/schema/exercises";

export type Muscle = Exclude<(typeof muscleGroupEnum)[number], "full_body" | "cardio">;

export const MUSCLES: readonly Muscle[] = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "quads", "hamstrings", "glutes", "calves", "abs", "lower_back",
];

export const FLOOR_Y = 290;
export const HEAD_RADIUS = 15;

export const VIEWS = ["front", "side"] as const;
export type View = (typeof VIEWS)[number];

/** A limb drawn as a tapered capsule from one joint to the next. */
export type Limb = {
  from: string;
  to: string;
  /** Radius at `from` and at `to`. */
  r: [number, number];
  /** Muscles this limb lights up for. */
  muscles: Muscle[];
  /** "far" limbs are drawn dimmer, behind the body. */
  depth: "far" | "body" | "near";
};

type Skeleton = {
  joints: readonly string[];
  /** Joints an exercise may leave out, with the joint they default to and an offset. */
  optional: Record<string, { from: string; offset: [number, number] }>;
  /** Bones as [a, b]; must form a tree so a pose can be rebuilt from any joint. */
  bones: readonly [string, string][];
  /** Longest each bone may be. Shorter is fine (foreshortening), longer is a stretched limb. */
  maxLength: Record<string, number>;
  limbs: Limb[];
};

const ARM = ["biceps", "triceps", "shoulders"] as Muscle[];
const THIGH = ["quads", "hamstrings", "glutes"] as Muscle[];

export const SKELETONS: Record<View, Skeleton> = {
  side: {
    joints: [
      "head", "neck", "shoulder", "chest", "hip", "elbow", "wrist", "knee", "ankle", "toe",
      "farElbow", "farWrist", "farKnee", "farAnkle", "farToe",
    ],
    optional: {
      farElbow: { from: "elbow", offset: [-6, 0] },
      farWrist: { from: "wrist", offset: [-6, 0] },
      farKnee: { from: "knee", offset: [-8, 0] },
      farAnkle: { from: "ankle", offset: [-10, 0] },
      farToe: { from: "toe", offset: [-10, 0] },
    },
    bones: [
      ["hip", "chest"], ["chest", "neck"], ["neck", "head"], ["neck", "shoulder"],
      ["shoulder", "elbow"], ["elbow", "wrist"], ["shoulder", "farElbow"], ["farElbow", "farWrist"],
      ["hip", "knee"], ["knee", "ankle"], ["ankle", "toe"],
      ["hip", "farKnee"], ["farKnee", "farAnkle"], ["farAnkle", "farToe"],
    ],
    maxLength: {
      "hip-chest": 44, "chest-neck": 40, "neck-head": 26, "neck-shoulder": 16,
      "shoulder-elbow": 48, "elbow-wrist": 44, "shoulder-farElbow": 48, "farElbow-farWrist": 44,
      "hip-knee": 64, "knee-ankle": 60, "ankle-toe": 24,
      "hip-farKnee": 64, "farKnee-farAnkle": 60, "farAnkle-farToe": 24,
    },
    limbs: [
      { from: "shoulder", to: "farElbow", r: [7, 6], muscles: ARM, depth: "far" },
      { from: "farElbow", to: "farWrist", r: [6, 4.5], muscles: ["forearms"], depth: "far" },
      { from: "hip", to: "farKnee", r: [12.5, 8.5], muscles: THIGH, depth: "far" },
      { from: "farKnee", to: "farAnkle", r: [8, 5], muscles: ["calves"], depth: "far" },
      { from: "farAnkle", to: "farToe", r: [5, 3], muscles: [], depth: "far" },
      { from: "neck", to: "head", r: [6, 6], muscles: [], depth: "body" },
      { from: "hip", to: "chest", r: [15, 17], muscles: ["abs", "lower_back"], depth: "body" },
      { from: "chest", to: "neck", r: [18, 12], muscles: ["chest", "back"], depth: "body" },
      { from: "hip", to: "knee", r: [13, 8.5], muscles: THIGH, depth: "body" },
      { from: "knee", to: "ankle", r: [8.5, 5], muscles: ["calves"], depth: "body" },
      { from: "ankle", to: "toe", r: [5, 3], muscles: [], depth: "body" },
      { from: "shoulder", to: "elbow", r: [8.5, 6], muscles: ARM, depth: "near" },
      { from: "elbow", to: "wrist", r: [6, 4.5], muscles: ["forearms"], depth: "near" },
    ],
  },
  front: {
    joints: [
      "head", "neck", "pelvis", "lShoulder", "rShoulder", "lElbow", "rElbow", "lWrist", "rWrist",
      "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle", "lToe", "rToe",
    ],
    optional: {},
    bones: [
      ["pelvis", "neck"], ["neck", "head"], ["neck", "lShoulder"], ["neck", "rShoulder"],
      ["lShoulder", "lElbow"], ["lElbow", "lWrist"], ["rShoulder", "rElbow"], ["rElbow", "rWrist"],
      ["pelvis", "lHip"], ["pelvis", "rHip"], ["lHip", "lKnee"], ["lKnee", "lAnkle"], ["lAnkle", "lToe"],
      ["rHip", "rKnee"], ["rKnee", "rAnkle"], ["rAnkle", "rToe"],
    ],
    maxLength: {
      "pelvis-neck": 90, "neck-head": 28, "neck-lShoulder": 26, "neck-rShoulder": 26,
      "lShoulder-lElbow": 48, "lElbow-lWrist": 44, "rShoulder-rElbow": 48, "rElbow-rWrist": 44,
      "pelvis-lHip": 16, "pelvis-rHip": 16, "lHip-lKnee": 64, "lKnee-lAnkle": 60, "lAnkle-lToe": 16,
      "rHip-rKnee": 64, "rKnee-rAnkle": 60, "rAnkle-rToe": 16,
    },
    // The torso is drawn as shaped plates (scene.ts), not as limbs.
    limbs: [
      { from: "neck", to: "head", r: [6.5, 6.5], muscles: [], depth: "body" },
      { from: "lHip", to: "lKnee", r: [12, 8], muscles: THIGH, depth: "body" },
      { from: "rHip", to: "rKnee", r: [12, 8], muscles: THIGH, depth: "body" },
      { from: "lKnee", to: "lAnkle", r: [8, 5], muscles: ["calves"], depth: "body" },
      { from: "rKnee", to: "rAnkle", r: [8, 5], muscles: ["calves"], depth: "body" },
      { from: "lAnkle", to: "lToe", r: [5, 3.5], muscles: [], depth: "body" },
      { from: "rAnkle", to: "rToe", r: [5, 3.5], muscles: [], depth: "body" },
      { from: "lShoulder", to: "lElbow", r: [7.5, 6], muscles: ["biceps", "triceps"], depth: "near" },
      { from: "rShoulder", to: "rElbow", r: [7.5, 6], muscles: ["biceps", "triceps"], depth: "near" },
      { from: "lElbow", to: "lWrist", r: [6, 4.5], muscles: ["forearms"], depth: "near" },
      { from: "rElbow", to: "rWrist", r: [6, 4.5], muscles: ["forearms"], depth: "near" },
    ],
  },
};

export const boneKey = (a: string, b: string) => `${a}-${b}`;
