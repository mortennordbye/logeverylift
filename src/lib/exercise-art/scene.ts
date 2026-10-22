/**
 * Turns an exercise spec into SVG markup for one view at one moment.
 *
 * Colours are CSS custom properties, never fixed hues: worked muscles take
 * `--primary` (the user's accent) and everything neutral is `--foreground`
 * mixed into `--card`, so a drawing follows the accent and light/dark theme
 * the same way the rest of the app does. The same function feeds the app
 * component and the preview script, so what an agent checks is what ships.
 */

import { resolvePoses, type ArtProp, type ArtSpec, type Point3, type Pose } from "./schema";
import { BONES, CENTER_X, FLOOR_Y, HEAD_RADIUS, JOINTS, LIMBS, type Joint, type Muscle, type View } from "./skeleton";

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

const NEIGHBOURS = new Map<Joint, Joint[]>();
for (const { a, b } of BONES) {
  NEIGHBOURS.set(a, [...(NEIGHBOURS.get(a) ?? []), b]);
  NEIGHBOURS.set(b, [...(NEIGHBOURS.get(b) ?? []), a]);
}

/**
 * The 3D pose at `t` (0 = first keyframe, 1 = last). Each bone turns round
 * its parent joint in 3D, so it keeps its length and takes the real path: a
 * forearm curling toward the camera rises in the front view instead of
 * sweeping sideways through the body. The anchor joint is the one held still.
 */
export function poseAt(spec: ArtSpec, t: number): Pose {
  const poses = resolvePoses(spec);
  const span = poses.length - 1;
  const k = Math.min(span - 1, Math.floor(t * span));
  const u = t * span - k;
  const a = poses[k];
  const b = poses[k + 1];
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
  return out as Pose;
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

/** Screen position and depth (bigger = nearer the camera) of a 3D point. */
function project(p: Point3, view: View): { at: Point; depth: number } {
  return view === "front" ? { at: [p[0], p[1]], depth: p[2] } : { at: [CENTER_X + p[2], p[1]], depth: p[0] };
}

/**
 * Front torso, laid out in the torso's own frame (across the shoulders, down
 * to the hips) so it follows a lean or a twist.
 */
function frontTorso(j: Record<Joint, Point>, role: (m: Muscle[]) => Role): Shape[] {
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
    shape([[-1.02, 0.18], [-0.86, 0.2], [-0.66, 0.6], [-0.82, 0.6]], role(["back"])),
    shape([[1.02, 0.18], [0.86, 0.2], [0.66, 0.6], [0.82, 0.6]], role(["back"])),
    shape([[-0.9, 0.04], [0, 0.0], [0.9, 0.04], [0.84, 0.3], [0.44, 0.4], [0, 0.36], [-0.44, 0.4], [-0.84, 0.3]], role(["chest"])),
    seam([0, 0.03], [0, 0.37]),
    shape([[-0.4, 0.46], [0.4, 0.46], [0.38, 0.88], [0, 0.96], [-0.38, 0.88]], role(["abs"])),
    seam([0, 0.5], [0, 0.9]),
  ];
}

/** Side torso: spine capsules, plus the seat of the hips behind the pelvis. */
function sideTorso(j: Record<Joint, Point>, role: (m: Muscle[]) => Role): Shape[] {
  const dx = j.chest[0] - j.pelvis[0];
  const dy = j.chest[1] - j.pelvis[1];
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular to the spine, toward the lifter's back (the side view faces right).
  const glute: Point = [j.pelvis[0] + (dy / len) * 6 - (dx / len) * 1, j.pelvis[1] - (dx / len) * 6 - (dy / len) * 1];
  return [
    { d: circle(glute, 13), role: role(["glutes"]) },
    { d: capsule(j.pelvis, j.chest, 15, 17), role: role(["abs", "lower_back"]) },
    { d: capsule(j.chest, j.neck, 18, 12), role: role(["chest", "back"]) },
  ];
}

function propGroups(p: ArtProp, pose: Pose, view: View): Group[] {
  const pin = p.layer === "back" ? -1e6 : p.layer === "front" ? 1e6 : null;
  const group = (depth: number, shapes: Shape[]): Group => ({ depth: pin ?? depth, shapes });
  const wrists: Joint[] = ["lWrist", "rWrist"];
  switch (p.type) {
    case "barbell": {
      const joints = (p.at ?? wrists).map((j) => pose[j]);
      const c = mean3(joints);
      const { at: [x, y] } = project(c, view);
      if (view === "side") {
        // The near plate sits outside the hands; drawing it just behind the
        // near arm keeps the grip readable.
        const near = Math.max(...joints.map((q) => q[0]));
        return [group(near - 1, [
          { d: circle([x, y], 24), role: "plate" },
          { d: circle([x, y], 16.5), role: "seam", stroke: 1.2 },
          { d: circle([x, y], 4), role: "steel" },
        ])];
      }
      return [group(c[2] - 1, [
        { d: rect(x - 84, y - 2, 168, 4, 2), role: "steel" },
        ...[-1, 1].flatMap((s): Shape[] => [
          { d: rect(x + s * 58 - 2, y - 6, 4, 12, 1.5), role: "steel" },
          { d: rect(x + s * 64 - 4, y - 25, 8, 50, 2.5), role: "plate" },
          { d: rect(x + s * 72 - 3, y - 18, 6, 36, 2), role: "plate" },
        ]),
      ])];
    }
    case "dumbbell":
      return (p.at ?? wrists).map((j) => {
        const { at: [x, y], depth } = project(pose[j], view);
        const endOn = (view === "front") === (p.along === "z");
        return group(depth - 1, endOn
          ? [{ d: circle([x, y], 9.5), role: "plate" }, { d: circle([x, y], 2.5), role: "steel" }]
          : [
              { d: rect(x - 12, y - 1.8, 24, 3.6, 1.8), role: "steel" },
              { d: rect(x - 15, y - 9, 6, 18, 2), role: "plate" },
              { d: rect(x + 9, y - 9, 6, 18, 2), role: "plate" },
            ]);
      });
    case "kettlebell": {
      const { at: [x, y], depth } = project(mean3(p.at.map((j) => pose[j])), view);
      return [group(depth - 1, [
        { d: `M${f(x - 8)} ${f(y + 10)}C${f(x - 9)} ${f(y - 4)} ${f(x + 9)} ${f(y - 4)} ${f(x + 8)} ${f(y + 10)}`, role: "steel", stroke: 3.5 },
        { d: circle([x, y + 20], 13), role: "plate" },
      ])];
    }
    case "bench":
    case "box": {
      const [x0, w] = view === "front" ? [CENTER_X - p.width / 2, p.width] : [CENTER_X + Math.min(p.z1, p.z2), Math.abs(p.z2 - p.z1)];
      return [group(-1e6, p.type === "box"
        ? [{ d: rect(x0, p.y, w, FLOOR_Y - p.y, 4), role: "equip" }]
        : [
            { d: rect(x0 + 6, p.y + 8, 5, FLOOR_Y - p.y - 8, 2), role: "steel" },
            { d: rect(x0 + w - 11, p.y + 8, 5, FLOOR_Y - p.y - 8, 2), role: "steel" },
            { d: rect(x0, p.y, w, 10, 4), role: "equip" },
          ])];
    }
    case "bar":
      return [group(-1e6, view === "front"
        ? [{ d: rect(32, p.y - 2.5, 186, 5, 2.5), role: "steel" }]
        : [{ d: circle([CENTER_X + p.z, p.y], 4.5), role: "steel" }])];
    case "cable": {
      const a = project(p.anchor, view).at;
      return [group(-1e6, [
        { d: line(a, project(pose[p.at], view).at), role: "steel", stroke: 1.6 },
        { d: circle(a, 5), role: "equip" },
      ])];
    }
  }
}

/** Every shape of one view at movement position `t`, back to front. */
export function buildScene(spec: ArtSpec, view: View, t: number): Shape[] {
  const pose = poseAt(spec, t);
  const j = {} as Record<Joint, Point>;
  const depth = {} as Record<Joint, number>;
  for (const name of JOINTS) {
    const pr = project(pose[name], view);
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
  const bias = { arm: view === "front" ? 4 : 0, leg: view === "front" ? -1 : 0 };

  const groups: Group[] = [
    { depth: torsoDepth, shapes: view === "front" ? frontTorso(j, (m) => role(m)) : sideTorso(j, (m) => role(m)) },
    { depth: torsoDepth + 0.1, shapes: [{ d: capsule(j.neck, j.head, 6.5, 6.5), role: "limb" }, { d: circle(j.head, HEAD_RADIUS), role: "head" }] },
    ...LIMBS.map((l): Group => {
      const d = (depth[l.from] + depth[l.to]) / 2 + bias[l.kind];
      const far = view === "side" && d < torsoDepth;
      const shapes: Shape[] = [{ d: capsule(j[l.from], j[l.to], l.r[0], l.r[1]), role: role(l.muscles, far) }];
      if (l.from.endsWith("Shoulder")) shapes.push({ d: circle(j[l.from], 9.5), role: role(["shoulders"], far) });
      if (l.to.endsWith("Wrist")) shapes.push({ d: circle(j[l.to], 5), role: far ? "far" : "limb" });
      return { depth: d, shapes };
    }),
    ...spec.props.flatMap((p) => propGroups(p, pose, view)),
  ];

  const feet = (["lToe", "rToe", "lAnkle", "rAnkle"] as const).map((n) => j[n][0]);
  const shadowX = feet.reduce((s, x) => s + x, 0) / feet.length;
  const shadow: Shape = { d: `M${f(shadowX - 52)} ${FLOOR_Y}a52 6 0 1 0 104 0a52 6 0 1 0 -104 0Z`, role: "shadow" };

  // Stable sort: equal depths keep the order above (torso before limbs).
  return [shadow, ...groups.map((g, i) => ({ g, i })).sort((a, b) => a.g.depth - b.g.depth || a.i - b.i).flatMap(({ g }) => g.shapes)];
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
export function renderSvg(spec: ArtSpec, view: View, t: number, id: string): string {
  const defs =
    SHADED.map((r) => `<linearGradient id="${id}-${r}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" style="stop-color:${mix(COLOR[r], 90, "white")}"/><stop offset="1" style="stop-color:${mix(COLOR[r], 84)}"/></linearGradient>`).join("") +
    `<radialGradient id="${id}-shadow"><stop offset="0" style="stop-color:${FG};stop-opacity:0.16"/><stop offset="1" style="stop-color:${FG};stop-opacity:0"/></radialGradient>`;
  const body = buildScene(spec, view, t)
    .map((s) =>
      s.stroke
        ? `<path d="${s.d}" style="fill:none;stroke:${COLOR[s.role]};stroke-width:${s.stroke};stroke-linecap:round"/>`
        : `<path d="${s.d}" style="fill:${SHADED.includes(s.role) || s.role === "shadow" ? `url(#${id}-${s.role})` : COLOR[s.role]}"/>`,
    )
    .join("");
  return `<defs>${defs}</defs>${body}`;
}
