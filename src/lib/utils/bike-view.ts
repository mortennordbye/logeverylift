/**
 * Text for a bike session before the ride (docs/plans/bike-sessions.md, 5.1,
 * 5.2, 5.4 and 5.6): the Today card lines, the step card parts, the "Record on
 * Garmin" box, the week row and the numbers table. Pure: the server resolves
 * the workout and passes the result; no screen does arithmetic.
 */

import type { BikeNumbers } from "@/lib/bike-numbers";
import { groupWorkout, type WorkoutGroup } from "@/lib/utils/workout-group";
import { profileBlocks, type ProfileBlock } from "@/lib/utils/workout-profile";
import {
  estimateWorkout,
  resolveTarget,
  resolveWorkout,
  type ResolvedForms,
  type ResolvedNode,
  type ResolvedStep,
  type ResolvedTarget,
  type ThresholdValues,
  type Workout,
  type WorkoutStep,
  type ZoneSet,
} from "@/lib/utils/workout-steps";
import type { Units } from "@/lib/utils/units";

type Range = { low: number | null; high: number | null };

/** "135-144", "under 140", "over 200"; null with no bound. */
export function rangeText(r: Range | null): string | null {
  if (!r) return null;
  const lo = r.low === null ? null : Math.round(r.low);
  const hi = r.high === null ? null : Math.round(r.high);
  if (lo !== null && hi !== null) return lo === hi ? `${lo}` : `${lo}-${hi}`;
  if (hi !== null) return `under ${hi}`;
  if (lo !== null) return `over ${lo}`;
  return null;
}

/** "Garmin Z3", "Your Z3", "Z3 (estimate)"; null when the resolver gives no zone. */
export function hrZoneLabel(forms: ResolvedForms | null): string | null {
  if (!forms?.hrZone) return null;
  if (forms.hrZoneSource === "garmin") return `Garmin Z${forms.hrZone}`;
  if (forms.hrZoneSource === "custom") return `Your Z${forms.hrZone}`;
  return `Z${forms.hrZone} (estimate)`;
}

/** The bpm range of an HR target: "141-160", "under 140". */
function bpmText(r: ResolvedTarget | null): string | null {
  if (!r || r.unit !== "bpm" || r.missing) return null;
  return rangeText(r.forms?.bpm ?? r);
}

/** The HR target of a step, main or second. */
function hrOf(s: ResolvedStep): ResolvedTarget | null {
  if (s.resolved?.unit === "bpm") return s.resolved;
  if (s.resolvedSecondary?.unit === "bpm") return s.resolvedSecondary;
  return null;
}

/** The HR chip of a step card: "141-160 bpm · Garmin Z3". */
export function hrChip(s: ResolvedStep): string | null {
  const r = hrOf(s);
  const bpm = bpmText(r);
  if (!bpm) return null;
  const zone = hrZoneLabel(r!.forms);
  return zone ? `${bpm} bpm · ${zone}` : `${bpm} bpm`;
}

/** The big target of a step card: number and unit apart, so the unit can be small. */
export function bigTarget(r: ResolvedTarget | null): { value: string; unit: string } | null {
  if (!r) return null;
  if (r.missing || (r.unit !== "W" && r.unit !== "bpm")) return { value: r.text, unit: "" };
  const v = rangeText(r.unit === "W" ? (r.forms?.watts ?? r) : (r.forms?.bpm ?? r));
  return v ? { value: v, unit: r.unit } : null;
}

/** "75-80 % FTP · power Z3" under the watts; null until the resolver gives the forms. */
export function powerSub(r: ResolvedTarget | null): string | null {
  if (!r || r.unit !== "W" || !r.forms) return null;
  const pct = rangeText(r.forms.pctFtp);
  return [pct ? `${pct} % FTP` : null, r.forms.powerZone ? `power Z${r.forms.powerZone}` : null].filter(Boolean).join(" · ") || null;
}

export const cadenceText = (s: WorkoutStep): string | null => (s.cadence ? `${s.cadence.low}-${s.cadence.high} rpm` : null);
export const gradeText = (s: WorkoutStep): string | null => (s.gradePercent === undefined ? null : `${s.gradePercent > 0 ? "+" : ""}${s.gradePercent} % grade`);

/** "65 min", or "2:15" from 100 min. */
export function minutesText(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 100 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** The step's length: "15 min", "90 s", "5 km", "to Lap". */
export function stepLength(s: WorkoutStep): string {
  if (s.end.type === "lap") return "to Lap";
  if (s.end.type === "distance") return `${+(s.end.meters / 1000).toFixed(2)} km`;
  const sec = s.end.seconds;
  return sec % 60 === 0 ? `${sec / 60} min` : sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} min`;
}

const GROUP_LABEL: Record<WorkoutGroup["kind"], string> = { warmup: "Warm-up", main: "Main set", cooldown: "Cool-down" };

export type ResolvedGroup = { kind: WorkoutGroup["kind"]; label: string; seconds: number; nodes: ResolvedNode[] };

/** The groups of `groupWorkout`, each resolved, with its planned time. */
export function resolvedGroups(w: Workout, anchors: ThresholdValues, units: Units | undefined, zones: ZoneSet | null): ResolvedGroup[] {
  return groupWorkout(w).map((g) => {
    const part: Workout = { ...w, steps: g.nodes };
    return { kind: g.kind, label: GROUP_LABEL[g.kind], seconds: estimateWorkout(part, anchors).durationSeconds, nodes: resolveWorkout(part, anchors, units, zones).steps };
  });
}

const flat = (nodes: ResolvedNode[]): ResolvedStep[] => nodes.flatMap((n) => ("count" in n ? Array.from({ length: n.count }, () => n.steps).flat() : [n as ResolvedStep]));

/** One line of the Today card: "2 x 15 min · 135-144 W", under it "5 min easy between · HR 141-160 · 85-95 rpm". */
export function groupLine(g: ResolvedGroup): { label: string; value: string; sub: string | null } {
  const steps = flat(g.nodes);
  const work = steps.filter((s) => s.type === "work" || s.type === "steady");
  const main = work[0] ?? steps[0];
  const target = main?.resolved?.text ?? null;
  const same = work.length > 1 && work.every((s) => stepLength(s) === stepLength(work[0]) && s.resolved?.text === target);
  const value = same ? `${work.length} x ${stepLength(work[0])}` : minutesText(g.seconds);
  const easy = same ? steps.find((s) => s.type === "recovery" || s.type === "rest") : undefined;
  const hr = main ? bpmText(hrOf(main)) : null;
  const sub = [easy ? `${stepLength(easy)} easy between` : null, hr ? `HR ${hr}` : null, main ? cadenceText(main) : null].filter(Boolean).join(" · ");
  return { label: g.label, value: target ? `${value} · ${target}` : value, sub: sub || null };
}

export type BikeCardView = {
  /** "65 min · 30 min at 135-144 W". */
  totals: string;
  blocks: ProfileBlock[];
  lines: { label: string; value: string; sub: string | null }[];
  chips: { text: string; warn: boolean }[];
};

/** The thresholds with the FTP the bike numbers name, so the watts and the FTP line agree. */
export const bikeAnchors = (t: ThresholdValues, n: BikeNumbers): ThresholdValues => (n.ftp ? { ...t, ftp: n.ftp.value } : t);

/** The watch FTP differs from the app FTP by more than 5 % (section 3, rule 4). */
export function watchDiffers(n: Pick<BikeNumbers, "ftp" | "watchFtp">): boolean {
  return n.ftp !== null && n.watchFtp !== null && Math.abs(n.watchFtp - n.ftp.value) / n.ftp.value > 0.05;
}

/** "FTP 186 W · from your rides", and "Watch FTP differs: 266 W" when it does. */
export function ftpChips(n: BikeNumbers): BikeCardView["chips"] {
  if (!n.ftp) return [];
  const chips = [{ text: `FTP ${n.ftp.value} W${n.ftp.source === "garmin" ? " · from your rides" : ""}`, warn: false }];
  if (watchDiffers(n)) chips.push({ text: `Watch FTP differs: ${n.watchFtp} W`, warn: true });
  return chips;
}

/** The first work step's target, for "30 min at 135-144 W". */
function workTarget(w: Workout, anchors: ThresholdValues, zones: ZoneSet | null): string | null {
  const steps = w.steps.flatMap((n) => (n.type === "repeat" ? n.steps : [n]));
  const work = steps.find((s) => s.type === "work" && s.target);
  return work?.target ? resolveTarget(work.target, w.sport, anchors, undefined, zones).text : null;
}

/** "65 min" and, with hard time, "30 min at 135-144 W". */
export function totalsText(w: Workout, anchors: ThresholdValues, zones: ZoneSet | null): string {
  const est = estimateWorkout(w, anchors);
  const total = est.durationSeconds > 0 ? `${est.durationComplete ? "" : "at least "}${minutesText(est.durationSeconds)}` : "time open";
  if (est.hardSeconds <= 0) return total;
  const at = workTarget(w, anchors, zones);
  return `${total} · ${minutesText(est.hardSeconds)}${at ? ` at ${at}` : " hard"}`;
}

/** Everything the Today card shows of a bike workout. */
export function bikeCardView(w: Workout, anchors: ThresholdValues, units: Units | undefined, numbers: BikeNumbers): BikeCardView {
  return {
    totals: totalsText(w, anchors, numbers.zones),
    blocks: profileBlocks(w, anchors, numbers.zones),
    lines: resolvedGroups(w, anchors, units, numbers.zones).map(groupLine),
    chips: ftpChips(numbers),
  };
}

/** The week row: "65 min · 135-144 W · HR 141-160". */
export function bikeRowSummary(w: Workout, anchors: ThresholdValues, zones: ZoneSet | null): string {
  const est = estimateWorkout(w, anchors);
  const steps = flat(resolveWorkout(w, anchors, undefined, zones).steps);
  const main = steps.find((s) => s.type === "work") ?? steps.find((s) => s.type === "steady") ?? null;
  const hr = main ? bpmText(hrOf(main)) : null;
  return [est.durationSeconds > 0 ? minutesText(est.durationSeconds) : null, main?.resolved?.text ?? null, hr ? `HR ${hr}` : null].filter(Boolean).join(" · ");
}

// ── Record on Garmin ─────────────────────────────────────────────────────────

/** Steps with repeats expanded: the number of laps the watch must get. */
export function stepCount(w: Workout): number {
  return w.steps.reduce((a, n) => a + (n.type === "repeat" ? n.count * n.steps.length : 1), 0);
}

const presses = (n: number) => (n === 1 ? "1 time" : `${n} times`);

/**
 * The "Record on Garmin" lines (5.2). `autoLapKm`: the lap distance when the
 * last ride had Auto Lap on, else null.
 */
export function recordLines(w: Workout, autoLapKm: number | null): string[] {
  const steps = w.steps.flatMap((n) => (n.type === "repeat" ? n.steps : [n]));
  const n = stepCount(w);
  const first = w.steps[0].type === "warmup" ? "Start at the warm-up." : "Start at the first step.";
  const last = steps.at(-1)?.type === "cooldown" ? "Stop after the cool-down." : "Stop after the last step.";
  const easy = steps.some((s) => s.type === "recovery" || s.type === "rest");
  return [
    "Activity: Indoor Bike. Pair the trainer for watts.",
    autoLapKm ? `Auto Lap off. It is on now: your last ride has a lap every ${autoLapKm} km.` : "Auto Lap off.",
    "Auto Pause off.",
    n > 1 ? `${first} Press Lap at each step change: ${presses(n - 1)}.` : `${first} Do not press Lap.`,
    easy ? `Keep recording in the easy step. ${last}` : last,
  ];
}

/** The short form for the player's ready screen. */
export function recordShort(w: Workout, autoLapKm: number | null): string {
  const n = stepCount(w);
  return ["Indoor Bike", autoLapKm ? `Auto Lap off (it is on now)` : "Auto Lap off", "Auto Pause off", n > 1 ? `press Lap ${presses(n - 1)}` : "no Lap presses"].join(" · ");
}

/** The Auto Lap distance in km from a ride's FIT laps: the first lap Garmin closed by distance. */
export function autoLapKm(laps: unknown): number | null {
  if (!Array.isArray(laps)) return null;
  const lap = laps.find((l): l is { lapTrigger: string; totalDistance: number } => l?.lapTrigger === "distance" && typeof l.totalDistance === "number" && l.totalDistance > 0);
  return lap ? Math.round(lap.totalDistance / 100) / 10 : null;
}

// ── Your numbers ─────────────────────────────────────────────────────────────

export type NumbersTable = {
  hrTitle: string;
  hr: { zone: number; text: string }[];
  powerTitle: string | null;
  power: { zone: number; text: string }[];
};

/** Five HR zones in bpm and five power zones in W, from the same resolver the steps use. */
export function numbersTable(anchors: ThresholdValues, numbers: BikeNumbers): NumbersTable {
  const zone = (metric: "hr" | "power", z: number) =>
    resolveTarget({ metric, anchor: metric === "hr" ? "lthr" : "ftp", zone: z }, "bike", anchors, undefined, numbers.zones);
  const rows = (metric: "hr" | "power", unit: string) =>
    [1, 2, 3, 4, 5].flatMap((z) => {
      const r = zone(metric, z);
      const t = r.missing ? null : rangeText(r);
      return t ? [{ zone: z, text: `${t} ${unit}` }] : [];
    });
  const source = numbers.zones?.source === "garmin" ? "Garmin cycling zones" : numbers.zones?.source === "custom" ? "Your zones" : "Estimate from your bike LTHR";
  const ftp = numbers.ftp?.value ?? anchors.ftp;
  return { hrTitle: `Heart rate · ${source}`, hr: rows("hr", "bpm"), powerTitle: ftp ? `Power · FTP ${ftp} W` : null, power: rows("power", "W") };
}
