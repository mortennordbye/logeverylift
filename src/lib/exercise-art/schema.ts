/**
 * The shape of one exercise illustration (`specs/<slug>.json`) and the checks
 * that keep a hand-posed figure anatomically sane.
 */

import { z } from "zod";
import { BONES, CENTER_X, FLOOR_Y, HEAD_RADIUS, JOINTS, MUSCLES, type Joint, type Muscle } from "./skeleton";

export type Point3 = [number, number, number];
export type Pose = Record<Joint, Point3>;

const point3 = z.tuple([z.number(), z.number(), z.number()]);
const joint = z.enum(JOINTS);
const muscle = z.enum(MUSCLES as [Muscle, ...Muscle[]]);
/** "auto" sorts the prop by depth with the body; "back"/"front" pin it behind or in front of everything. */
const layer = z.enum(["auto", "back", "front"]);

const prop = z.discriminatedUnion("type", [
  /** Bar along x through the midpoint of the joints (default: the wrists). */
  z.object({ type: z.literal("barbell"), at: z.array(joint).min(1).optional(), layer: layer.default("auto") }),
  /** One dumbbell per joint (default: the wrists); `along` is the handle's axis: x for an overhand grip, z for a neutral one. */
  z.object({ type: z.literal("dumbbell"), at: z.array(joint).min(1).optional(), along: z.enum(["x", "z"]).default("x"), layer: layer.default("auto") }),
  /** One bell hanging from the midpoint of the joints. */
  z.object({ type: z.literal("kettlebell"), at: z.array(joint).min(1), layer: layer.default("auto") }),
  /** Bench pad: top at y, from z1 to z2 front to back, `width` across, centred; legs to the floor. */
  z.object({ type: z.literal("bench"), y: z.number(), z1: z.number(), z2: z.number(), width: z.number().positive(), layer: layer.default("back") }),
  /** Fixed bar along x (pull-up bar, rack) at height y and depth z. */
  z.object({ type: z.literal("bar"), y: z.number(), z: z.number(), layer: layer.default("back") }),
  /** Cable from a fixed pulley to a joint. */
  z.object({ type: z.literal("cable"), anchor: point3, at: joint, layer: layer.default("back") }),
  /** Box or step: top at y, from z1 to z2, `width` across, solid to the floor. */
  z.object({ type: z.literal("box"), y: z.number(), z1: z.number(), z2: z.number(), width: z.number().positive(), layer: layer.default("back") }),
]);

export const artSpecSchema = z.object({
  /** Exact exercise name as seeded. */
  name: z.string().min(1),
  primary: muscle,
  secondary: z.array(muscle),
  /** One or two sentences: the thing people get wrong. */
  cue: z.string().min(1),
  /** Labels for the way out and the way back, e.g. ["Curl", "Lower"]. */
  phases: z.tuple([z.string(), z.string()]),
  /** The joint that stays put while the body moves round it (an ankle for standing lifts, a wrist for a hang). */
  anchor: joint,
  /** First keyframe lists every joint; later ones list only the joints that move. */
  keyframes: z.array(z.partialRecord(joint, point3)).min(2),
  props: z.array(prop).default([]),
});

export type ArtSpec = z.infer<typeof artSpecSchema>;
export type ArtProp = z.infer<typeof prop>;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Every keyframe as a complete pose. Assumes the first keyframe is complete (checkSpec). */
export function resolvePoses(spec: ArtSpec): Pose[] {
  const poses: Pose[] = [];
  for (const frame of spec.keyframes) poses.push({ ...(poses.at(-1) ?? {}), ...frame } as Pose);
  return poses;
}

const dist = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Problems with a spec, as readable sentences. Empty means it can ship. */
export function checkSpec(raw: unknown): string[] {
  const parsed = artSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
  const spec = parsed.data;
  const problems: string[] = [];
  if (spec.secondary.includes(spec.primary)) problems.push(`secondary repeats the primary muscle "${spec.primary}"`);
  const missing = JOINTS.filter((j) => !spec.keyframes[0][j]);
  if (missing.length) return [...problems, `keyframe 0: missing ${missing.join(", ")}`];

  resolvePoses(spec).forEach((pose, i) => {
    for (const { a, b, length } of BONES) {
      const len = dist(pose[a], pose[b]);
      if (Math.abs(len - length) > length * 0.03) {
        problems.push(`keyframe ${i}: ${a}-${b} is ${len.toFixed(1)} long, must be ${length}`);
      }
    }
    for (const j of JOINTS) {
      const [x, y, z] = pose[j];
      if (y > FLOOR_Y + 2) problems.push(`keyframe ${i}: ${j} is below the floor (y ${y})`);
      // Both views must fit the view box (scene.ts VIEWBOX): x 25-225, y 36-296.
      const top = j === "head" ? y - HEAD_RADIUS : y;
      if (x < 25 || x > 225 || CENTER_X + z < 25 || CENTER_X + z > 225 || top < 36) {
        problems.push(`keyframe ${i}: ${j} is outside the frame`);
      }
    }
  });
  return problems;
}
