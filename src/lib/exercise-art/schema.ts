/**
 * The shape of one exercise illustration (`specs/<slug>.json`) and the checks
 * that keep a hand-posed figure anatomically sane.
 */

import { z } from "zod";
import { BONE_LENGTH, JOINTS, MUSCLES, NEIGHBOURS, type Joint, type Muscle } from "./skeleton";

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
  /**
   * One dumbbell per joint (default: the wrists); `along` is the handle's axis:
   * x for an overhand grip, z for a neutral one, "forearm" for a neutral grip
   * that stays at right angles to the forearm as it swings (a hammer curl).
   */
  z.object({ type: z.literal("dumbbell"), at: z.array(joint).min(1).optional(), along: z.enum(["x", "z", "forearm"]).default("x"), layer: layer.default("auto") }),
  /** One bell hanging from the midpoint of the joints. */
  z.object({ type: z.literal("kettlebell"), at: z.array(joint).min(1), layer: layer.default("auto") }),
  /** Bench pad: top at y, from z1 to z2 front to back, `width` across, centred; legs to the floor. */
  z.object({ type: z.literal("bench"), y: z.number(), z1: z.number(), z2: z.number(), width: z.number().positive(), layer: layer.default("back") }),
  /** Sloped pad (incline bench back, seat back): top surface from `from` to `to`, each [y, z], `width` across, centred; one post to the floor. */
  z.object({ type: z.literal("incline"), from: z.tuple([z.number(), z.number()]), to: z.tuple([z.number(), z.number()]), width: z.number().positive(), layer: layer.default("back") }),
  /** Parallel bars (dip station): two bars along z from z1 to z2 at height y, `width` apart, centred; uprights to the floor. */
  z.object({ type: z.literal("bars"), y: z.number(), z1: z.number(), z2: z.number(), width: z.number().positive(), layer: layer.default("back") }),
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
  /**
   * Hands or feet that travel in a straight line between keyframes, with the
   * elbow or knee solved to fit: hands on a pressed or rowed bar, feet planted
   * when the anchor is not a foot. Leave out for free swings (a curl's hands).
   */
  hold: z.array(z.enum(["lWrist", "rWrist", "lAnkle", "rAnkle"])).default([]),
  /** "top" swaps the front view for a view from above, for lifts done lying down. */
  camera: z.enum(["front", "top"]).default("front"),
  /**
   * Draws the whole figure smaller, round the middle of the floor (or of the
   * view from above), for poses too long for the frame at full size: a body
   * lying flat from head to heels in a plank or push-up.
   */
  zoom: z.number().min(0.6).max(1).default(1),
  /**
   * Keyframe 0 is where the lifter sets up before the first rep. It lists
   * every joint; later keyframes list only the joints that move. Bone lengths
   * are applied for you (resolveFrames), so a joint only has to point the
   * right way from its parent.
   */
  keyframes: z.array(z.partialRecord(joint, point3)).min(2),
  props: z.array(prop).default([]),
});

export type ArtSpec = z.infer<typeof artSpecSchema>;
export type ArtProp = z.infer<typeof prop>;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (v: Point3) => Math.hypot(v[0], v[1], v[2]);

/** A joint placed well off where its bone can reach: a sign of a typo or the wrong joint. */
export type Miss = { frame: number; joint: Joint; parent: Joint; off: number; length: number };

const FEET: ReadonlySet<Joint> = new Set(["lAnkle", "rAnkle", "lToe", "rToe"]);

/**
 * Every keyframe as a complete pose, built outward from the anchor with each
 * bone at its exact length. A joint listed in the keyframe sets the bone's
 * direction from its (already placed) parent. A joint not listed keeps the
 * direction it had in the keyframe before, so moving an elbow carries the
 * wrist with it; except feet, which stay planted where they were unless
 * listed. Assumes keyframe 0 lists every joint (checkSpec).
 */
export function resolveFrames(spec: ArtSpec): { poses: Pose[]; misses: Miss[] } {
  const poses: Pose[] = [];
  const misses: Miss[] = [];
  spec.keyframes.forEach((frame, i) => {
    const prev = poses.at(-1);
    const anchor = frame[spec.anchor] ?? prev![spec.anchor];
    const out: Partial<Pose> = { [spec.anchor]: anchor };
    const queue: Joint[] = [spec.anchor];
    while (queue.length) {
      const parent = queue.shift()!;
      for (const child of NEIGHBOURS.get(parent) ?? []) {
        if (out[child]) continue;
        const length = BONE_LENGTH.get(`${parent}-${child}`)!;
        const listed = frame[child];
        const planted = !listed && FEET.has(child) ? prev![child] : null;
        const dir = listed ? sub(listed, out[parent]!) : planted ? sub(planted, out[parent]!) : sub(prev![child], prev![parent]);
        const n = len3(dir) || 1;
        const placed: Point3 = [0, 1, 2].map((k) => out[parent]![k] + (dir[k] / n) * length) as Point3;
        if (listed && len3(sub(listed, placed)) > length * 0.15) {
          misses.push({ frame: i, joint: child, parent, off: len3(sub(listed, placed)), length });
        }
        out[child] = placed;
        queue.push(child);
      }
    }
    poses.push(out as Pose);
  });
  return { poses, misses };
}

export function resolvePoses(spec: ArtSpec): Pose[] {
  return resolveFrames(spec).poses;
}
