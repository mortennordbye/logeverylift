/**
 * The checks a spec must pass before it ships: shape, joints, frame, and the
 * motion between keyframes, which the small preview cannot show reliably.
 */

import { artSpecSchema, drawnJoints, resolveFrames, type Point3 } from "./schema";
import { cameraFor, poseAt, project, zoomed } from "./scene";
import { FLOOR_Y, HEAD_RADIUS, JOINTS, isHand, type Joint } from "./skeleton";

const dist = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Moments between keyframes the motion checks sample. */
const SAMPLES = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

/** Problems with a spec, as readable sentences. Empty means it can ship. */
export function checkSpec(raw: unknown): string[] {
  const parsed = artSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
  const spec = parsed.data;
  const problems: string[] = [];
  if (spec.secondary.includes(spec.primary)) problems.push(`secondary repeats the primary muscle "${spec.primary}"`);
  const missing = JOINTS.filter((j) => !isHand(j) && !spec.keyframes[0][j]);
  if (missing.length) return [...problems, `keyframe 0: missing ${missing.join(", ")}`];

  const { poses, misses } = resolveFrames(spec);
  for (const m of misses) {
    problems.push(`keyframe ${m.frame}: ${m.joint} is ${m.off.toFixed(0)} from where its bone puts it (${m.parent}-${m.joint} is ${m.length} long); check the joint`);
  }

  const inFrame = (p: Point3, joint: Joint) => {
    // The head's top edge, or its near edge seen from above.
    const r = joint === "head" ? HEAD_RADIUS : 0;
    const top: Point3 = [p[0], p[1] - r, p[2]];
    const front = spec.camera === "top" ? zoomed(project(p, "front", "top").at, "front", spec) : zoomed(project(top, "front", spec.camera).at, "front", spec);
    const [sx, sy] = zoomed(project(top, "side", cameraFor(spec, "side")).at, "side", spec);
    const fits = ([x, y]: [number, number], bottom: boolean) => x >= 25 && x <= 225 && y >= 36 && (!bottom || y <= 296);
    return fits(front, spec.camera === "top") && fits([sx, sy], false);
  };
  const joints = drawnJoints(spec);
  poses.forEach((pose, i) => {
    for (const j of joints) {
      if (pose[j][1] > FLOOR_Y + 2) problems.push(`keyframe ${i}: ${j} is below the floor (y ${pose[j][1].toFixed(0)})`);
      if (!inFrame(pose[j], j)) problems.push(`keyframe ${i}: ${j} is outside the frame`);
    }
  });

  // Between keyframes each bone turns on its own, so hands on one bar can
  // slide apart mid-rep and feet can dip through the floor.
  for (const p of spec.props) {
    if (p.type !== "barbell") continue;
    const [a, b] = p.at ?? ["lWrist", "rWrist"];
    if (!a || !b) continue;
    const widths = poses.map((pose) => dist(pose[a], pose[b]));
    const lo = Math.min(...widths) * 0.94;
    const hi = Math.max(...widths) * 1.06;
    const drift = SAMPLES.map((t) => ({ t, w: dist(poseAt(spec, t)[a], poseAt(spec, t)[b]) })).find(({ w }) => w < lo || w > hi);
    if (drift) {
      problems.push(`the grip on the barbell changes width mid-rep (${drift.w.toFixed(0)} at t=${drift.t}, keyframes ${widths.map((w) => w.toFixed(0)).join("/")}); add a middle keyframe that keeps ${a} and ${b} on the bar`);
    }
  }
  // A bar racked on the body (shoulders, hips) carries the hands with it only
  // if the hands are posed on it; catch them drifting off.
  for (const p of spec.props) {
    if (p.type !== "barbell" || !p.at || p.at.every((j) => j.endsWith("Wrist") || isHand(j))) continue;
    const at = p.at;
    for (const t of [0, ...SAMPLES, 1]) {
      const pose = poseAt(spec, t);
      const bar = [0, 1, 2].map((k) => at.reduce((s, j) => s + pose[j][k], 0) / at.length);
      const off = (["lWrist", "rWrist"] as const).find((w) => Math.hypot(pose[w][1] - bar[1], pose[w][2] - bar[2]) > 12);
      if (off) {
        problems.push(`${off} is off the barbell at t=${t} (${Math.hypot(pose[off][1] - bar[1], pose[off][2] - bar[2]).toFixed(0)} from it); pose the hands on the bar in every keyframe`);
        break;
      }
    }
  }
  // A loop spec also has its own way back, from the last keyframe to the first.
  const moments = [...SAMPLES.map((t) => [t, 0] as const), ...(spec.cycle === "loop" ? SAMPLES.map((t) => [t, 1] as const) : [])];
  for (const [t, phase] of moments) {
    const pose = poseAt(spec, t, phase);
    const sunk = joints.find((j) => pose[j][1] > FLOOR_Y + 3);
    if (sunk) {
      problems.push(`${sunk} goes through the floor mid-rep (${phase ? "on the way back, " : ""}t=${t}); add a middle keyframe`);
      break;
    }
  }
  return problems;
}
