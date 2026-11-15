/**
 * The workout profile: one block per step over time, height = % FTP, colour =
 * power zone (docs/plans/bike-sessions.md, 5.1, 5.2 and 5.4). The Today card,
 * the session page and the player's progress bar draw it from this geometry.
 */

import { DEFAULT_IF } from "@/lib/utils/training-load";
import { resolveTarget, type ThresholdValues, type Workout, type WorkoutStep, type ZoneSet } from "@/lib/utils/workout-steps";

/** One timed step. `pct` is the middle of the target in % FTP. */
export type ProfileBlock = { seconds: number; pct: number; zone: number; fuel: boolean };

/** Coggan power zone of a % FTP: Z1 under 55, Z2 to 74, Z3 to 89, Z4 to 104, else Z5. */
export function powerZoneOf(pct: number): number {
  return pct < 55 ? 1 : pct < 75 ? 2 : pct < 90 ? 3 : pct < 105 ? 4 : 5;
}

const mid = (low: number | null, high: number | null): number | null => (low !== null && high !== null ? (low + high) / 2 : (low ?? high));

/** % FTP of a step: its power target, else the default intensity of its type. */
function stepPct(s: WorkoutStep, w: Workout, anchors: ThresholdValues, zones: ZoneSet | null): number {
  const t = s.target?.metric === "power" ? s.target : s.secondary?.metric === "power" ? s.secondary : undefined;
  if (t) {
    const r = resolveTarget(t, w.sport, anchors, undefined, zones);
    const fromForms = r.forms?.pctFtp ? mid(r.forms.pctFtp.low, r.forms.pctFtp.high) : null;
    if (fromForms !== null) return fromForms;
    if (t.anchor === "ftp" && t.zone === undefined) {
      const p = mid(t.low ?? null, t.high ?? null);
      if (p !== null) return p;
    }
    const watts = r.missing ? null : mid(r.low, r.high);
    if (watts !== null && anchors.ftp) return (watts / anchors.ftp) * 100;
  }
  return DEFAULT_IF[s.type] * 100;
}

/**
 * The blocks of a workout, repeats expanded. Steps that end by distance or by
 * Lap have no planned time and get no block.
 */
export function profileBlocks(w: Workout, anchors: ThresholdValues, zones: ZoneSet | null = null): ProfileBlock[] {
  const out: ProfileBlock[] = [];
  const add = (s: WorkoutStep) => {
    if (s.end.type !== "time") return;
    const pct = stepPct(s, w, anchors, zones);
    out.push({ seconds: s.end.seconds, pct, zone: powerZoneOf(pct), fuel: s.note !== undefined && /\beat\b/i.test(s.note) });
  };
  for (const n of w.steps) {
    if (n.type === "repeat") for (let i = 0; i < n.count; i++) n.steps.forEach(add);
    else add(n);
  }
  return out;
}

export type ProfileRect = { x: number; y: number; w: number; h: number; zone: number; fuel: boolean };
export type ProfileGeometry = {
  width: number;
  height: number;
  /** Bottom of the blocks; the minute axis sits under it. */
  base: number;
  rects: ProfileRect[];
  /** Height of the FTP line. */
  ftpY: number;
  totalSeconds: number;
  /** Minute marks at the start, the middle and the end. */
  ticks: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
};

const AXIS = 14;

/** Rectangles in a `width` x `height` box. The scale tops out at 110 % FTP, or higher when a block is above that. */
export function profileGeometry(blocks: ProfileBlock[], width: number, height: number, axis = true): ProfileGeometry {
  const total = blocks.reduce((a, b) => a + b.seconds, 0);
  const base = height - (axis ? AXIS : 0);
  const top = Math.max(110, ...blocks.map((b) => b.pct + 5));
  const y = (pct: number) => base - (pct / top) * base;
  let x = 0;
  const rects = blocks.map((b) => {
    const w = total > 0 ? (b.seconds / total) * width : 0;
    // A 1 px gap between blocks, so two blocks in one zone still read as two steps.
    const r = { x: x + 0.5, y: y(b.pct), w: Math.max(w - 1, 1), h: base - y(b.pct), zone: b.zone, fuel: b.fuel };
    x += w;
    return r;
  });
  const minutes = Math.round(total / 60);
  const ticks = axis && total > 0
    ? [
        { x: 0, label: "0", anchor: "start" as const },
        { x: width / 2, label: `${Math.round(minutes / 2)} min`, anchor: "middle" as const },
        { x: width, label: `${minutes}`, anchor: "end" as const },
      ]
    : [];
  return { width, height, base, rects, ftpY: y(100), totalSeconds: total, ticks };
}

/** X of the "now" marker after `seconds` of the planned time, kept inside the box. */
export function markerX(g: ProfileGeometry, seconds: number): number {
  if (g.totalSeconds <= 0) return 0;
  return Math.min(g.width, Math.max(0, (seconds / g.totalSeconds) * g.width));
}
