/**
 * The workout editor's pure logic (docs/plans/bike-sessions.md, 5.3): the step
 * tree as a flat list for drag and drop, moves into and out of a repeat, the
 * step menu, "Easier 5 %" / "Harder 5 %", every form of a target as text, and
 * the profile blocks. The editor saves through parseWorkout like every writer.
 */

import { resolveTarget, type Workout, type WorkoutNode, type WorkoutRepeat, type WorkoutSport, type WorkoutStep, type WorkoutTarget, type ZoneSet } from "@/lib/utils/workout-steps";

/** The user's numbers the editor shows targets in. Null when not set. */
export type EditNumbers = { ftp: number | null; lthrBike: number | null; zones: ZoneSet | null };

// ── Ids ──────────────────────────────────────────────────────────────────────

function usedIds(nodes: WorkoutNode[]): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (n.id) ids.add(n.id);
    if (n.type === "repeat") for (const s of n.steps) if (s.id) ids.add(s.id);
  }
  return ids;
}

/** A source of ids that are not used in `w`: `e1`, `e2`, ... */
function idSource(nodes: WorkoutNode[]): () => string {
  const used = usedIds(nodes);
  let next = 1;
  return () => {
    while (used.has(`e${next}`)) next++;
    used.add(`e${next}`);
    return `e${next}`;
  };
}

/** Nodes with their own ids kept where free, and fresh ids where taken or missing. */
function withFreeIds(nodes: WorkoutNode[], existing: WorkoutNode[]): WorkoutNode[] {
  const used = usedIds(existing);
  const fresh = idSource(existing);
  const pick = (id: string | undefined) => {
    if (id && !used.has(id)) {
      used.add(id);
      return id;
    }
    let f = fresh();
    while (used.has(f)) f = fresh();
    used.add(f);
    return f;
  };
  return nodes.map((n) => (n.type === "repeat" ? { ...n, id: pick(n.id), steps: n.steps.map((s) => ({ ...s, id: pick(s.id) })) } : { ...n, id: pick(n.id) }));
}

// ── The flat list (drag and drop) ────────────────────────────────────────────

/** One row of the editor list: a step, a repeat's head, or a repeat's end. Only steps and heads move. */
export type FlatItem =
  | { key: string; kind: "step"; id: string; parent: string | null }
  | { key: string; kind: "head"; id: string }
  | { key: string; kind: "end"; id: string };

export const headKey = (id: string) => `h:${id}`;
export const endKey = (id: string) => `e:${id}`;

/** The workout's nodes as rows, in order. Every node must have an id (parseWorkout gives them). */
export function flatten(w: Workout): FlatItem[] {
  const out: FlatItem[] = [];
  for (const n of w.steps) {
    if (n.type === "repeat") {
      out.push({ key: headKey(n.id!), kind: "head", id: n.id! });
      for (const s of n.steps) out.push({ key: s.id!, kind: "step", id: s.id!, parent: n.id! });
      out.push({ key: endKey(n.id!), kind: "end", id: n.id! });
    } else {
      out.push({ key: n.id!, kind: "step", id: n.id!, parent: null });
    }
  }
  return out;
}

/** Rows back to nodes: a step between a head and its end goes into that repeat. An emptied repeat goes. */
function rebuild(items: FlatItem[], w: Workout): WorkoutNode[] {
  const steps = new Map<string, WorkoutStep>();
  const repeats = new Map<string, WorkoutRepeat>();
  for (const n of w.steps) {
    if (n.type === "repeat") {
      repeats.set(n.id!, n);
      for (const s of n.steps) steps.set(s.id!, s);
    } else {
      steps.set(n.id!, n);
    }
  }
  const out: WorkoutNode[] = [];
  let open: WorkoutRepeat | null = null;
  for (const it of items) {
    if (it.kind === "head") {
      open = { ...repeats.get(it.id)!, steps: [] };
    } else if (it.kind === "end") {
      if (open && open.steps.length) out.push(open);
      open = null;
    } else if (open) {
      open.steps.push(steps.get(it.id)!);
    } else {
      out.push(steps.get(it.id)!);
    }
  }
  return out;
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/**
 * Drop the row `activeKey` where the row `overKey` is, as a sortable list
 * does: a step dropped between a repeat's head and end goes into it, and out
 * of it when dropped past either. A repeat moves as a block and never lands
 * inside another repeat.
 */
export function moveNode(w: Workout, activeKey: string, overKey: string): Workout {
  const items = flatten(w);
  const from = items.findIndex((i) => i.key === activeKey);
  const to = items.findIndex((i) => i.key === overKey);
  if (from < 0 || to < 0 || from === to) return w;
  const active = items[from];
  if (active.kind === "end") return w;
  if (active.kind === "step") return { ...w, steps: rebuild(arrayMove(items, from, to), w) };

  const endAt = items.findIndex((i) => i.kind === "end" && i.id === active.id);
  if (to >= from && to <= endAt) return w;
  const block = items.slice(from, endAt + 1);
  const rest = [...items.slice(0, from), ...items.slice(endAt + 1)];
  const down = to > from;
  const over = items[to];
  // Inside another repeat: snap to that repeat's outer edge in the move's direction.
  const owner = over.kind === "step" ? over.parent : over.id;
  let at: number;
  if (owner) {
    at = down ? rest.findIndex((i) => i.kind === "end" && i.id === owner) + 1 : rest.findIndex((i) => i.kind === "head" && i.id === owner);
  } else {
    const o = rest.findIndex((i) => i.key === overKey);
    at = down ? o + 1 : o;
  }
  return { ...w, steps: rebuild([...rest.slice(0, at), ...block, ...rest.slice(at)], w) };
}

/** "Move up" / "Move down" in a step's or a repeat's menu: one row, into or out of a repeat at its edge. */
export function moveBy(w: Workout, key: string, delta: -1 | 1): Workout {
  const items = flatten(w);
  const at = items.findIndex((i) => i.key === key);
  if (at < 0) return w;
  let n = at + delta;
  // A repeat steps over a whole neighbouring repeat, from its edge.
  if (items[at].kind === "head" && delta === 1) n = items.findIndex((i) => i.kind === "end" && i.id === items[at].id) + 1;
  const neighbour = items[n];
  return neighbour ? moveNode(w, key, neighbour.key) : w;
}

// ── Step menu, Add, repeat block ─────────────────────────────────────────────

function mapSteps(w: Workout, fn: (s: WorkoutStep) => WorkoutStep): Workout {
  return { ...w, steps: w.steps.map((n) => (n.type === "repeat" ? { ...n, steps: n.steps.map(fn) } : fn(n))) };
}

/** The step or repeat with this id, or null. */
export function findNode(w: Workout, id: string): WorkoutStep | WorkoutRepeat | null {
  for (const n of w.steps) {
    if (n.id === id) return n;
    if (n.type === "repeat") for (const s of n.steps) if (s.id === id) return s;
  }
  return null;
}

export function updateStep(w: Workout, id: string, step: WorkoutStep): Workout {
  return mapSteps(w, (s) => (s.id === id ? { ...step, id } : s));
}

/** A copy of the step or repeat right after it, with fresh ids. */
export function duplicateNode(w: Workout, id: string): Workout {
  const fresh = idSource(w.steps);
  const steps: WorkoutNode[] = [];
  for (const n of w.steps) {
    steps.push(n);
    if (n.id === id) {
      steps.push(n.type === "repeat" ? { ...n, id: fresh(), steps: n.steps.map((s) => ({ ...s, id: fresh() })) } : { ...n, id: fresh() });
    } else if (n.type === "repeat" && n.steps.some((s) => s.id === id)) {
      const inner: WorkoutStep[] = [];
      for (const s of n.steps) {
        inner.push(s);
        if (s.id === id) inner.push({ ...s, id: fresh() });
      }
      steps[steps.length - 1] = { ...n, steps: inner };
    }
  }
  return { ...w, steps };
}

/** Delete a step or a whole repeat. A repeat left with no step goes too. */
export function deleteNode(w: Workout, id: string): Workout {
  const steps: WorkoutNode[] = [];
  for (const n of w.steps) {
    if (n.id === id) continue;
    if (n.type === "repeat") {
      const inner = n.steps.filter((s) => s.id !== id);
      if (inner.length) steps.push({ ...n, steps: inner });
    } else {
      steps.push(n);
    }
  }
  return { ...w, steps };
}

/** A new step at the end, or at the end of a repeat. */
export function addStep(w: Workout, step: WorkoutStep, intoRepeat?: string): Workout {
  const s = { ...step, id: idSource(w.steps)() };
  if (!intoRepeat) return { ...w, steps: [...w.steps, s] };
  return { ...w, steps: w.steps.map((n) => (n.type === "repeat" && n.id === intoRepeat ? { ...n, steps: [...n.steps, s] } : n)) };
}

/** Template nodes (or any nodes) at the end, with ids that do not clash. */
export function insertNodes(w: Workout, nodes: readonly WorkoutNode[]): Workout {
  return { ...w, steps: [...w.steps, ...withFreeIds([...nodes], w.steps)] };
}

/** The repeat's steps as plain steps in its place. */
export function ungroup(w: Workout, repeatId: string): Workout {
  return { ...w, steps: w.steps.flatMap((n) => (n.type === "repeat" && n.id === repeatId ? n.steps : [n])) };
}

export function setRepeatCount(w: Workout, repeatId: string, count: number): Workout {
  return { ...w, steps: w.steps.map((n) => (n.type === "repeat" && n.id === repeatId ? { ...n, count } : n)) };
}

// ── Easier 5 % / Harder 5 % ──────────────────────────────────────────────────

/** Percent bounds of a power or HR zone: resolved against an anchor of 100. */
function zonePercent(t: WorkoutTarget, sport: WorkoutSport): { low: number | null; high: number | null } {
  const r = resolveTarget(t, sport, { ftp: 100, lthr_bike: 100, lthr_run: 100 });
  return { low: r.low, high: r.high };
}

function scaleTarget(t: WorkoutTarget, factor: number, sport: WorkoutSport): WorkoutTarget {
  if (t.offsetLow !== undefined || t.metric === "pace" || t.metric === "cadence") return t;
  // A power zone becomes its % FTP range so it can scale. An HR zone stays: its bands are the watch's.
  if (t.zone !== undefined) {
    if (t.metric !== "power") return t;
    const z = zonePercent(t, sport);
    t = { metric: "power", anchor: "ftp", ...(z.low !== null && { low: z.low }), ...(z.high !== null && { high: z.high }) };
  }
  const s = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * factor));
  const out: WorkoutTarget = { metric: t.metric, anchor: t.anchor };
  const low = s(t.low);
  const high = s(t.high);
  if (low !== undefined) out.low = low;
  if (high !== undefined) out.high = high;
  return out;
}

/** "Easier 5 %" (0.95) and "Harder 5 %" (1.05): the main target of every work and steady step. */
export function scaleWorkout(w: Workout, factor: number): Workout {
  return mapSteps(w, (s) => ((s.type === "work" || s.type === "steady") && s.target ? { ...s, target: scaleTarget(s.target, factor, w.sport) } : s));
}

// ── Every form of a target ───────────────────────────────────────────────────

const POWER_ZONE_FROM = [0, 55, 75, 90, 105];

/** Coggan power zone of a percent of FTP. */
export function powerZone(pct: number): number {
  let z = 1;
  POWER_ZONE_FROM.forEach((from, i) => {
    if (pct >= from) z = i + 1;
  });
  return z;
}

function mid(low: number | null, high: number | null): number | null {
  if (low !== null && high !== null) return (low + high) / 2;
  return low ?? high;
}

/** "135-144 W", "under 140 bpm", "95 % FTP or more". */
export function rangeText(low: number | null | undefined, high: number | null | undefined, unit: string): string {
  const r = (n: number) => Math.round(n);
  if (low != null && high != null) return r(low) === r(high) ? `${r(low)} ${unit}` : `${r(low)}-${r(high)} ${unit}`;
  if (high != null) return `under ${r(high)} ${unit}`;
  if (low != null) return `${r(low)} ${unit} or more`;
  return "";
}

function hrZoneOf(bpm: number, zones: ZoneSet): number {
  let best = 1;
  zones.hr.forEach((b, i) => {
    if (b.low === null || bpm >= b.low) best = i + 1;
  });
  return best;
}

const zoneWord = (zones: ZoneSet) => (zones.source === "garmin" ? "Garmin" : "Your");

/**
 * A target in all its forms, from the user's numbers, as the step sheet shows
 * it while the user types: "140 W = 78 % FTP, power Z3". Null for no target.
 */
export function formsText(t: WorkoutTarget, sport: WorkoutSport, n: EditNumbers): string | null {
  if (t.metric === "power") {
    if (t.anchor === "absolute") {
      const main = rangeText(t.low, t.high, "W");
      if (!main) return null;
      if (!n.ftp) return `${main}. Set your FTP to see % FTP.`;
      const pl = t.low !== undefined ? (t.low / n.ftp) * 100 : null;
      const ph = t.high !== undefined ? (t.high / n.ftp) * 100 : null;
      return `${main} = ${rangeText(pl, ph, "% FTP")}, power Z${powerZone(mid(pl, ph)!)}`;
    }
    const pct = t.zone !== undefined ? zonePercent(t, sport) : { low: t.low ?? null, high: t.high ?? null };
    const pctText = rangeText(pct.low, pct.high, "% FTP");
    if (!pctText) return null;
    const zone = t.zone ?? powerZone(mid(pct.low, pct.high)!);
    const watts = n.ftp ? rangeText(pct.low !== null ? (pct.low * n.ftp) / 100 : null, pct.high !== null ? (pct.high * n.ftp) / 100 : null, "W") : null;
    if (t.zone !== undefined) return `Power Z${zone} = ${pctText}${watts ? ` = ${watts}` : ". Set your FTP to see watts."}`;
    return `${pctText} = ${watts ?? "set your FTP to see watts"}, power Z${zone}`;
  }
  if (t.metric === "hr") {
    if (t.anchor === "absolute") {
      const main = rangeText(t.low, t.high, "bpm");
      if (!main) return null;
      const m = mid(t.low ?? null, t.high ?? null)!;
      if (n.zones) return `${main} = ${zoneWord(n.zones)} Z${hrZoneOf(m, n.zones)}`;
      if (n.lthrBike && sport === "bike") return `${main} = ${rangeText(t.low !== undefined ? (t.low / n.lthrBike) * 100 : null, t.high !== undefined ? (t.high / n.lthrBike) * 100 : null, "% LTHR")}`;
      return main;
    }
    if (t.anchor === "lthr" && t.zone !== undefined) {
      if (n.zones) {
        const band = n.zones.hr[t.zone - 1];
        return `${zoneWord(n.zones)} Z${t.zone} = ${band ? rangeText(band.low, band.high, "bpm") : "no band"}`;
      }
      if (n.lthrBike && sport === "bike") {
        const r = resolveTarget(t, sport, { lthr_bike: n.lthrBike });
        return `Z${t.zone} (estimate) = ${rangeText(r.low, r.high, "bpm")}`;
      }
      return `Z${t.zone} HR. Set your LTHR to see bpm.`;
    }
    if (t.anchor === "lthr") {
      const main = rangeText(t.low, t.high, "% LTHR");
      if (!n.lthrBike || sport !== "bike") return main;
      return `${main} = ${rangeText(t.low !== undefined ? (t.low * n.lthrBike) / 100 : null, t.high !== undefined ? (t.high * n.lthrBike) / 100 : null, "bpm")}`;
    }
  }
  return null;
}

// ── Profile chart ────────────────────────────────────────────────────────────

/** Width of a lap or distance step in the chart, which has no time. */
const OPEN_STEP_SECONDS = 300;

export type ProfileBlock = { seconds: number; open: boolean; pctFtp: number | null; zone: number | null; type: WorkoutStep["type"] };

/** One block per step, repeats expanded: width in seconds, height in % FTP when the step has a power target. */
export function profileBlocks(w: Workout, n: EditNumbers): ProfileBlock[] {
  const one = (s: WorkoutStep): ProfileBlock => {
    const open = s.end.type !== "time";
    const seconds = s.end.type === "time" ? s.end.seconds : OPEN_STEP_SECONDS;
    let pct: number | null = null;
    const t = s.target;
    if (t?.metric === "power") {
      if (t.anchor === "absolute") pct = n.ftp ? (mid(t.low ?? null, t.high ?? null)! / n.ftp) * 100 : null;
      else {
        const b = t.zone !== undefined ? zonePercent(t, w.sport) : { low: t.low ?? null, high: t.high ?? null };
        pct = mid(b.low, b.high);
      }
    }
    return { seconds, open, pctFtp: pct, zone: pct !== null ? powerZone(pct) : null, type: s.type };
  };
  const out: ProfileBlock[] = [];
  for (const node of w.steps) {
    if (node.type === "repeat") for (let i = 0; i < node.count; i++) for (const s of node.steps) out.push(one(s));
    else out.push(one(node));
  }
  return out;
}

// ── Errors at the field ──────────────────────────────────────────────────────

/** The parseWorkout path of a node: "steps[2]" or "steps[2].steps[0]". */
export function nodePath(w: Workout, id: string): string | null {
  for (const [i, n] of w.steps.entries()) {
    if (n.id === id) return `steps[${i}]`;
    if (n.type === "repeat") for (const [j, s] of n.steps.entries()) if (s.id === id) return `steps[${i}].steps[${j}]`;
  }
  return null;
}

/** The errors of one step, with the path inside the step: "target.low". */
export function errorsOf(errors: { path: string; message: string }[], path: string | null): { field: string; message: string }[] {
  if (!path) return [];
  return errors
    .filter((e) => e.path === path || (e.path.startsWith(`${path}.`) && !e.path.startsWith(`${path}.steps[`)))
    .map((e) => ({ field: e.path.slice(path.length + 1), message: e.message }));
}

/** An empty bike workout: the editor's "New workout". */
export function emptyWorkout(sport: WorkoutSport = "bike"): Workout {
  return { v: 1, sport, name: "", steps: [{ id: "e1", type: "work", end: { type: "time", seconds: 600 } }] };
}

// ── Step sheet fields ────────────────────────────────────────────────────────

/** How a target is typed: watts, % FTP or a power zone; bpm or an HR zone. `keep` holds a form the sheet does not edit. */
export type TargetUnit = "w" | "pct" | "pzone" | "bpm" | "hzone" | "keep";

/** A target as the sheet holds it while the user types. Empty text is an open end. */
export type TargetFields = { metric: "none" | "power" | "hr"; unit: TargetUnit; low: string; high: string; zone: number; kept?: WorkoutTarget };

export const NO_TARGET: TargetFields = { metric: "none", unit: "w", low: "", high: "", zone: 2 };

const str = (n: number | undefined) => (n === undefined ? "" : String(n));

export function fieldsFromTarget(t: WorkoutTarget | undefined): TargetFields {
  if (!t) return NO_TARGET;
  const base = { low: str(t.low), high: str(t.high), zone: t.zone ?? 2 };
  if (t.metric === "power" && t.anchor === "absolute" && t.zone === undefined) return { metric: "power", unit: "w", ...base };
  if (t.metric === "power" && t.anchor === "ftp") return { metric: "power", unit: t.zone !== undefined ? "pzone" : "pct", ...base };
  if (t.metric === "hr" && t.anchor === "absolute") return { metric: "hr", unit: "bpm", ...base };
  if (t.metric === "hr" && t.anchor === "lthr" && t.zone !== undefined) return { metric: "hr", unit: "hzone", ...base };
  return { metric: t.metric === "power" ? "power" : "hr", unit: "keep", ...base, kept: t };
}

/** A number typed with a dot or a comma; empty is undefined, and text that is no number stays NaN for parseWorkout to name. */
export function typedNumber(s: string): number | undefined {
  const t = s.trim().replace(",", ".");
  return t === "" ? undefined : Number(t);
}

export function targetFromFields(f: TargetFields): WorkoutTarget | undefined {
  if (f.metric === "none") return undefined;
  if (f.unit === "keep") return f.kept;
  if (f.unit === "pzone") return { metric: "power", anchor: "ftp", zone: f.zone };
  if (f.unit === "hzone") return { metric: "hr", anchor: "lthr", zone: f.zone };
  const anchor = f.unit === "pct" ? "ftp" : "absolute";
  const t: WorkoutTarget = { metric: f.metric, anchor };
  const low = typedNumber(f.low);
  const high = typedNumber(f.high);
  if (low !== undefined) t.low = low;
  if (high !== undefined) t.high = high;
  return t;
}
