/**
 * The one 3D skeleton every exercise illustration is posed on.
 *
 * An exercise supplies joint positions; which bones exist, how long and thick
 * each one is and which muscles it carries are decided here, once, so every
 * drawing has the same figure. A pose is 3D so the front and side views are
 * two projections of the same body and can never disagree.
 *
 * Axes: x across the body (screen x in the front view; `l*` joints have the
 * smaller x), y down (floor at y = 290), z forward, the way the lifter faces.
 * The front view looks at the lifter (screen x = x). The side view looks from
 * the `r*` side, lifter facing right (screen x = 125 + z). A lying lift can
 * swap the front view for a top view, looking down (screen y = TOP_Y + z).
 */

import type { muscleGroupEnum } from "@/db/schema/exercises";

export type Muscle = Exclude<(typeof muscleGroupEnum)[number], "full_body" | "cardio">;

export const MUSCLES: readonly Muscle[] = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "quads", "hamstrings", "glutes", "calves", "abs", "lower_back",
];

export const FLOOR_Y = 290;
export const HEAD_RADIUS = 15;
/** Body centre line: x in the front view, the side view's z = 0. */
export const CENTER_X = 125;

/** Screen y of z = 0 in the top view. */
export const TOP_Y = 166;

export const VIEWS = ["front", "side"] as const;
export type View = (typeof VIEWS)[number];
/** What the "front" view slot shows: the lifter from the front, or from above (for lying lifts). */
export type Camera = "front" | "top";

export const JOINTS = [
  "head", "neck", "chest", "pelvis",
  "lShoulder", "rShoulder", "lElbow", "rElbow", "lWrist", "rWrist",
  "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle", "lToe", "rToe",
] as const;
export type Joint = (typeof JOINTS)[number];

/**
 * Bones with their length. Lengths are fixed: every keyframe must match them
 * (within 3%), because a limb that changes length between poses reads as a
 * limb growing. Together the bones form a tree, so a pose can be rebuilt from
 * any one joint.
 */
export const BONES: readonly { a: Joint; b: Joint; length: number }[] = [
  { a: "pelvis", b: "chest", length: 40 },
  { a: "chest", b: "neck", length: 38 },
  { a: "neck", b: "head", length: 24 },
  { a: "neck", b: "lShoulder", length: 23 },
  { a: "neck", b: "rShoulder", length: 23 },
  { a: "lShoulder", b: "lElbow", length: 46 },
  { a: "rShoulder", b: "rElbow", length: 46 },
  { a: "lElbow", b: "lWrist", length: 42 },
  { a: "rElbow", b: "rWrist", length: 42 },
  { a: "pelvis", b: "lHip", length: 12 },
  { a: "pelvis", b: "rHip", length: 12 },
  { a: "lHip", b: "lKnee", length: 60 },
  { a: "rHip", b: "rKnee", length: 60 },
  { a: "lKnee", b: "lAnkle", length: 56 },
  { a: "rKnee", b: "rAnkle", length: 56 },
  { a: "lAnkle", b: "lToe", length: 21 },
  { a: "rAnkle", b: "rToe", length: 21 },
];

export const BONE_LENGTH = new Map<string, number>();
export const NEIGHBOURS = new Map<Joint, Joint[]>();
for (const { a, b, length } of BONES) {
  BONE_LENGTH.set(`${a}-${b}`, length);
  BONE_LENGTH.set(`${b}-${a}`, length);
  NEIGHBOURS.set(a, [...(NEIGHBOURS.get(a) ?? []), b]);
  NEIGHBOURS.set(b, [...(NEIGHBOURS.get(b) ?? []), a]);
}

/** A limb drawn as a tapered capsule from one joint to the next. */
export type Limb = {
  from: Joint;
  to: Joint;
  /** Radius at `from` and at `to`. */
  r: [number, number];
  /** Muscles this limb lights up for. */
  muscles: Muscle[];
  kind: "arm" | "leg";
};

const UPPER_ARM: Muscle[] = ["biceps", "triceps", "shoulders"];
const THIGH: Muscle[] = ["quads", "hamstrings", "glutes"];

export const LIMBS: Limb[] = (["l", "r"] as const).flatMap((s): Limb[] => [
  { from: `${s}Hip`, to: `${s}Knee`, r: [12.5, 8.5], muscles: THIGH, kind: "leg" },
  { from: `${s}Knee`, to: `${s}Ankle`, r: [8.5, 5], muscles: ["calves"], kind: "leg" },
  { from: `${s}Ankle`, to: `${s}Toe`, r: [5, 3.2], muscles: [], kind: "leg" },
  { from: `${s}Shoulder`, to: `${s}Elbow`, r: [8.5, 6], muscles: UPPER_ARM, kind: "arm" },
  { from: `${s}Elbow`, to: `${s}Wrist`, r: [6, 4.5], muscles: ["forearms"], kind: "arm" },
]);
