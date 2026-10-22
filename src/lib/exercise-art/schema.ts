/**
 * The shape of one exercise illustration (`specs/<slug>.json`) and the checks
 * that keep a hand-posed figure anatomically sane.
 */

import { z } from "zod";
import { FLOOR_Y, HEAD_RADIUS, MUSCLES, SKELETONS, VIEWS, boneKey, type Muscle, type View } from "./skeleton";

const point = z.tuple([z.number(), z.number()]);
const muscle = z.enum(MUSCLES as [Muscle, ...Muscle[]]);
const layer = z.enum(["back", "mid", "front"]).default("mid");

const prop = z.discriminatedUnion("type", [
  /** Bar through the given joints (front) or a plate at them (side). Default: the wrists. */
  z.object({ type: z.literal("barbell"), at: z.array(z.string()).min(1).optional(), layer }),
  /** One dumbbell per joint listed. Default: the wrists. */
  z.object({ type: z.literal("dumbbell"), at: z.array(z.string()).min(1).optional(), layer }),
  /** One kettlebell hanging from the midpoint of the joints listed. */
  z.object({ type: z.literal("kettlebell"), at: z.array(z.string()).min(1).optional(), layer }),
  /** Flat bench: pad top-left at (x, y), legs down to the floor. */
  z.object({ type: z.literal("bench"), x: z.number(), y: z.number(), w: z.number().positive(), layer: layer.default("back") }),
  /** Fixed bar (pull-up bar, rack): a line from x1 to x2 at y, or a dot when x1 = x2 (side view). */
  z.object({ type: z.literal("bar"), x1: z.number(), x2: z.number(), y: z.number(), layer: layer.default("back") }),
  /** Cable from a fixed anchor to a joint. */
  z.object({ type: z.literal("cable"), anchor: point, at: z.string(), layer: layer.default("back") }),
  /** Box or platform. */
  z.object({ type: z.literal("box"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), layer: layer.default("back") }),
]);

const view = z.object({
  /** The joint that stays put while the rest of the body moves around it (feet for standing lifts, hands for a hang). */
  anchor: z.string(),
  /** First keyframe lists every joint; later ones list only the joints that move. */
  keyframes: z.array(z.record(z.string(), point)).min(2),
  props: z.array(prop).default([]),
});

export const artSpecSchema = z.object({
  /** Exact exercise name as seeded. */
  name: z.string().min(1),
  primary: muscle,
  secondary: z.array(muscle),
  /** One or two sentences: the thing people get wrong. */
  cue: z.string().min(1),
  /** Labels for the way out and the way back, e.g. ["Lift", "Lower"]. */
  phases: z.tuple([z.string(), z.string()]),
  views: z.object({ front: view, side: view }),
});

export type ArtSpec = z.infer<typeof artSpecSchema>;
export type ArtProp = z.infer<typeof prop>;
export type Point = [number, number];
export type Pose = Record<string, Point>;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Every keyframe of a view as a complete pose, optional joints filled in. */
export function resolvePoses(spec: ArtSpec, v: View): Pose[] {
  const { optional } = SKELETONS[v];
  const poses: Pose[] = [];
  // An optional joint posed explicitly once is never re-derived afterwards.
  const explicit = new Set<string>();
  for (const frame of spec.views[v].keyframes) {
    const pose: Pose = { ...(poses.at(-1) ?? {}), ...frame };
    for (const [joint, { from, offset }] of Object.entries(optional)) {
      if (joint in frame) explicit.add(joint);
      else if (!explicit.has(joint) && pose[from] && (poses.length === 0 || from in frame)) {
        pose[joint] = [pose[from][0] + offset[0], pose[from][1] + offset[1]];
      }
    }
    poses.push(pose);
  }
  return poses;
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Problems with a spec, as readable sentences. Empty means it can ship. */
export function checkSpec(raw: unknown): string[] {
  const parsed = artSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
  const spec = parsed.data;
  const problems: string[] = [];
  if (spec.secondary.includes(spec.primary)) problems.push(`secondary repeats the primary muscle "${spec.primary}"`);

  for (const v of VIEWS) {
    const sk = SKELETONS[v];
    const known = new Set(sk.joints);
    const { keyframes, anchor, props } = spec.views[v];
    if (!known.has(anchor)) problems.push(`${v}: anchor "${anchor}" is not a ${v} joint`);
    keyframes.forEach((frame, i) => {
      for (const j of Object.keys(frame)) {
        if (!known.has(j)) problems.push(`${v} keyframe ${i}: unknown joint "${j}"`);
      }
    });
    const missing = sk.joints.filter((j) => !(j in keyframes[0]) && !(j in sk.optional));
    if (missing.length) problems.push(`${v} keyframe 0: missing ${missing.join(", ")}`);
    if (missing.length) continue;

    resolvePoses(spec, v).forEach((pose, i) => {
      for (const [a, b] of sk.bones) {
        const len = dist(pose[a], pose[b]);
        const max = sk.maxLength[boneKey(a, b)];
        if (len > max * 1.03) problems.push(`${v} keyframe ${i}: ${a}-${b} is ${len.toFixed(0)} long, max ${max}`);
        if (len < 2) problems.push(`${v} keyframe ${i}: ${a}-${b} has no length`);
      }
      for (const [j, [x, y]] of Object.entries(pose)) {
        if (y > FLOOR_Y + 2) problems.push(`${v} keyframe ${i}: ${j} is below the floor (y ${y})`);
        // The view box (scene.ts VIEWBOX) shows x 25-225, y 36-296.
        const top = j === "head" ? y - HEAD_RADIUS : y;
        if (x < 25 || x > 225 || top < 36) problems.push(`${v} keyframe ${i}: ${j} is outside the frame`);
      }
    });
    for (const p of props) {
      const joints = "at" in p && p.at !== undefined ? (Array.isArray(p.at) ? p.at : [p.at]) : [];
      for (const j of joints) if (!known.has(j)) problems.push(`${v}: ${p.type} is attached to unknown joint "${j}"`);
    }
  }
  return problems;
}
