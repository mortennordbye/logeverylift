/**
 * Turns an exercise spec into SVG markup for one view at one moment.
 *
 * Colours are CSS custom properties, never fixed hues: worked muscles take
 * `--primary` (the user's accent) and everything neutral is `--foreground`
 * mixed into `--card`, so a drawing follows the accent and light/dark theme
 * the same way the rest of the app does. The same function feeds the app
 * component and the preview script, so what an agent checks is what ships.
 */

import { resolvePoses, type ArtProp, type ArtSpec, type Point, type Pose } from "./schema";
import { FLOOR_Y, HEAD_RADIUS, SKELETONS, type Limb, type Muscle, type View } from "./skeleton";

// Cropped to where figures and equipment actually sit (checkSpec keeps joints
// inside it), so the figure fills its card.
export const VIEWBOX = "25 36 200 260";

type Role = "primary" | "secondary" | "limb" | "far" | "head" | "plate" | "equip" | "steel" | "seam" | "shadow";
type Shape = { d: string; role: Role; stroke?: number };

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

/** Shortest-way angle interpolation, so a limb never spins the long way round. */
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/**
 * The pose at `t` (0 = first keyframe, 1 = last). Bones swing around their
 * joints instead of joints sliding in straight lines, which would shrink a
 * forearm halfway through a curl; the anchor joint is the one held in place.
 */
export function poseAt(spec: ArtSpec, view: View, t: number): Pose {
  const poses = resolvePoses(spec, view);
  const span = poses.length - 1;
  const k = Math.min(span - 1, Math.floor(t * span));
  const u = t * span - k;
  const a = poses[k];
  const b = poses[k + 1];
  const anchor = spec.views[view].anchor;

  const neighbours = new Map<string, string[]>();
  for (const [x, y] of SKELETONS[view].bones) {
    neighbours.set(x, [...(neighbours.get(x) ?? []), y]);
    neighbours.set(y, [...(neighbours.get(y) ?? []), x]);
  }
  const out: Pose = { [anchor]: [lerp(a[anchor][0], b[anchor][0], u), lerp(a[anchor][1], b[anchor][1], u)] };
  const queue = [anchor];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of neighbours.get(parent) ?? []) {
      if (out[child]) continue;
      const angle = lerpAngle(
        Math.atan2(a[child][1] - a[parent][1], a[child][0] - a[parent][0]),
        Math.atan2(b[child][1] - b[parent][1], b[child][0] - b[parent][0]),
        u,
      );
      const len = lerp(Math.hypot(a[child][0] - a[parent][0], a[child][1] - a[parent][1]), Math.hypot(b[child][0] - b[parent][0], b[child][1] - b[parent][1]), u);
      out[child] = [out[parent][0] + Math.cos(angle) * len, out[parent][1] + Math.sin(angle) * len];
      queue.push(child);
    }
  }
  return out;
}

// ─── Geometry ───────────────────────────────────────────────────────────────

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const circle = ([x, y]: Point, r: number) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`;
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
function smoothClosed(pts: Point[]): string {
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
const mean = (ps: Point[]): Point => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];

/**
 * Front-view torso, laid out in the torso's own frame (across the shoulders,
 * down to the hips) so it follows a lean or a twist.
 */
function frontTorso(j: Pose, role: (m: Muscle[]) => Role): Shape[] {
  const top = mid(j.lShoulder, j.rShoulder);
  const bottom = mid(j.lHip, j.rHip);
  const halfTop = Math.hypot(j.rShoulder[0] - j.lShoulder[0], j.rShoulder[1] - j.lShoulder[1]) / 2;
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
    shape([[-1.1, 0], [-0.5, -0.12], [0, -0.14], [0.5, -0.12], [1.1, 0], [1.06, 0.2], [0.84, 0.55], [1.0, 0.98], [0.5, 1.08], [0, 1.1], [-0.5, 1.08], [-1.0, 0.98], [-0.84, 0.55], [-1.06, 0.2]], role([])),
    shape([[-1.02, 0.18], [-0.86, 0.2], [-0.66, 0.6], [-0.82, 0.6]], role(["back"])),
    shape([[1.02, 0.18], [0.86, 0.2], [0.66, 0.6], [0.82, 0.6]], role(["back"])),
    shape([[-0.9, 0.04], [0, 0.0], [0.9, 0.04], [0.84, 0.3], [0.44, 0.4], [0, 0.36], [-0.44, 0.4], [-0.84, 0.3]], role(["chest"])),
    seam([0, 0.03], [0, 0.37]),
    shape([[-0.4, 0.46], [0.4, 0.46], [0.38, 0.88], [0, 0.96], [-0.38, 0.88]], role(["abs"])),
    seam([0, 0.5], [0, 0.9]),
  ];
}

function propShapes(p: ArtProp, j: Pose, view: View): Shape[] {
  const wrists = view === "front" ? ["lWrist", "rWrist"] : ["wrist", "farWrist"];
  const at = ("at" in p && Array.isArray(p.at) ? p.at : wrists).map((n) => j[n]);
  switch (p.type) {
    case "barbell": {
      const [x, y] = mean(at);
      if (view === "side") {
        return [
          { d: circle([x, y], 24), role: "plate" },
          { d: circle([x, y], 16.5), role: "seam", stroke: 1.2 },
          { d: circle([x, y], 4), role: "steel" },
        ];
      }
      return [
        { d: rect(x - 84, y - 2, 168, 4, 2), role: "steel" as Role },
        ...[-1, 1].flatMap((s) => [
          { d: rect(x + s * 58 - 2, y - 6, 4, 12, 1.5), role: "steel" as Role },
          { d: rect(x + s * 64 - 4, y - 25, 8, 50, 2.5), role: "plate" as Role },
          { d: rect(x + s * 72 - 3, y - 18, 6, 36, 2), role: "plate" as Role },
        ]),
      ];
    }
    case "dumbbell":
      return at.flatMap(([x, y]) =>
        view === "side"
          ? [{ d: circle([x, y], 9.5), role: "plate" as Role }, { d: circle([x, y], 2.5), role: "steel" as Role }]
          : [
              { d: rect(x - 12, y - 1.8, 24, 3.6, 1.8), role: "steel" as Role },
              { d: rect(x - 15, y - 9, 6, 18, 2), role: "plate" as Role },
              { d: rect(x + 9, y - 9, 6, 18, 2), role: "plate" as Role },
            ],
      );
    case "kettlebell": {
      const [x, y] = mean(at);
      return [
        { d: `M${f(x - 8)} ${f(y + 10)}C${f(x - 9)} ${f(y - 4)} ${f(x + 9)} ${f(y - 4)} ${f(x + 8)} ${f(y + 10)}`, role: "steel", stroke: 3.5 },
        { d: circle([x, y + 20], 13), role: "plate" },
      ];
    }
    case "bench":
      return [
        { d: rect(p.x + 10, p.y + 8, 5, FLOOR_Y - p.y - 8, 2), role: "steel" },
        { d: rect(p.x + p.w - 15, p.y + 8, 5, FLOOR_Y - p.y - 8, 2), role: "steel" },
        { d: rect(p.x, p.y, p.w, 10, 4), role: "equip" },
      ];
    case "bar":
      return p.x1 === p.x2
        ? [{ d: circle([p.x1, p.y], 4.5), role: "steel" }]
        : [{ d: rect(Math.min(p.x1, p.x2), p.y - 2.5, Math.abs(p.x2 - p.x1), 5, 2.5), role: "steel" }];
    case "cable":
      return [
        { d: line(p.anchor, j[p.at]), role: "steel", stroke: 1.6 },
        { d: circle(p.anchor, 5), role: "equip" },
      ];
    case "box":
      return [{ d: rect(p.x, p.y, p.w, p.h, 4), role: "equip" }];
  }
}

/** Behind the hip, perpendicular to the spine (the side view faces right). */
function sideGlute(j: Pose): Point {
  const dx = j.chest[0] - j.hip[0];
  const dy = j.chest[1] - j.hip[1];
  const len = Math.hypot(dx, dy) || 1;
  return [j.hip[0] + (dy / len) * 6 - (dx / len) * 1, j.hip[1] - (dx / len) * 6 - (dy / len) * 1];
}

/** Every shape of one view at movement position `t`, back to front. */
export function buildScene(spec: ArtSpec, view: View, t: number): Shape[] {
  const j = poseAt(spec, view, t);
  const role = (muscles: Muscle[], far = false): Role =>
    muscles.includes(spec.primary) ? "primary"
    : muscles.some((m) => spec.secondary.includes(m)) ? "secondary"
    : far ? "far" : "limb";
  const limb = (l: Limb): Shape => ({ d: capsule(j[l.from], j[l.to], l.r[0], l.r[1]), role: role(l.muscles, l.depth === "far") });
  const { limbs } = SKELETONS[view];
  const props = spec.views[view].props;
  const propsIn = (layer: "back" | "mid" | "front") => props.filter((p) => p.layer === layer).flatMap((p) => propShapes(p, j, view));

  const feet = view === "front" ? [j.lToe, j.rToe, j.lAnkle, j.rAnkle] : [j.toe, j.ankle, j.farToe, j.farAnkle];
  const [shadowX] = mean(feet);
  const shadow: Shape = { d: `M${f(shadowX - 52)} ${FLOOR_Y}a52 6 0 1 0 104 0a52 6 0 1 0 -104 0Z`, role: "shadow" };

  const hands = view === "front" ? [j.lWrist, j.rWrist] : [j.wrist];
  const body: Shape[] =
    view === "front"
      ? [
          ...limbs.filter((l) => l.depth === "body" && l.from !== "neck").map(limb),
          { d: capsule(j.lHip, j.rHip, 13, 13), role: "limb" },
          ...frontTorso(j, (m) => role(m)),
          ...[j.lShoulder, j.rShoulder].map((p) => ({ d: circle(p, 9.5), role: role(["shoulders"]) })),
          limb(limbs.find((l) => l.from === "neck")!),
        ]
      : [
          ...limbs.filter((l) => l.depth === "body" && l.from === "neck").map(limb),
          // Seat of the hips, a little behind the hip joint, so the side
          // view is not a straight tube.
          { d: circle(sideGlute(j), 13), role: role(["glutes"]) },
          ...limbs.filter((l) => l.depth === "body" && l.from !== "neck").map(limb),
        ];

  return [
    shadow,
    ...propsIn("back"),
    ...(view === "side" ? [{ d: circle(j.farWrist, 4.8), role: "far" as Role }] : []),
    ...limbs.filter((l) => l.depth === "far").map(limb),
    ...body,
    { d: circle(j.head, HEAD_RADIUS), role: "head" },
    ...propsIn("mid"),
    ...limbs.filter((l) => l.depth === "near").map(limb),
    ...hands.map((p) => ({ d: circle(p, 5), role: "limb" as Role })),
    ...propsIn("front"),
  ];
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
  none: mix(FG, 18),
  body: mix(FG, 10),
  gap: "var(--card)",
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
