/**
 * Turns an exercise spec into SVG markup for one view at one moment.
 *
 * Colours are CSS custom properties, never fixed hues: worked muscles take
 * `--primary` (the user's accent) and everything neutral is `--foreground`
 * mixed into `--card`, so a drawing follows the accent and light/dark theme
 * the same way the rest of the app does. The same function feeds the app
 * component and the preview script, so what an agent checks is what ships.
 */

import { hasHands, resolvePoses, type ArtProp, type ArtSpec, type Point3, type Pose } from "./schema";
import { BONES, CENTER_X, FLOOR_Y, HEAD_RADIUS, JOINTS, LIMBS, NEIGHBOURS, TOP_Y, isHand, isOblique, type Camera, type Joint, type Muscle, type View } from "./skeleton";

/** Where figures and equipment sit (checkSpec keeps joints inside it), so the figure fills its card. */
export const VIEWBOX = "25 36 200 260";

type Point = [number, number];
type Role = "primary" | "secondary" | "limb" | "far" | "head" | "plate" | "equip" | "steel" | "seam" | "shadow";
type Shape = { d: string; role: Role; stroke?: number };
/** Shapes that are painted together, ordered against other groups by depth (bigger = nearer the camera). */
type Group = { depth: number; shapes: Shape[] };

// ─── Motion ─────────────────────────────────────────────────────────────────

/** One full out-and-back cycle, in ms. */
export const CYCLE_MS = 3600;
/** Share of each half spent holding still at the ends. */
const HOLD = 0.12;

const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * Where in the movement we are at `ms`: `t` runs 0 → 1 over the way out and
 * back to 0 on the way back, with a short hold at each end; `phase` is 0 on
 * the way out, 1 on the way back.
 */
export function cycleAt(ms: number): { t: number; phase: 0 | 1 } {
  const p = (((ms % CYCLE_MS) + CYCLE_MS) % CYCLE_MS) / CYCLE_MS;
  const half = p < 0.5 ? p * 2 : (p - 0.5) * 2;
  const u = Math.min(1, Math.max(0, (half - HOLD) / (1 - 2 * HOLD)));
  const eased = smooth(u);
  return p < 0.5 ? { t: eased, phase: 0 } : { t: 1 - eased, phase: 1 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (v: Point3) => Math.hypot(v[0], v[1], v[2]);

/** Rotate unit vector `u` toward unit vector `v` by fraction t, along the shortest arc. */
function slerp(u: Point3, v: Point3, t: number): Point3 {
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const theta = Math.acos(dot);
  if (theta < 1e-4) return u;
  const s = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / s;
  const b = Math.sin(t * theta) / s;
  return [u[0] * a + v[0] * b, u[1] * a + v[1] * b, u[2] * a + v[2] * b];
}

/**
 * The 3D pose at `t` (0 = first keyframe, 1 = last). Each bone turns round
 * its parent joint in 3D, so it keeps its length and takes the real path: a
 * forearm curling toward the camera rises in the front view instead of
 * sweeping sideways through the body. The anchor joint is the one held still.
 * On the way back (`phase` 1, t running 1 to 0) a "loop" spec goes from the
 * last keyframe straight to the first instead of retracing its keyframes.
 */
export function poseAt(spec: ArtSpec, t: number, phase: 0 | 1 = 0): Pose {
  const poses = resolvePoses(spec);
  if (spec.cycle !== "loop") return along(spec, poses, t);
  const turn = Math.min(spec.turnAt ?? poses.length - 1, poses.length - 1);
  return phase === 0 ? along(spec, poses.slice(0, turn + 1), t) : along(spec, [...poses.slice(turn), poses[0]], 1 - t);
}

/** The pose a fraction `t` of the way along a path of keyframe poses. */
function along(spec: ArtSpec, path: Pose[], t: number): Pose {
  const span = path.length - 1;
  const k = Math.min(span - 1, Math.floor(t * span));
  return blend(spec, path[k], path[k + 1], t * span - k);
}

/** The pose a fraction `u` of the way from keyframe pose `a` to `b`. */
function blend(spec: ArtSpec, a: Pose, b: Pose, u: number): Pose {
  const out: Partial<Pose> = {
    [spec.anchor]: [0, 1, 2].map((i) => lerp(a[spec.anchor][i], b[spec.anchor][i], u)) as Point3,
  };
  const queue: Joint[] = [spec.anchor];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of NEIGHBOURS.get(parent) ?? []) {
      if (out[child]) continue;
      const va = sub(a[child], a[parent]);
      const vb = sub(b[child], b[parent]);
      const la = len3(va);
      const lb = len3(vb);
      const dir = slerp(va.map((c) => c / la) as Point3, vb.map((c) => c / lb) as Point3, u);
      const l = lerp(la, lb, u) / (len3(dir) || 1);
      const p = out[parent]!;
      out[child] = [p[0] + dir[0] * l, p[1] + dir[1] * l, p[2] + dir[2] * l];
      queue.push(child);
    }
  }
  const pose = out as Pose;
  // A foot that does not move between these keyframes is held too, so it
  // stays planted while the leg above it moves. Fitting bone lengths can
  // shift a planted ankle a unit or two, so "does not move" allows that.
  const still = (["lAnkle", "rAnkle"] as const).filter((f) => len3(sub(a[f], b[f])) < 3);
  for (const held of new Set([...spec.hold, ...still])) {
    if (held === spec.anchor) continue;
    const target = [0, 1, 2].map((i) => lerp(a[held][i], b[held][i], u)) as Point3;
    // The foot or hand past the held joint moves with it.
    const tip = TIP[held];
    const offset = sub(pose[tip], pose[held]);
    const [root, middle] = CHAIN[held];
    solveTwoBone(pose, root, middle, held, target);
    pose[tip] = [0, 1, 2].map((i) => pose[held][i] + offset[i]) as Point3;
  }
  return pose;
}

const CHAIN = {
  lWrist: ["lShoulder", "lElbow"],
  rWrist: ["rShoulder", "rElbow"],
  lAnkle: ["lHip", "lKnee"],
  rAnkle: ["rHip", "rKnee"],
} as const satisfies Record<string, [Joint, Joint]>;

const TIP = { lWrist: "lHand", rWrist: "rHand", lAnkle: "lToe", rAnkle: "rToe" } as const satisfies Record<keyof typeof CHAIN, Joint>;

/**
 * Put `end` on `target` (or as close as the limb reaches) and bend the middle
 * joint the way it already bends, keeping both bones their length.
 */
function solveTwoBone(pose: Pose, root: Joint, middle: Joint, end: Joint, target: Point3) {
  const r = pose[root];
  const l1 = len3(sub(pose[middle], r));
  const l2 = len3(sub(pose[end], pose[middle]));
  const toTarget = sub(target, r);
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, len3(toTarget)));
  const dir = toTarget.map((c) => c / (len3(toTarget) || 1)) as Point3;
  // Bend toward where the middle joint already is, off the root-target line.
  const hint = sub(pose[middle], r);
  const along = hint[0] * dir[0] + hint[1] * dir[1] + hint[2] * dir[2];
  const off = sub(hint, dir.map((c) => c * along) as Point3);
  const offLen = len3(off);
  const bend: Point3 = offLen > 1e-6 ? (off.map((c) => c / offLen) as Point3) : [0, 0, 1];
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  pose[middle] = [0, 1, 2].map((i) => r[i] + dir[i] * a + bend[i] * h) as Point3;
  pose[end] = [0, 1, 2].map((i) => r[i] + dir[i] * d) as Point3;
}

// ─── Geometry ───────────────────────────────────────────────────────────────

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const circle = ([x, y]: Point, r: number) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
const rect = (x: number, y: number, w: number, h: number, r = 0) => {
  r = Math.min(r, w / 2, h / 2);
  return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`;
};
const line = (a: Point, b: Point) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`;

/** A limb: two circles joined by their outer tangents. */
export function capsule(a: Point, b: Point, ra: number, rb: number): string {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d <= Math.abs(ra - rb) + 0.01) return ra >= rb ? circle(a, ra) : circle(b, rb);
  const theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const phi = Math.acos((ra - rb) / d);
  const at = (c: Point, r: number, ang: number): Point => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
  const a1 = at(a, ra, theta + phi);
  const b1 = at(b, rb, theta + phi);
  const b2 = at(b, rb, theta - phi);
  const a2 = at(a, ra, theta - phi);
  const bLarge = 2 * phi > Math.PI ? 1 : 0;
  const aLarge = 2 * Math.PI - 2 * phi > Math.PI ? 1 : 0;
  return `M${f(a1[0])} ${f(a1[1])}L${f(b1[0])} ${f(b1[1])}A${f(rb)} ${f(rb)} 0 ${bLarge} 0 ${f(b2[0])} ${f(b2[1])}L${f(a2[0])} ${f(a2[1])}A${f(ra)} ${f(ra)} 0 ${aLarge} 0 ${f(a1[0])} ${f(a1[1])}Z`;
}

/** Closed Catmull-Rom curve through the points, for organic shapes. */
export function smoothClosed(pts: Point[]): string {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const mean3 = (ps: Point3[]): Point3 => [0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length) as Point3;

/** The camera a spec's view uses: the front slot's, or the side slot's ("front" there meaning plain side-on). */
export function cameraFor(spec: ArtSpec, view: View): Camera {
  return view === "front" ? spec.camera : spec.sideCamera === "angled" ? "angled" : "front";
}

/** The angled cameras turn 35 degrees off the plain view and look 14 degrees down. */
const YAW = (35 * Math.PI) / 180;
const PITCH = (14 * Math.PI) / 180;

/** Screen position and depth (bigger = nearer the camera) of a 3D point. */
export function project(p: Point3, view: View, camera: Camera): { at: Point; depth: number } {
  if (isOblique(camera)) {
    // Front slot: from the front-right, or from behind-right. Side slot: from the side, turned toward the front.
    const dx = p[0] - CENTER_X;
    const yaw = camera === "behind" ? Math.PI - YAW : YAW;
    const [sx, toward] = view === "front"
      ? [dx * Math.cos(yaw) - p[2] * Math.sin(yaw), dx * Math.sin(yaw) + p[2] * Math.cos(yaw)]
      : [p[2] * Math.cos(YAW) - dx * Math.sin(YAW), dx * Math.cos(YAW) + p[2] * Math.sin(YAW)];
    const dy = p[1] - FLOOR_Y;
    return {
      at: [CENTER_X + sx, FLOOR_Y + dy * Math.cos(PITCH) + toward * Math.sin(PITCH)],
      depth: toward * Math.cos(PITCH) - dy * Math.sin(PITCH),
    };
  }
  if (view === "side") return { at: [CENTER_X + p[2], p[1]], depth: p[0] };
  return camera === "top" ? { at: [p[0], TOP_Y + p[2]], depth: -p[1] } : { at: [p[0], p[1]], depth: p[2] };
}

/** Where `zoom` shrinks a view toward: the middle of the floor, or of the view from above. */
function zoomOrigin(view: View, camera: Camera): Point {
  return view === "front" && camera === "top" ? [CENTER_X, TOP_Y] : [CENTER_X, FLOOR_Y];
}

/** The spec's zoom for one view: `frontZoom` overrides `zoom` for the front (or top) view. */
export function zoomOf(spec: ArtSpec, view: View): number {
  return view === "front" ? (spec.frontZoom ?? spec.zoom) : spec.zoom;
}

/** Where a projected point lands once the spec's zoom is applied. */
export function zoomed([x, y]: Point, view: View, spec: ArtSpec): Point {
  const [ox, oy] = zoomOrigin(view, cameraFor(spec, view));
  const z = zoomOf(spec, view);
  return [ox + (x - ox) * z, oy + (y - oy) * z];
}

const unit = (v: Point3): Point3 => {
  const n = len3(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The seat of the hips: behind the pelvis, whichever way the body faces. */
function glutePoint(pose: Pose): Point3 {
  const up = unit(sub(pose.chest, pose.pelvis));
  const forward = unit(cross(up, sub(pose.rHip, pose.lHip)));
  return [0, 1, 2].map((i) => pose.pelvis[i] - forward[i] * 6 - up[i]) as Point3;
}

/**
 * Front torso, laid out in the torso's own frame (across the shoulders, down
 * to the hips) so it follows a lean or a twist.
 */
function frontTorso(j: Record<Joint, Point>, role: (m: Muscle[]) => Role, camera: Camera): Shape[] {
  const top = mid(j.lShoulder, j.rShoulder);
  const bottom = mid(j.lHip, j.rHip);
  const halfTop = Math.hypot(j.rShoulder[0] - j.lShoulder[0], j.rShoulder[1] - j.lShoulder[1]) / 2 || 1;
  const halfBottom = Math.hypot(j.rHip[0] - j.lHip[0], j.rHip[1] - j.lHip[1]) / 2 + 7;
  const across: Point = [(j.rShoulder[0] - j.lShoulder[0]) / (2 * halfTop), (j.rShoulder[1] - j.lShoulder[1]) / (2 * halfTop)];
  // sx: -1 (screen-left edge) .. 1; sy: 0 (shoulder line) .. 1 (hip line).
  const at = (sx: number, sy: number): Point => {
    const c: Point = [lerp(top[0], bottom[0], sy), lerp(top[1], bottom[1], sy)];
    const half = lerp(halfTop, halfBottom, sy);
    return [c[0] + across[0] * sx * half, c[1] + across[1] * sx * half];
  };
  const shape = (pts: [number, number][], r: Role): Shape => ({ d: smoothClosed(pts.map(([x, y]) => at(x, y))), role: r });
  const seam = (a: [number, number], b: [number, number]): Shape => ({ d: line(at(...a), at(...b)), role: "seam", stroke: 1.4 });
  return [
    { d: capsule(j.lHip, j.rHip, 13, 13), role: "limb" },
    shape([[-1.1, 0], [-0.5, -0.12], [0, -0.14], [0.5, -0.12], [1.1, 0], [1.06, 0.2], [0.84, 0.55], [1.0, 0.98], [0.5, 1.08], [0, 1.1], [-0.5, 1.08], [-1.0, 0.98], [-0.84, 0.55], [-1.06, 0.2]], role([])),
    // Upper traps: the slope from the neck to each shoulder, above the chest.
    shape([[-0.18, -0.22], [-0.55, -0.15], [-0.92, -0.02], [-0.84, 0.08], [-0.5, 0.04], [-0.2, 0.02]], role(["back"])),
    shape([[0.18, -0.22], [0.55, -0.15], [0.92, -0.02], [0.84, 0.08], [0.5, 0.04], [0.2, 0.02]], role(["back"])),
    shape([[-1.02, 0.18], [-0.86, 0.2], [-0.66, 0.6], [-0.82, 0.6]], role(["back"])),
    shape([[1.02, 0.18], [0.86, 0.2], [0.66, 0.6], [0.82, 0.6]], role(["back"])),
    shape([[-0.9, 0.04], [0, 0.0], [0.9, 0.04], [0.84, 0.3], [0.44, 0.4], [0, 0.36], [-0.44, 0.4], [-0.84, 0.3]], role(["chest"])),
    seam([0, 0.03], [0, 0.37]),
    // From above the lower panel can be either side of the body, as in the side view.
    shape([[-0.4, 0.46], [0.4, 0.46], [0.38, 0.88], [0, 0.96], [-0.38, 0.88]], role(camera === "top" ? ["abs", "lower_back"] : ["abs"])),
    seam([0, 0.5], [0, 0.9]),
  ];
}

/** Side torso: spine capsules, plus the seat of the hips behind the pelvis. */
function sideTorso(j: Record<Joint, Point>, glute: Point, role: (m: Muscle[]) => Role): Shape[] {
  return [
    { d: circle(glute, 13), role: role(["glutes"]) },
    { d: capsule(j.pelvis, j.chest, 15, 17), role: role(["abs", "lower_back"]) },
    { d: capsule(j.chest, j.neck, 18, 12), role: role(["chest", "back"]) },
  ];
}

/**
 * A neutral grip's handle: at right angles to the forearm, in the plane the
 * forearm swings in (so hanging it runs along z, held level it stands upright).
 */
function handleAxis(pose: Pose, j: Joint): Point3 {
  const elbow = j.endsWith("Wrist") ? pose[j.replace("Wrist", "Elbow") as Joint] : null;
  if (!elbow) return [0, 0, 1];
  const d = unit(sub(pose[j], elbow));
  const h: Point3 = [0, -d[2], d[1]];
  return len3(h) < 0.2 ? [0, 0, 1] : unit(h);
}

/** A dumbbell whose handle points along `axis`, foreshortened in the view. */
function turnedDumbbell(c: Point, axis: Point3, view: View, camera: Camera): Shape[] {
  const v: Point = isOblique(camera) ? screenDir(axis, view, camera) : view === "side" ? [axis[2], axis[1]] : camera === "top" ? [axis[0], axis[2]] : [axis[0], axis[1]];
  const shown = Math.hypot(v[0], v[1]);
  if (shown < 0.35) return [{ d: circle(c, 9.5), role: "plate" }, { d: circle(c, 2.5), role: "steel" }];
  const n: Point = [-v[1] / shown, v[0] / shown];
  const at = (k: number, m = 0): Point => [c[0] + v[0] * k + n[0] * m, c[1] + v[1] * k + n[1] * m];
  return [
    { d: line(at(-12), at(12)), role: "steel", stroke: 3.6 },
    ...[-1, 1].map((s): Shape => ({ d: capsule(at(s * 12, -6), at(s * 12, 6), 3, 3), role: "plate" })),
  ];
}

function propGroups(p: ArtProp, pose: Pose, view: View, camera: Camera): Group[] {
  const pin = p.layer === "back" ? -1e6 : p.layer === "front" ? 1e6 : null;
  const group = (depth: number, shapes: Shape[]): Group => ({ depth: pin ?? depth, shapes });
  if (isOblique(camera)) {
    const drawn = angledProp(p, pose, view, camera, group);
    if (drawn) return drawn;
  }
  const wrists: Joint[] = ["lWrist", "rWrist"];
  switch (p.type) {
    case "barbell": {
      const joints = (p.at ?? wrists).map((j) => pose[j]);
      const c = mean3(joints);
      const { at: [x, y] } = project(c, view, camera);
      const fists = gripGroups(p, pose, view, camera, group);
      if (view === "side") {
        // In the hands, the near plate is drawn just behind the near arm so
        // the grip stays readable. Racked on the body (a back squat), it goes
        // behind the figure rather than over the face.
        const inHands = (p.at ?? wrists).every((j) => j.endsWith("Wrist") || isHand(j));
        const near = Math.max(...joints.map((q) => q[0]));
        const aboveChest = p.layer === "body" && c[1] < pose.chest[1];
        const depth = aboveChest ? Math.min(pose.pelvis[0], pose.head[0]) - 1 : inHands ? near - 1 : -1e5;
        return [group(depth, [
          { d: circle([x, y], 24), role: "plate" },
          { d: circle([x, y], 16.5), role: "seam", stroke: 1.2 },
          { d: circle([x, y], 4), role: "steel" },
        ]), ...fists];
      }
      // An EZ bar's W: the hands sit on the angled stretches either side of the middle.
      const camber: [number, number][] = [[-84, 0], [-30, 0], [-24, 5], [-11, -4], [-4, 1], [4, 1], [11, -4], [24, 5], [30, 0], [84, 0]];
      return [group(c[2] - 1, [
        p.cambered
          ? { d: camber.map(([dx, dy], i) => `${i ? "L" : "M"}${f(x + dx)} ${f(y + dy)}`).join(""), role: "steel", stroke: 4 }
          : { d: rect(x - 84, y - 2, 168, 4, 2), role: "steel" },
        ...[-1, 1].flatMap((s): Shape[] => [
          { d: rect(x + s * 58 - 2, y - 6, 4, 12, 1.5), role: "steel" },
          { d: rect(x + s * 64 - 4, y - 25, 8, 50, 2.5), role: "plate" },
          { d: rect(x + s * 72 - 3, y - 18, 6, 36, 2), role: "plate" },
        ]),
      ]), ...fists];
    }
    case "dumbbell":
      return (p.at ?? wrists).map((j) => {
        const { at: [x, y], depth } = project(pose[j], view, camera);
        if (p.along === "forearm") return group(depth - 1, turnedDumbbell([x, y], handleAxis(pose, j), view, camera));
        // Seen end-on, a dumbbell is a disc; from above, a neutral grip runs down the screen.
        const endOn = view === "front" && camera === "front" ? p.along === "z" : view === "side" && p.along === "x";
        const vertical = view === "front" && camera === "top" && p.along === "z";
        return group(depth - 1, endOn
          ? [{ d: circle([x, y], 9.5), role: "plate" }, { d: circle([x, y], 2.5), role: "steel" }]
          : vertical
          ? [
              { d: rect(x - 1.8, y - 12, 3.6, 24, 1.8), role: "steel" },
              { d: rect(x - 9, y - 15, 18, 6, 2), role: "plate" },
              { d: rect(x - 9, y + 9, 18, 6, 2), role: "plate" },
            ]
          : [
              { d: rect(x - 12, y - 1.8, 24, 3.6, 1.8), role: "steel" },
              { d: rect(x - 15, y - 9, 6, 18, 2), role: "plate" },
              { d: rect(x + 9, y - 9, 6, 18, 2), role: "plate" },
            ]);
      });
    case "kettlebell": {
      const c = mean3(p.at.map((j) => pose[j]));
      const { at: [x, y], depth } = project(c, view, camera);
      // The bell's "down" on screen: straight down, or along the forearms, foreshortened.
      let [dx, dy]: Point = [0, 1];
      if (p.along === "forearm") {
        const elbows = p.at.map((j) => pose[j.replace("Wrist", "Elbow") as Joint]);
        const d = unit(sub(c, mean3(elbows)));
        const tip = project([c[0] + d[0], c[1] + d[1], c[2] + d[2]], view, camera).at;
        [dx, dy] = [tip[0] - x, tip[1] - y];
      }
      const at = (a: number, b: number): string => `${f(x + a * dy + b * dx)} ${f(y - a * dx + b * dy)}`;
      return [group(depth - 1, [
        { d: `M${at(-8, 10)}C${at(-9, -4)} ${at(9, -4)} ${at(8, 10)}`, role: "steel", stroke: 3.5 },
        { d: circle([x + 20 * dx, y + 20 * dy], 13), role: "plate" },
      ])];
    }
    case "bench":
    case "box": {
      const [x0, w] = view === "front" ? [CENTER_X - p.width / 2, p.width] : [CENTER_X + Math.min(p.z1, p.z2), Math.abs(p.z2 - p.z1)];
      if (view === "front" && camera === "top") {
        // From above: the pad (or box top) as a rounded slab along z.
        return [group(-1e6, [{ d: rect(x0, TOP_Y + Math.min(p.z1, p.z2), w, Math.abs(p.z2 - p.z1), 6), role: "equip" }])];
      }
      return [group(-1e6, p.type === "box"
        ? [{ d: rect(x0, p.y, w, FLOOR_Y - p.y, 4), role: "equip" }]
        : [
            { d: rect(x0 + 6, p.y + 8, 5, FLOOR_Y - p.y - 8, 2), role: "steel" },
            { d: rect(x0 + w - 11, p.y + 8, 5, FLOOR_Y - p.y - 8, 2), role: "steel" },
            { d: rect(x0, p.y, w, 10, 4), role: "equip" },
          ])];
    }
    case "incline": {
      const ys = [p.from[0], p.to[0]];
      const zs = [p.from[1], p.to[1]];
      if (view === "front") {
        const x0 = CENTER_X - p.width / 2;
        // With layer "auto" the pad sorts by depth from the front, so a body lying chest-down on it shows behind it.
        const padDepth = camera === "front" ? (zs[0] + zs[1]) / 2 : -1e6;
        return [group(padDepth, camera === "top"
          ? [{ d: rect(x0, TOP_Y + Math.min(...zs), p.width, Math.abs(zs[1] - zs[0]), 6), role: "equip" }]
          : [{ d: rect(x0, Math.min(...ys), p.width, Math.abs(ys[1] - ys[0]) + 10, 4), role: "equip" }])];
      }
      // Side: a 10-thick pad whose top surface is the from-to line, on the
      // side away from the lifter (down, or back for an upright pad).
      const a: Point = [CENTER_X + zs[0], ys[0]];
      const b: Point = [CENTER_X + zs[1], ys[1]];
      const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let n: Point = [-(b[1] - a[1]) / dl, (b[0] - a[0]) / dl];
      if (n[1] < 0 || (n[1] === 0 && n[0] > 0)) n = [-n[0], -n[1]];
      const off = (q: Point, k: number): Point => [q[0] + n[0] * k, q[1] + n[1] * k];
      const under = off(mid(a, b), 10);
      return [group(-1e6, [
        { d: rect(under[0] - 2.5, under[1], 5, Math.max(0, FLOOR_Y - under[1]), 2), role: "steel" },
        { d: capsule(off(a, 5), off(b, 5), 5, 5), role: "equip" },
      ])];
    }
    case "bars": {
      const [za, zb] = [Math.min(p.z1, p.z2), Math.max(p.z1, p.z2)];
      const xs = [CENTER_X - p.width / 2, CENTER_X + p.width / 2];
      if (view === "side") {
        return [group(-1e6, [
          ...[za + 4, zb - 4].map((z): Shape => ({ d: rect(CENTER_X + z - 2.5, p.y, 5, FLOOR_Y - p.y, 2), role: "steel" })),
          { d: rect(CENTER_X + za, p.y - 2.5, zb - za, 5, 2.5), role: "steel" },
        ])];
      }
      return [group(-1e6, xs.flatMap((x): Shape[] => camera === "top"
        ? [{ d: rect(x - 2.5, TOP_Y + za, 5, zb - za, 2.5), role: "steel" }]
        : [{ d: rect(x - 2.5, p.y, 5, FLOOR_Y - p.y, 2), role: "steel" }, { d: circle([x, p.y], 4.5), role: "steel" }]))];
    }
    case "bar":
      return [group(-1e6, view === "front"
        ? [{ d: rect(32, (camera === "top" ? TOP_Y + p.z : p.y) - 2.5, 186, 5, 2.5), role: "steel" }]
        : [{ d: circle([CENTER_X + p.z, p.y], 4.5), role: "steel" }])];
    case "roller": {
      // Riding on joints, the offset is in the limb's own frame (along the
      // bone into the joint, then across it) so the pad stays on the same
      // spot of a shin that turns through the rep.
      let c: Point3 = [CENTER_X, p.y!, p.z!];
      if (p.at) {
        const end = mean3(p.at.map((j) => pose[j]));
        const start = mean3(p.at.map((j) => pose[BONES.find((b) => b.b === j)?.a ?? j]));
        const dy = end[1] - start[1];
        const dz = end[2] - start[2];
        const n = Math.hypot(dy, dz) || 1;
        const [along, across] = p.offset;
        c = [CENTER_X, end[1] + (along * dy - across * dz) / n, end[2] + (along * dz + across * dy) / n];
      }
      const { at: [x, y], depth } = project(c, view, camera);
      if (view === "side") {
        // The pad's end cap is the outermost thing on the near side, so it
        // covers the near shin where they cross.
        const lever: Shape[] = p.pivot
          ? [
              { d: line([CENTER_X + p.pivot[1], p.pivot[0]], [x, y]), role: "steel", stroke: 4 },
              { d: circle([CENTER_X + p.pivot[1], p.pivot[0]], 4.5), role: "steel" },
            ]
          : [];
        return [group(CENTER_X + p.width / 2, [...lever, { d: circle([x, y], 8), role: "equip" }, { d: circle([x, y], 2.5), role: "steel" }])];
      }
      return [group(depth, [{ d: capsule([x - p.width / 2, y], [x + p.width / 2, y], 8, 8), role: "equip" }])];
    }
    case "cable": {
      const a = project(p.anchor, view, camera).at;
      return [group(-1e6, [
        { d: line(a, project(pose[p.at], view, camera).at), role: "steel", stroke: 1.6 },
        { d: circle(a, 5), role: "equip" },
      ])];
    }
    case "rings":
      // Rings hang with their face across the body: a full ring from the side, edge-on from the front.
      return (p.at ?? wrists).map((jn) => {
        const w = pose[jn];
        const { at: c, depth } = project(w, view, camera);
        return group(depth - 1, [
          { d: line(project([w[0], p.y, w[2]], view, camera).at, [c[0], c[1] - 7]), role: "steel", stroke: 1.6 },
          { d: disc(w, [1, 0, 0], 7, view, camera), role: "steel", stroke: 2.5 },
        ]);
      });
    case "landmine": {
      const joints = (p.at ?? wrists).map((jn) => pose[jn]);
      const c = mean3(joints);
      const pivot: Point3 = p.pivot.length === 3 ? p.pivot : [CENTER_X, p.pivot[0], p.pivot[1]];
      const d = unit(sub(c, pivot));
      // Hands on the end of the sleeve hold just past the plate; a handle under the bar sits just short of it.
      const past = p.plate === "past";
      const end: Point3 = [0, 1, 2].map((i) => c[i] + d[i] * (past ? 14 : 4)) as Point3;
      const plate: Point3 = [0, 1, 2].map((i) => c[i] + d[i] * (past ? 14 : -18)) as Point3;
      const near = view === "side" && !isOblique(camera) ? Math.max(...joints.map((q) => q[0])) : project(c, view, camera).depth;
      return [group(near - 1, [
        { d: line(project(pivot, view, camera).at, project(end, view, camera).at), role: "steel", stroke: 4 },
        { d: circle(project(pivot, view, camera).at, 4.5), role: "steel" },
        { d: disc(plate, d, 22, view, camera), role: "plate" },
      ])];
    }
    case "plate": {
      const c = mean3((p.at ?? wrists).map((jn) => pose[jn]));
      if (p.hang) c[1] += p.radius;
      const normal: Point3 = p.facing === "x" ? [1, 0, 0] : p.facing === "y" ? [0, 1, 0] : [0, 0, 1];
      return [group(project(c, view, camera).depth - 1, [
        { d: disc(c, normal, p.radius, view, camera), role: "plate" },
        { d: disc(c, normal, 4, view, camera), role: "steel" },
      ])];
    }
    case "ball": {
      const { at: c, depth } = project(mean3((p.at ?? wrists).map((jn) => pose[jn])), view, camera);
      return [group(depth - 1, [
        { d: circle(c, p.radius), role: "plate" },
        { d: line([c[0] - p.radius * 0.9, c[1]], [c[0] + p.radius * 0.9, c[1]]), role: "seam", stroke: 1.2 },
      ])];
    }
    case "wheel": {
      const joints = (p.at ?? wrists).map((jn) => pose[jn]);
      const c = mean3(joints);
      const ends = joints.length > 1 ? [project(joints[0], view, camera).at, project(joints.at(-1)!, view, camera).at] : null;
      return [group(project(c, view, camera).depth - 1, [
        ...(ends && view !== "side" ? [{ d: line(ends[0], ends[1]), role: "steel" as const, stroke: 3 }] : []),
        { d: disc(c, [1, 0, 0], 13, view, camera), role: "plate" },
        { d: circle(project(c, view, camera).at, 2.5), role: "steel" },
      ])];
    }
    case "wall": {
      // Drawn 8 thick on the side away from the lifter.
      const za = p.z < 0 ? p.z - 8 : p.z;
      if (view === "side") return [group(-1e6, [{ d: rect(CENTER_X + za, 36, 8, FLOOR_Y - 36, 1), role: "equip" }])];
      if (camera === "top") return [group(-1e6, [{ d: rect(32, TOP_Y + za, 186, 8, 1), role: "equip" }])];
      // From the front, a wall behind the lifter is a backdrop; one in front would hide them, so it is left out.
      return p.z < 0 ? [group(-1e6, [{ d: rect(36, 60, 178, FLOOR_Y - 60, 4), role: "equip" }])] : [];
    }
    case "pole":
      return [group(-1e6, [view === "side"
        ? { d: rect(CENTER_X + p.z - 3, 36, 6, FLOOR_Y - 36, 3), role: "steel" }
        : camera === "top"
        ? { d: circle([p.x, TOP_Y + p.z], 5), role: "steel" }
        : { d: rect(p.x - 3, 36, 6, FLOOR_Y - 36, 3), role: "steel" }])];
    case "band": {
      const pts = p.at.map((jn) => project(pose[jn], view, camera));
      const d = pts.map(({ at: [x, y] }, i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("");
      return [group(Math.max(...pts.map((q) => q.depth)) + 1, [{ d, role: "plate", stroke: 3.5 }])];
    }
    case "footplate": {
      const c = mean3((p.at ?? ["lToe", "rToe", "lAnkle", "rAnkle"]).map((jn) => pose[jn]));
      const face = unit([0, p.facing[0], p.facing[1]]);
      // The plate sits just behind the soles, its long side across the facing direction.
      const mid3: Point3 = [c[0], c[1] - face[1] * 5, c[2] - face[2] * 5];
      const along: Point3 = [0, -face[2], face[1]];
      const rail: Shape[] = p.rail ? [{ d: line(project(mid3, view, camera).at, project([c[0], p.rail[0], p.rail[1]], view, camera).at), role: "steel", stroke: 4 }] : [];
      return [group(project(mid3, view, camera).depth, [...rail, ...slab(mid3, along, p.length, p.width, view, camera)])];
    }
    case "sled": {
      const hands = (p.at ?? wrists).map((jn) => pose[jn]);
      const z0 = mean3(hands)[2] - 6;
      const top = FLOOR_Y - 24;
      const base: Shape[] = view === "side"
        ? [{ d: rect(CENTER_X + z0, top, 64, 24, 3), role: "equip" }]
        : camera === "top"
        ? [{ d: rect(CENTER_X - 30, TOP_Y + z0, 60, 64, 3), role: "equip" }]
        : [{ d: rect(CENTER_X - 30, top, 60, 24, 3), role: "equip" }];
      const weight: Point3 = [CENTER_X, top - 18, z0 + 42];
      return [
        group(project([CENTER_X, top, z0 + 32], view, camera).depth, [...base, { d: disc(weight, [1, 0, 0], 18, view, camera), role: "plate" }]),
        ...hands.map((h) => {
          const { at, depth } = project(h, view, camera);
          return group(depth - 1, [{ d: line(at, project([h[0], top, h[2]], view, camera).at), role: "steel", stroke: 4 }]);
        }),
      ];
    }
    case "pad": {
      const a = pose[p.at[0]];
      const b = pose[p.at[1]];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const n = Math.hypot(dy, dz) || 1;
      const shift = (q: Point3): Point3 => [CENTER_X, q[1] - (dz * p.offset) / n, q[2] + (dy * p.offset) / n];
      const [a2, b2] = [shift(a), shift(b)];
      const centre = mean3([a2, b2]);
      const length = len3(sub(b2, a2)) + 16;
      const rail: Shape[] = p.rail ? [{ d: line(project(b2, view, camera).at, project([CENTER_X, p.rail[0], p.rail[1]], view, camera).at), role: "steel", stroke: 4 }] : [];
      return [group(project(centre, view, camera).depth, [...rail, ...slab(centre, unit(sub(b2, a2)), length, p.width, view, camera)])];
    }
    case "handles":
      return (p.at ?? wrists).map((jn) => {
        const side = jn.startsWith("l") ? -1 : jn.startsWith("r") ? 1 : 0;
        const c: Point3 = [pose[jn][0] + side * p.out, pose[jn][1], pose[jn][2]];
        const axis: Point3 = p.along === "x" ? [1, 0, 0] : p.along === "y" ? [0, 1, 0] : [0, 0, 1];
        const [half, r] = p.size === "grip" ? [9, 2.6] : [17, 7];
        const end = (k: number) => project([0, 1, 2].map((i) => c[i] + axis[i] * k) as Point3, view, camera).at;
        const { at, depth } = project(c, view, camera);
        const pivot: Point3 | null = !p.pivot ? null
          : p.pivot.length === 3 ? [side > 0 ? 2 * CENTER_X - p.pivot[0] : p.pivot[0], p.pivot[1], p.pivot[2]]
          : [c[0], p.pivot[0], p.pivot[1]];
        const lever: Shape[] = pivot
          ? [
              { d: line(project(pivot, view, camera).at, at), role: "steel", stroke: 4 },
              { d: circle(project(pivot, view, camera).at, 4.5), role: "steel" },
            ]
          : [];
        return group(depth - 1, [...lever, { d: capsule(end(-half), end(half), r, r), role: p.size === "grip" ? "steel" : "equip" }]);
      });
  }
}

/**
 * A flat rectangular pad or plate centred on `c`: `length` along `along`,
 * `width` across x. Seen edge-on it is a 9-thick bar, face-on a rounded slab.
 */
function slab(c: Point3, along: Point3, length: number, width: number, view: View, camera: Camera): Shape[] {
  const corner = (u: number, v: number) => project([c[0] + v * width / 2, c[1] + along[1] * u * length / 2, c[2] + along[2] * u * length / 2], view, camera).at;
  const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const quad = pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("") + "Z";
  return [
    { d: quad, role: "equip" },
    { d: capsule(corner(-1, 0), corner(1, 0), 4.5, 4.5), role: "equip" },
  ];
}

/** A flat disc (plate, ring, wheel) of radius r facing `normal`, as the ellipse it projects to. */
function disc(c: Point3, normal: Point3, r: number, view: View, camera: Camera): string {
  const n = unit(normal);
  if (isOblique(camera)) return ring3(c, n, r, view, camera);
  const toward = view === "side" ? n[0] : camera === "top" ? -n[1] : n[2];
  const [sx, sy] = view === "side" ? [n[2], n[1]] : camera === "top" ? [n[0], n[2]] : [n[0], n[1]];
  const { at: [x, y] } = project(c, view, camera);
  const shown = Math.hypot(sx, sy);
  if (shown < 0.05) return circle([x, y], r);
  // The long axis runs across the projected normal; the short one shrinks with the tilt.
  const [ux, uy] = [-sy / shown, sx / shown];
  const minor = Math.max(3, r * Math.abs(toward));
  const rot = f((Math.atan2(uy, ux) * 180) / Math.PI);
  const a = `${f(x + ux * r)} ${f(y + uy * r)}`;
  const b = `${f(x - ux * r)} ${f(y - uy * r)}`;
  return `M${a}A${f(r)} ${f(minor)} ${rot} 1 0 ${b}A${f(r)} ${f(minor)} ${rot} 1 0 ${a}Z`;
}

// ─── Angled cameras ─────────────────────────────────────────────────────────
// The plain views draw flat equipment with screen-aligned shapes. An angled
// camera sees it obliquely, so those props are built from 3D solids and rods.

/** Screen direction of a 3D unit vector, as the angled camera projects it. */
function screenDir(v: Point3, view: View, camera: Camera): Point {
  const a = project([CENTER_X, FLOOR_Y, 0], view, camera).at;
  const b = project([CENTER_X + v[0], FLOOR_Y + v[1], v[2]], view, camera).at;
  return [b[0] - a[0], b[1] - a[1]];
}

/** A disc of radius r facing `n`, traced round its rim. */
function ring3(c: Point3, n: Point3, r: number, view: View, camera: Camera): string {
  const seed: Point3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(n, seed));
  const v = cross(n, u);
  const pts = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * 2 * Math.PI;
    return project([0, 1, 2].map((k) => c[k] + r * (u[k] * Math.cos(a) + v[k] * Math.sin(a))) as Point3, view, camera).at;
  });
  return polygon(pts);
}

const polygon = (pts: Point[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("") + "Z";

/** Convex hull of screen points (monotone chain). */
function hull(pts: Point[]): Point[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(s), ...half(s.reverse())];
}

/** An axis-aligned block from [x0, y0, z0] to [x1, y1, z1], as its outline on screen. */
function solid(lo: Point3, hi: Point3, view: View, camera: Camera): string {
  const corners: Point[] = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) corners.push(project([x, y, z], view, camera).at);
  return polygon(hull(corners));
}

/** A round bar of radius r from a to b. */
const rod = (a: Point3, b: Point3, r: number, view: View, camera: Camera): string => capsule(project(a, view, camera).at, project(b, view, camera).at, r, r);

/** Middle depth of a block, for sorting it against the body. */
const depthOf = (lo: Point3, hi: Point3, view: View, camera: Camera) => project(mean3([lo, hi]), view, camera).depth;

/**
 * Equipment the plain views draw flat, rebuilt in 3D for an angled camera.
 * Returns null for the props whose drawing already works from any angle.
 */
function angledProp(p: ArtProp, pose: Pose, view: View, camera: Camera, group: (depth: number, shapes: Shape[]) => Group): Group[] | null {
  const wrists: Joint[] = ["lWrist", "rWrist"];
  const xs = (w: number): [number, number] => [CENTER_X - w / 2, CENTER_X + w / 2];
  switch (p.type) {
    case "barbell": {
      const joints = (p.at ?? wrists).map((j) => pose[j]);
      const c = mean3(joints);
      const along = (k: number): Point3 => [c[0] + k, c[1], c[2]];
      const inHands = (p.at ?? wrists).every((j) => j.endsWith("Wrist") || isHand(j));
      return [
        group(inHands ? project(c, view, camera).depth - 1 : -1e5, [
          { d: rod(along(-84), along(84), 2, view, camera), role: "steel" },
          ...[-1, 1].flatMap((s): Shape[] => [
            { d: ring3(along(s * 64), [1, 0, 0], 25, view, camera), role: "plate" },
            { d: ring3(along(s * 72), [1, 0, 0], 18, view, camera), role: "plate" },
          ]),
        ]),
        ...gripGroups(p, pose, view, camera, group),
      ];
    }
    case "dumbbell": {
      if (p.along === "forearm") return null;
      const axis: Point3 = p.along === "x" ? [1, 0, 0] : [0, 0, 1];
      return (p.at ?? wrists).map((j) => {
        const { at, depth } = project(pose[j], view, camera);
        return group(depth - 1, turnedDumbbell(at, axis, view, camera));
      });
    }
    case "bench":
    case "box": {
      const [x0, x1] = xs(p.width);
      const [z0, z1] = [Math.min(p.z1, p.z2), Math.max(p.z1, p.z2)];
      if (p.type === "box") return [group(-1e6, [{ d: solid([x0, p.y, z0], [x1, FLOOR_Y, z1], view, camera), role: "equip" }])];
      return [group(-1e6, [
        ...[z0 + 8, z1 - 8].map((z): Shape => ({ d: rod([CENTER_X, p.y + 10, z], [CENTER_X, FLOOR_Y, z], 2.5, view, camera), role: "steel" })),
        { d: solid([x0, p.y, z0], [x1, p.y + 10, z1], view, camera), role: "equip" },
      ])];
    }
    case "incline": {
      const [x0, x1] = xs(p.width);
      const a: Point3 = [CENTER_X, p.from[0], p.from[1]];
      const b: Point3 = [CENTER_X, p.to[0], p.to[1]];
      const d = unit(sub(b, a));
      // The pad hangs 10 under its top surface, on the side away from the lifter.
      let n: Point3 = [0, -d[2], d[1]];
      if (n[1] < 0 || (n[1] === 0 && n[2] < 0)) n = [0, -n[1], -n[2]];
      const under = (q: Point3, k: number): Point3 => [q[0], q[1] + n[1] * k, q[2] + n[2] * k];
      const pts: Point[] = [];
      for (const q of [a, b]) for (const x of [x0, x1]) for (const k of [0, 10]) pts.push(project([x, under(q, k)[1], under(q, k)[2]], view, camera).at);
      const post = under(mean3([a, b]), 10);
      return [group(p.layer === "auto" ? project(mean3([a, b]), view, camera).depth : -1e6, [
        { d: rod(post, [CENTER_X, FLOOR_Y, post[2]], 2.5, view, camera), role: "steel" },
        { d: polygon(hull(pts)), role: "equip" },
      ])];
    }
    case "bars": {
      const [za, zb] = [Math.min(p.z1, p.z2), Math.max(p.z1, p.z2)];
      return [group(-1e6, xs(p.width).flatMap((x): Shape[] => [
        ...[za + 4, zb - 4].map((z): Shape => ({ d: rod([x, p.y, z], [x, FLOOR_Y, z], 2.5, view, camera), role: "steel" })),
        { d: rod([x, p.y, za], [x, p.y, zb], 2.5, view, camera), role: "steel" },
      ]))];
    }
    case "bar":
      return [group(-1e6, [{ d: rod([32, p.y, p.z], [218, p.y, p.z], 2.5, view, camera), role: "steel" }])];
    case "pole":
      return [group(-1e6, [{ d: rod([p.x, 36, p.z], [p.x, FLOOR_Y, p.z], 3, view, camera), role: "steel" }])];
    case "wall": {
      const za = p.z < 0 ? p.z - 8 : p.z;
      return [group(-1e6, [{ d: solid([36, 36, za], [214, FLOOR_Y, za + 8], view, camera), role: "equip" }])];
    }
    case "roller": {
      let c: Point3 = [CENTER_X, p.y!, p.z!];
      if (p.at) {
        const end = mean3(p.at.map((j) => pose[j]));
        const start = mean3(p.at.map((j) => pose[BONES.find((b) => b.b === j)?.a ?? j]));
        const dy = end[1] - start[1];
        const dz = end[2] - start[2];
        const n = Math.hypot(dy, dz) || 1;
        const [along, across] = p.offset;
        c = [CENTER_X, end[1] + (along * dy - across * dz) / n, end[2] + (along * dz + across * dy) / n];
      }
      const lever: Shape[] = p.pivot ? [{ d: rod([CENTER_X, p.pivot[0], p.pivot[1]], c, 2, view, camera), role: "steel" }] : [];
      return [group(project(c, view, camera).depth, [...lever, { d: rod([c[0] - p.width / 2, c[1], c[2]], [c[0] + p.width / 2, c[1], c[2]], 8, view, camera), role: "equip" }])];
    }
    case "sled": {
      const hands = (p.at ?? wrists).map((jn) => pose[jn]);
      const z0 = mean3(hands)[2] - 6;
      const top = FLOOR_Y - 24;
      const lo: Point3 = [CENTER_X - 30, top, z0];
      const hi: Point3 = [CENTER_X + 30, FLOOR_Y, z0 + 64];
      return [
        group(depthOf(lo, hi, view, camera), [
          { d: solid(lo, hi, view, camera), role: "equip" },
          { d: ring3([CENTER_X, top - 18, z0 + 42], [1, 0, 0], 18, view, camera), role: "plate" },
        ]),
        ...hands.map((h) => group(project(h, view, camera).depth - 1, [{ d: rod(h, [h[0], top, h[2]], 2, view, camera), role: "steel" }])),
      ];
    }
    default:
      return null;
  }
}

/**
 * Fists on a barbell (`grip`), so an underhand and an overhand grip read
 * differently. The hand is a small block on the bar whose back faces the
 * knuckle side, which turns with the forearm: forward when it hangs (an
 * overhand fist covers the bar from the front, an underhand one sits behind
 * it) and up when it is level (an overhand fist sits on top of the bar).
 * Only for grips at the wrists of a spec without hands.
 */
function gripGroups(p: ArtProp, pose: Pose, view: View, camera: Camera, group: (depth: number, shapes: Shape[]) => Group): Group[] {
  if (p.type !== "barbell" || !p.grip) return [];
  const sign = p.grip === "overhand" ? 1 : -1;
  return (p.at ?? ["lWrist", "rWrist"]).filter((j) => j.endsWith("Wrist")).map((j) => {
    const w = pose[j];
    const d = unit(sub(w, pose[j.replace("Wrist", "Elbow") as Joint]));
    const back: Point3 = unit([0, -d[2] * sign, d[1] * sign]);
    // across the bar (x), toward the back of the hand, and along the forearm
    const at = (a: number, b: number, c: number): Point3 => [w[0] + a, w[1] + back[1] * b + d[1] * c, w[2] + back[2] * b + d[2] * c];
    const corners: Point[] = [];
    for (const a of [-6.5, 6.5]) for (const b of [-1, 8]) for (const c of [-4, 5]) corners.push(project(at(a, b, c), view, camera).at);
    const ridge: Shape[] = sign > 0
      ? [
          { d: line(project(at(-6, 8, 2), view, camera).at, project(at(6, 8, 2), view, camera).at), role: "seam", stroke: 1.3 },
          ...[-2.5, 0, 2.5].map((a): Shape => ({ d: line(project(at(a, 8, 2), view, camera).at, project(at(a, 8, 5), view, camera).at), role: "seam", stroke: 1 })),
        ]
      : [];
    return group(project(at(0, 3.5, 0), view, camera).depth, [{ d: polygon(hull(corners)), role: "limb" }, ...ridge]);
  });
}

/** Every shape of one view at movement position `t`, back to front. */
export function buildScene(spec: ArtSpec, view: View, t: number, phase: 0 | 1 = 0): Shape[] {
  const pose = poseAt(spec, t, phase);
  const hands = hasHands(spec);
  const camera = cameraFor(spec, view);
  const j = {} as Record<Joint, Point>;
  const depth = {} as Record<Joint, number>;
  for (const name of JOINTS) {
    const pr = project(pose[name], view, camera);
    j[name] = pr.at;
    depth[name] = pr.depth;
  }
  const role = (muscles: Muscle[], far = false): Role =>
    muscles.includes(spec.primary) ? "primary"
    : muscles.some((m) => spec.secondary.includes(m)) ? "secondary"
    : far ? "far" : "limb";

  // The torso is the reference depth: limbs behind it in the side view are the far side.
  const torsoDepth = view === "front"
    ? (depth.lShoulder + depth.rShoulder + depth.lHip + depth.rHip) / 4 + 0.5
    : depth.pelvis + 0.5;
  // In the front view a limb level with the torso still has a side: an arm
  // hanging beside it reads in front, a thigh starts behind the hips.
  const fromFront = view === "front" && camera === "front";
  // One-sided work lights only the working side's limbs.
  const working = (from: Joint) => spec.worked === "both" || from.startsWith(spec.worked === "left" ? "l" : "r");
  const bias = { arm: fromFront ? 4 : 0, leg: fromFront ? -1 : 0 };

  const groups: Group[] = [
    { depth: torsoDepth, shapes: view === "front" ? frontTorso(j, (m) => role(m), camera) : sideTorso(j, project(glutePoint(pose), view, camera).at, (m) => role(m)) },
    { depth: Math.max(depth.head, torsoDepth + 0.1), shapes: [{ d: capsule(j.neck, j.head, 6.5, 6.5), role: "limb" }, { d: circle(j.head, HEAD_RADIUS), role: "head" }] },
    ...LIMBS.filter((l) => hands || !isHand(l.to)).map((l): Group => {
      const d = (depth[l.from] + depth[l.to]) / 2 + bias[l.kind];
      const far = view === "side" && d < torsoDepth;
      const lit = working(l.from);
      const shapes: Shape[] = [{ d: capsule(j[l.from], j[l.to], l.r[0], l.r[1]), role: role(lit ? l.muscles : [], far) }];
      if (l.from.endsWith("Shoulder")) shapes.push({ d: circle(j[l.from], 9.5), role: role(lit ? ["shoulders"] : [], far) });
      if (l.to.endsWith("Wrist")) shapes.push({ d: circle(j[l.to], 5), role: far ? "far" : "limb" });
      return { depth: d, shapes };
    }),
    ...spec.props.flatMap((p) => propGroups(p, pose, view, camera)),
  ];

  const feet = (["lToe", "rToe", "lAnkle", "rAnkle"] as const).map((n) => j[n][0]);
  const shadowX = feet.reduce((s, x) => s + x, 0) / feet.length;
  const shadow: Shape = { d: `M${f(shadowX - 52)} ${FLOOR_Y}a52 6 0 1 0 104 0a52 6 0 1 0 -104 0Z`, role: "shadow" };

  // Stable sort: equal depths keep the order above (torso before limbs).
  // No floor seen from above, so no shadow.
  const ground = view === "front" && camera === "top" ? [] : [shadow];
  return [...ground, ...groups.map((g, i) => ({ g, i })).sort((a, b) => a.g.depth - b.g.depth || a.i - b.i).flatMap(({ g }) => g.shapes)];
}

// ─── Paint ──────────────────────────────────────────────────────────────────

// oklab, not oklch: mixing an accent toward grey in oklch drags its hue round
// the wheel (blue came out purple).
const mix = (a: string, pct: number, b = "var(--card)") => `color-mix(in oklab, ${a} ${pct}%, ${b})`;
const FG = "var(--foreground)";

/** Base colour per role; filled shapes get a soft top-to-bottom shade of it. */
const COLOR: Record<Role, string> = {
  primary: "var(--primary)",
  secondary: mix("var(--primary)", 42),
  limb: mix(FG, 30),
  far: mix(FG, 17),
  head: mix(FG, 34),
  plate: mix(FG, 22),
  equip: mix(FG, 14),
  steel: mix(FG, 58),
  seam: "var(--card)",
  shadow: FG,
};
const SHADED: Role[] = ["primary", "secondary", "limb", "far", "head", "plate", "equip"];

/** Fills for the muscle map, matching the figure's worked and resting limbs. */
export const MUSCLE_FILL = {
  primary: COLOR.primary,
  secondary: COLOR.secondary,
  none: mix(FG, 22),
  body: mix(FG, 11),
  line: "var(--card)",
} as const;

/** SVG markup (inside an `<svg viewBox={VIEWBOX}>`) for one view at `t`. `id` must be unique on the page. */
export function renderSvg(spec: ArtSpec, view: View, t: number, id: string, phase: 0 | 1 = 0): string {
  const defs =
    SHADED.map((r) => `<linearGradient id="${id}-${r}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" style="stop-color:${mix(COLOR[r], 90, "white")}"/><stop offset="1" style="stop-color:${mix(COLOR[r], 84)}"/></linearGradient>`).join("") +
    `<radialGradient id="${id}-shadow"><stop offset="0" style="stop-color:${FG};stop-opacity:0.16"/><stop offset="1" style="stop-color:${FG};stop-opacity:0"/></radialGradient>`;
  const body = buildScene(spec, view, t, phase)
    .map((s) =>
      s.stroke
        ? `<path d="${s.d}" style="fill:none;stroke:${COLOR[s.role]};stroke-width:${s.stroke};stroke-linecap:round"/>`
        : `<path d="${s.d}" style="fill:${SHADED.includes(s.role) || s.role === "shadow" ? `url(#${id}-${s.role})` : COLOR[s.role]}"/>`,
    )
    .join("");
  const zoom = zoomOf(spec, view);
  if (zoom === 1) return `<defs>${defs}</defs>${body}`;
  const [ox, oy] = zoomOrigin(view, cameraFor(spec, view));
  return `<defs>${defs}</defs><g transform="translate(${ox} ${oy}) scale(${zoom}) translate(${-ox} ${-oy})">${body}</g>`;
}
