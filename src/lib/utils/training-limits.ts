/**
 * Training limits that an assistant's plan write is checked against
 * (decision D3 in docs/triathlon-coach-audit.md; docs/plans/ai-coach.md, 2.4).
 * Pure: the server code passes the plan before and after the write and the
 * athlete's history in. A limit is broken only when the write makes things
 * worse, so a plan that is already over a limit does not block an unrelated
 * edit. User edits in the app are never checked (D4).
 */

import type { StrengthGoal } from "@/db/schema/athlete-profile";
import { hoursLabel, kmLabel } from "@/lib/garmin/analytics/demands";
import { addDaysStr, dowOf, mondayOf } from "@/lib/utils/planned-sessions";
import { effectivePriorities } from "@/lib/utils/session-compliance";
import { shortDay } from "@/lib/utils/seasons";
import { STRENGTH_GOAL_LABEL, strengthDefault, type StrengthPhase } from "@/lib/utils/strength-goal";
import type { Workout } from "@/lib/utils/workout-steps";

export const LIMIT_RULES = [
  "long_run_cap",
  "hard_sessions_per_week",
  "hard_after_low_readiness",
  "heavy_legs_before_key",
  "strength_per_week",
  "weekly_load_ramp",
] as const;
export type LimitRule = (typeof LIMIT_RULES)[number];

/** Where the rules come from: the research resource the assistant can read. */
const REFERENCE = "logeverylift://docs/endurance-training-reference";

export type BrokenLimit = {
  rule: LimitRule;
  message: string;
  numbers: Record<string, unknown>;
  evidence: string;
  source: string;
};

// ── Long-run cap ────────────────────────────────────────────────────────────
//
// "Planned run longer than 1.10 x the longest run in the last 30 days: cut it
// to 1.10x or less" — Study (large cohort), Garmin-RUNSAFE (Frandsen 2025).
// docs/research/endurance-training-reference.md:195

export const LONG_RUN_CAP = 1.1;
export const LONG_RUN_WINDOW_DAYS = 30;
const LONG_RUN_EVIDENCE = "Study (large cohort)";

/** One planned run session: the sum of its run sets. 0 means the session has none of that measure. */
export type PlannedRun = { durationS: number; distanceM: number };

export type PlanSet = {
  discipline: "swim" | "bike" | "run" | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
};

/** The planned run of one program: its run sets' durations and distances, each summed. */
export function plannedRun(sets: PlanSet[]): PlannedRun {
  let durationS = 0;
  let distanceM = 0;
  for (const s of sets) {
    if (s.discipline !== "run") continue;
    durationS += s.durationSeconds ?? 0;
    distanceM += s.distanceMeters ?? 0;
  }
  return { durationS, distanceM };
}

export type PastRun = { day: string; durationS: number; distanceM: number | null; indoor: boolean };

export type RunHistory = {
  longestDuration: { s: number; day: string } | null;
  longestDistance: { m: number; day: string } | null;
};

/**
 * The longest runs in the window. Indoor runs count for time, not for distance
 * (treadmill distance is not reliable), as in garmin/analytics/demands.ts.
 */
export function longestRuns(runs: PastRun[]): RunHistory {
  let longestDuration: RunHistory["longestDuration"] = null;
  let longestDistance: RunHistory["longestDistance"] = null;
  for (const r of runs) {
    if (r.durationS > 0 && r.durationS > (longestDuration?.s ?? 0)) longestDuration = { s: r.durationS, day: r.day };
    if (!r.indoor && r.distanceM != null && r.distanceM > 0 && r.distanceM > (longestDistance?.m ?? 0)) {
      longestDistance = { m: r.distanceM, day: r.day };
    }
  }
  return { longestDuration, longestDistance };
}

export type RunChange = { label: string; before: PlannedRun; after: PlannedRun };

const ratioLabel = (r: number) => `${r.toFixed(2)}x`;

/** One measure of one session against its cap, or null when it is fine. */
function overCap(
  label: string,
  measure: "duration" | "distance",
  before: number,
  after: number,
  longest: { value: number; day: string } | null,
) {
  if (after <= 0 || after <= before) return null;
  const fmt = measure === "duration" ? hoursLabel : kmLabel;
  if (!longest) {
    const none = measure === "duration" ? "no run" : "no outdoor run with a distance";
    return {
      text: `${label} ${fmt(after)}, but there was ${none} in the last ${LONG_RUN_WINDOW_DAYS} days to compare with. Limit ${ratioLabel(LONG_RUN_CAP)} the longest run in ${LONG_RUN_WINDOW_DAYS} days.`,
      numbers: { session: label, measure, planned: after, longest: null, longestDay: null, ratio: null, limit: LONG_RUN_CAP, max: null },
    };
  }
  const max = longest.value * LONG_RUN_CAP;
  if (after <= max) return null;
  const ratio = after / longest.value;
  return {
    text: `${label} ${fmt(after)} is ${ratioLabel(ratio)} your longest run in the last ${LONG_RUN_WINDOW_DAYS} days (${fmt(longest.value)} on ${longest.day}). Limit ${ratioLabel(LONG_RUN_CAP)}, so at most ${fmt(max)}.`,
    numbers: {
      session: label,
      measure,
      planned: after,
      longest: longest.value,
      longestDay: longest.day,
      ratio: Math.round(ratio * 100) / 100,
      limit: LONG_RUN_CAP,
      max: Math.floor(max),
    },
  };
}

/** The long-run cap over every session a write touches; one result for the rule. */
export function longRunCap(changes: RunChange[], history: RunHistory): BrokenLimit | null {
  const hits = changes.flatMap((c) =>
    [
      overCap(c.label, "duration", c.before.durationS, c.after.durationS, history.longestDuration && { value: history.longestDuration.s, day: history.longestDuration.day }),
      overCap(c.label, "distance", c.before.distanceM, c.after.distanceM, history.longestDistance && { value: history.longestDistance.m, day: history.longestDistance.day }),
    ].filter((h) => h != null),
  );
  if (hits.length === 0) return null;
  return {
    rule: "long_run_cap",
    message: hits.map((h) => h.text).join(" "),
    numbers: { runs: hits.map((h) => h.numbers) },
    evidence: LONG_RUN_EVIDENCE,
    source: `${REFERENCE} (Running carries most of the injury risk, so cap single runs)`,
  };
}

// ── Hard sessions per week ──────────────────────────────────────────────────
//
// "Key sessions per week: 2-3, protected; everything else is supporting" —
// Coach convention. docs/research/endurance-training-reference.md:65
// Which planned sessions count as hard is an inference: intervals only (owner
// decision 2 in docs/plans/ai-coach.md). Strength sessions do not count; the
// research puts heavy lifting on hard days.

export const HARD_SESSIONS_LIMIT = 3;
const HARD_EVIDENCE = "Coach convention (2-3 key sessions a week); which planned sessions count as hard is Inference";

export type IntensitySet = {
  discipline: "swim" | "bike" | "run" | null;
  sessionRole: "work" | null;
  targetHeartRateZone: number | null;
};

/** A session is hard when an endurance set in it is an interval rep or targets zone 4-5. */
export function isHardSession(sets: IntensitySet[]): boolean {
  return sets.some(
    (s) => s.discipline != null && (s.sessionRole === "work" || (s.targetHeartRateZone != null && s.targetHeartRateZone >= 4)),
  );
}

/** One planned session in a weekday cycle's week; a program on two days is two sessions. */
export type WeekSession = { dayOfWeek: number; hard: boolean };

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function hardSessionsPerWeek(before: WeekSession[], after: WeekSession[]): BrokenLimit | null {
  const count = (w: WeekSession[]) => w.filter((s) => s.hard).length;
  const n = count(after);
  if (n <= HARD_SESSIONS_LIMIT || n <= count(before)) return null;
  const days = after
    .filter((s) => s.hard)
    .map((s) => s.dayOfWeek)
    .sort((a, b) => a - b);
  return {
    rule: "hard_sessions_per_week",
    message: `This week would hold ${n} hard sessions (${days.map((d) => DAY[d - 1]).join(", ")}). Limit ${HARD_SESSIONS_LIMIT}.`,
    numbers: { hardSessions: n, days, limit: HARD_SESSIONS_LIMIT },
    evidence: HARD_EVIDENCE,
    source: `${REFERENCE} (Key sessions have ceilings, not targets to beat)`,
  };
}

// ── Override ────────────────────────────────────────────────────────────────

/**
 * Split the broken limits by the assistant's override: what still blocks the
 * write, what it went past on purpose, and override names that matched no
 * broken limit (ignored, and the result says so).
 */
export function remainingAfterOverride(broken: BrokenLimit[], override: readonly LimitRule[]) {
  const asked = new Set(override);
  return {
    remaining: broken.filter((b) => !asked.has(b.rule)),
    overridden: broken.filter((b) => asked.has(b.rule)),
    unused: [...asked].filter((r) => !broken.some((b) => b.rule === r)),
  };
}

/** The line a user sees on a revision where the assistant went past a limit. */
export function overrideLine(overridden: Pick<BrokenLimit, "message">[], reason: string): string {
  return `Went past a training limit: ${overridden.map((o) => o.message).join(" ")} Assistant's reason: ${reason}`;
}

// ── What a revision stores ──────────────────────────────────────────────────

/** Why a limit did not run on a write. */
export type LimitNotChecked = { rule: LimitRule; why: string };

/** Stored on each revision of an assistant write the limits looked at (plan_revisions.limit_check). */
export type LimitCheck = {
  v: 1;
  checked: LimitRule[];
  notChecked: LimitNotChecked[];
  passed: LimitRule[];
  overridden: BrokenLimit[];
  overrideReason: string | null;
  /** Restores only: limits a restore broke, which never block it (T4). */
  warnings: BrokenLimit[];
};

/** The user-facing line for a stored limit check, or null when the assistant went past none. */
export function limitOverrideLine(stored: unknown): string | null {
  const c = stored as Partial<LimitCheck> | null;
  if (c?.warnings?.length) return `Breaks a training limit: ${c.warnings.map((w) => w.message).join(" ")}`;
  if (!c?.overridden?.length) return null;
  return overrideLine(c.overridden, c.overrideReason ?? "none given");
}

// ── Sessions placed on days (D2 part 2, D3, D4) ─────────────────────────────
//
// docs/plans/limits-strength-readiness.md. The rules below read the sessions
// of a weekday cycle by date. A cycle with no dated sessions yet is read from
// its template: one week, dated from TEMPLATE_MONDAY, that repeats (a loop).

/** A Monday the template week is dated on, so the same date code serves both. */
export const TEMPLATE_MONDAY = "2001-01-01";

/** What one planned set says, for the heavy-leg and strength tests. */
export type LegSet = {
  category: "strength" | "cardio" | "flexibility" | null;
  discipline: "swim" | "bike" | "run" | null;
  bodyArea: string | null;
  movementPattern: string | null;
  equipment: string | null;
  /** The resolved type: the program's override, else the exercise's own. */
  exerciseType: string | null;
  setType: string | null;
  targetReps: number | null;
  repRangeMax: number | null;
};

/** Heavy leg sets that make a heavy-legs session (inference, decision 13). */
export const HEAVY_LEG_SETS = 3;
/** More reps than this is light "toning" work, not the heavy stimulus (research, Study). */
export const HEAVY_MAX_REPS = 12;
/** Working strength sets that make a strength session (decision 18). */
export const STRENGTH_SETS = 3;

const isWorking = (s: Pick<LegSet, "setType">) => (s.setType ?? "working") === "working";

/**
 * A heavy leg set (decision 13): a working set on a strength exercise that is a
 * loaded squat or hinge on the lower or whole body, or a lower-body jump, at
 * 12 reps or fewer (or no reps given). Leg curls, leg extensions and calf
 * raises are not squats or hinges, so they never count.
 */
export function isHeavyLegSet(s: LegSet): boolean {
  if (!isWorking(s) || s.category !== "strength" || s.discipline != null) return false;
  const reps = s.repRangeMax ?? s.targetReps;
  if (reps != null && reps > HEAVY_MAX_REPS) return false;
  if (s.exerciseType === "plyometric" && s.bodyArea === "lower_body") return true;
  const pattern = s.movementPattern === "squat" || s.movementPattern === "hinge";
  const body = s.bodyArea === "lower_body" || s.bodyArea === "full_body";
  const loaded = s.equipment !== "bodyweight" && s.equipment !== "bands";
  return pattern && body && loaded;
}

/** A working set on a strength exercise (decision 18). */
export function isStrengthSet(s: Pick<LegSet, "category" | "discipline" | "setType">): boolean {
  return isWorking(s) && s.category === "strength" && s.discipline == null;
}

export type PlacedSession = {
  /** A stable id inside the facts: `p:<planned session id>` or `t:<slot id>`. */
  ref: string;
  label: string;
  date: string;
  position: number;
  sport: "swim" | "bike" | "run" | null;
  hard: boolean;
  plannedDurationS: number | null;
  storedPriority: "key" | "support" | "optional" | null;
  heavyLegSets: number;
  strengthSets: number;
  cycleId: number | null;
  /** Estimated planned endurance load (D1, 100 = one hour at threshold), null with no time; `loadPartial` when a step had no time or target. */
  plannedLoad?: number | null;
  loadPartial?: boolean;
  /** A logged workout is linked to it: its load is in the fitness series already. */
  done?: boolean;
};

/** `blockEnd` is the block's last day. */
export type PlacedCycle = { name: string; phaseType: string | null; blockStart: string | null; blockEnd: string | null };

/**
 * One reading of sessions by day: a dated range (`from` is the first Monday
 * checked, `to` the last day; sessions up to two days before `from` are there
 * for heavy legs) or a template week that repeats (`loop`).
 */
export type PlacedGroup = { loop: boolean; from: string; to: string; sessions: PlacedSession[]; cycles: Record<number, PlacedCycle> };

const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(g: Pick<PlacedGroup, "loop">, date: string) {
  return g.loop ? DAY_NAME[dowOf(date) - 1] : `${DAY_NAME[dowOf(date) - 1]} ${date}`;
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ── Heavy legs before a key session ─────────────────────────────────────────
//
// "Long run, long ride, brick or interval run within 48 h: no heavy
// lower-body lifting; upper-body/pull is fine" — Study (running economy down
// 24-48 h after a lower-body session) plus inference. "Key endurance session
// in the same day: lift after it" — Study. Which sessions count is inference
// (decisions 13-16). docs/research/endurance-training-reference.md,
// "Placement matters more than the program".

const HEAVY_LEGS_EVIDENCE = "Study (running economy down 24-48 h after lower-body lifting) plus Inference (which sessions count)";

export type LegConflict = { lift: PlacedSession; key: PlacedSession; days: number };

/** Heavy-legs sessions 1-2 days before a key bike or run, or earlier the same day. */
export function heavyLegConflicts(g: PlacedGroup): LegConflict[] {
  const own = g.sessions;
  const priorities = effectivePriorities(
    own.map((s, i) => ({ id: i, date: s.date, sport: s.sport, hard: s.hard, plannedDurationS: s.plannedDurationS, stored: s.storedPriority })),
  );
  const keys = own.filter((s, i) => (s.sport === "bike" || s.sport === "run") && priorities.get(i) === "key" && (g.loop || s.date >= g.from));
  // A template week repeats: last week's lifts sit before this week's keys.
  const lifts = own.filter((s) => s.heavyLegSets >= HEAVY_LEG_SETS);
  const allLifts = g.loop ? [...lifts, ...lifts.map((s) => ({ ...s, date: addDaysStr(s.date, -7) }))] : lifts;
  const out: LegConflict[] = [];
  for (const key of keys) {
    for (const lift of allLifts) {
      const days = daysApart(lift.date, key.date);
      if (days === 1 || days === 2 || (days === 0 && lift.position < key.position)) out.push({ lift, key, days });
    }
  }
  return out;
}

const conflictId = (c: LegConflict) => `${c.lift.ref}|${c.lift.date}|${c.key.ref}|${c.key.date}`;

function conflictText(g: PlacedGroup, c: LegConflict) {
  const when = c.days === 0 ? "earlier the same day as" : `${c.days} day${c.days === 1 ? "" : "s"} before`;
  return `"${c.lift.label}" on ${dayLabel(g, c.lift.date)} (${c.lift.heavyLegSets} heavy leg sets) is ${when} the key session "${c.key.label}" on ${dayLabel(g, c.key.date)}.`;
}

export function heavyLegsBeforeKey(before: ReadonlyMap<string, PlacedGroup>, after: ReadonlyMap<string, PlacedGroup>): BrokenLimit | null {
  const hits: { text: string; numbers: Record<string, unknown> }[] = [];
  for (const [k, g] of after) {
    const now = heavyLegConflicts(g);
    const was = before.get(k);
    const old = was ? heavyLegConflicts(was) : [];
    if (now.length <= old.length) continue;
    const known = new Set(old.map(conflictId));
    for (const c of now.filter((x) => !known.has(conflictId(x)))) {
      hits.push({
        text: conflictText(g, c),
        numbers: {
          lift: c.lift.label,
          liftDay: g.loop ? dowOf(c.lift.date) : c.lift.date,
          heavyLegSets: c.lift.heavyLegSets,
          key: c.key.label,
          keyDay: g.loop ? dowOf(c.key.date) : c.key.date,
          daysBefore: c.days,
        },
      });
    }
  }
  if (!hits.length) return null;
  const shown = hits.slice(0, 3).map((h) => h.text);
  if (hits.length > 3) shown.push(`And ${hits.length - 3} more.`);
  return {
    rule: "heavy_legs_before_key",
    message: `${shown.join(" ")} No heavy legs within 48 h before a key run or ride; upper body is fine.`,
    numbers: { conflicts: hits.map((h) => h.numbers), maxDaysBefore: 2 },
    evidence: HEAVY_LEGS_EVIDENCE,
    source: `${REFERENCE} (Placement matters more than the program)`,
  };
}

/** One heavy-legs conflict between two dated sessions, by id (the D3 lines in the app). */
export type HeavyLegsPair = { liftId: number; keyId: number; liftLabel: string; keyLabel: string; liftDate: string; keyDate: string; daysBefore: number };

/**
 * The line each session of a heavy-legs conflict shows in the calendar (D3),
 * by planned session id. Dates as "Tue 11 May" (shortDay), built on the server.
 */
export function heavyLegsLines(pairs: HeavyLegsPair[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const when = (days: number) => (days === 0 ? "earlier the same day as" : `${days} day${days === 1 ? "" : "s"} before`);
  for (const p of pairs) {
    (out[p.liftId] ??= []).push(`Heavy legs ${when(p.daysBefore)} key "${p.keyLabel}" (${shortDay(p.keyDate)}). Move it or make it upper body.`);
    (out[p.keyId] ??= []).push(`Heavy legs before this key session: "${p.liftLabel}" (${shortDay(p.liftDate)}).`);
  }
  return out;
}

// ── Strength sessions per week by phase (D21) ───────────────────────────────
//
// "Competition / peak: 1/wk minimum to maintain; never less than weekly" —
// Study; the rest of the strength-by-phase table is coach convention. The
// default per goal and phase is strengthDefault (src/lib/utils/strength-goal.ts).
// docs/research/endurance-training-reference.md, "Placement matters more than
// the program".

const STRENGTH_EVIDENCE = "Study for frequency (2/wk to build, 1/wk to keep); phase table Coach convention";

export type StrengthWeek = { cycleId: number; monday: string; count: number; dates: string[] };

/**
 * Strength sessions per week of each phase cycle in a group: the template
 * week, or each full calendar week inside the block from the first Monday
 * checked. A partial first or last week is not counted. Cycles with no
 * phase type are left out (decision 17).
 */
export function strengthWeeks(g: PlacedGroup): Map<string, StrengthWeek> {
  const out = new Map<string, StrengthWeek>();
  for (const [idStr, c] of Object.entries(g.cycles)) {
    const cycleId = Number(idStr);
    if (!c.phaseType) continue;
    const mine = g.sessions.filter((s) => s.cycleId === cycleId);
    const mondays: string[] = [];
    if (g.loop) mondays.push(TEMPLATE_MONDAY);
    else if (c.blockStart && c.blockEnd) {
      for (let m = mondayOf(g.from); addDaysStr(m, 6) <= g.to; m = addDaysStr(m, 7)) {
        if (m >= c.blockStart && addDaysStr(m, 6) <= c.blockEnd) mondays.push(m);
      }
    }
    for (const monday of mondays) {
      const week = mine.filter((s) => s.date >= monday && s.date <= addDaysStr(monday, 6) && s.strengthSets >= STRENGTH_SETS);
      out.set(`${cycleId}|${monday}`, { cycleId, monday, count: week.length, dates: week.map((s) => s.date).sort() });
    }
  }
  return out;
}

export function strengthPerWeek(
  before: ReadonlyMap<string, PlacedGroup>,
  after: ReadonlyMap<string, PlacedGroup>,
  goal: StrengthGoal,
): BrokenLimit | null {
  const hits: { text: string; numbers: Record<string, unknown> }[] = [];
  for (const [k, g] of after) {
    const was = before.get(k);
    const old = was ? strengthWeeks(was) : new Map<string, StrengthWeek>();
    for (const [wk, w] of strengthWeeks(g)) {
      const c = g.cycles[w.cycleId];
      const phase = c.phaseType as StrengthPhase;
      const target = strengthDefault(goal, phase).sessionsPerWeek;
      // A week that was not there before is held to the default itself.
      const prev = old.get(wk)?.count ?? target;
      if (Math.abs(w.count - target) <= Math.abs(prev - target)) continue;
      const days = w.dates.map((d) => DAY_NAME[dowOf(d) - 1]);
      const when = g.loop ? "a week" : `in the week of ${w.monday}`;
      hits.push({
        text: `${phase[0].toUpperCase()}${phase.slice(1)} phase "${c.name}" would hold ${w.count} strength session${w.count === 1 ? "" : "s"} ${when}${days.length ? ` (${days.join(", ")})` : ""}. The default for "${STRENGTH_GOAL_LABEL[goal]}" in ${phase} is ${target}.`,
        numbers: { cycleId: w.cycleId, phase, week: g.loop ? null : w.monday, sessions: w.count, before: prev, default: target, goal },
      });
    }
  }
  if (!hits.length) return null;
  const shown = hits.slice(0, 3).map((h) => h.text);
  if (hits.length > 3) shown.push(`And ${hits.length - 3} more weeks.`);
  return {
    rule: "strength_per_week",
    message: `${shown.join(" ")} Override with a reason if the athlete wants another count (for example 2 a week to keep muscle).`,
    numbers: hits.length === 1 ? hits[0].numbers : { weeks: hits.map((h) => h.numbers) },
    evidence: STRENGTH_EVIDENCE,
    source: `${REFERENCE} (Placement matters more than the program)`,
  };
}

// ── Readiness: the flag, the limit and the swap (D2, D4) ────────────────────
//
// "7-day mean below mean - 0.5 SD for 2+ days AND one other marker agrees
// (resting HR up, ...): replace the next intensity session with Z1-Z2 or
// rest" — Study for the method; thresholds are coach convention. "Never act
// on one bad day; require two agreeing signals for any downgrade" — Study
// plus inference. The resting HR threshold is Inference.
// docs/research/endurance-training-reference.md, "Readiness signals change the
// next session, not the plan". The app's HRV band is ±0.75 SD (stricter).

const READINESS_EVIDENCE = "Study (HRV-guided method); thresholds Coach convention; resting HR threshold Inference";

/** One Garmin daily row, as the readiness flag reads it. */
export type ReadinessDay = {
  date: string;
  hrvMs: number | null;
  hrvState: string | null;
  hrvMean7: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  rhrFlag: boolean;
  rhrMean7: number | null;
  rhrBaseline: number | null;
};

export type ReadinessFlag = {
  /** The low-readiness day: today or yesterday. */
  day: string;
  text: string;
  numbers: {
    hrvMean7: number | null;
    bandLow: number | null;
    bandHigh: number | null;
    rhrMean7: number | null;
    rhrBaseline: number | null;
    rhrOver: number | null;
  };
};

const LOW_HRV = new Set(["fatigued", "strained"]);
const r0 = (n: number | null) => (n == null ? null : Math.round(n));
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/**
 * The low-readiness day (decision 5): HRV below the band on the day and the
 * day before, and the resting HR flag on the day. A day decides only when the
 * watch measured HRV that night. Today's reading wins when there is one;
 * else yesterday's. Null when that day is not a low-readiness day.
 */
export function readinessFlag(days: ReadinessDay[], today: string): ReadinessFlag | null {
  const by = new Map(days.map((d) => [d.date, d]));
  const day = by.get(today)?.hrvMs != null ? today : addDaysStr(today, -1);
  const d = by.get(day);
  const prev = by.get(addDaysStr(day, -1));
  if (!d || d.hrvMs == null || !LOW_HRV.has(d.hrvState ?? "") || !prev || !LOW_HRV.has(prev.hrvState ?? "") || !d.rhrFlag) return null;
  const over = d.rhrMean7 != null && d.rhrBaseline != null ? r1(d.rhrMean7 - d.rhrBaseline) : null;
  const band = d.bandLow != null && d.bandHigh != null ? ` (${r0(d.bandLow)}-${r0(d.bandHigh)})` : "";
  const hrv = d.hrvMean7 != null ? `HRV 7-day mean ${r0(d.hrvMean7)} ms is below your band${band} for 2 days` : "HRV is below your band for 2 days";
  const rhr = over != null ? `resting HR is ${over} bpm over your normal ${r0(d.rhrBaseline)}` : "resting HR is up";
  return {
    day,
    text: `${hrv} and ${rhr}`,
    numbers: { hrvMean7: r0(d.hrvMean7), bandLow: r0(d.bandLow), bandHigh: r0(d.bandHigh), rhrMean7: r1(d.rhrMean7), rhrBaseline: r0(d.rhrBaseline), rhrOver: over },
  };
}

/** The days a low-readiness day keeps hard sessions off: that day and the next, from today on (decision 8). */
export function readinessWindow(flag: Pick<ReadinessFlag, "day">, today: string): string[] {
  return [flag.day, addDaysStr(flag.day, 1)].filter((d) => d >= today);
}

export function hardAfterLowReadiness(
  before: ReadonlyMap<string, PlacedGroup>,
  after: ReadonlyMap<string, PlacedGroup>,
  flag: ReadinessFlag,
  today: string,
): BrokenLimit | null {
  const window = new Set(readinessWindow(flag, today));
  const hardIn = (g: PlacedGroup | undefined) => (g && !g.loop ? g.sessions.filter((s) => s.hard && window.has(s.date)) : []);
  const added: PlacedSession[] = [];
  for (const [k, g] of after) {
    const now = hardIn(g);
    const was = hardIn(before.get(k));
    if (now.length <= was.length) continue;
    const known = new Set(was.map((s) => `${s.ref}|${s.date}`));
    added.push(...now.filter((s) => !known.has(`${s.ref}|${s.date}`)));
  }
  if (!added.length) return null;
  const which = flag.day === today ? `Today (${today})` : `Yesterday (${flag.day})`;
  return {
    rule: "hard_after_low_readiness",
    message: `${which} is a low-readiness day: ${flag.text}. This change puts a hard session on ${added.map((s) => `${s.date} ("${s.label}")`).join(", ")}. Make the next intensity session easy (zone 1-2) or rest.`,
    numbers: { lowReadinessDay: flag.day, ...flag.numbers, hardSessions: added.map((s) => ({ date: s.date, label: s.label })) },
    evidence: READINESS_EVIDENCE,
    source: `${REFERENCE} (Readiness signals change the next session, not the plan)`,
  };
}

/** The easy session a hard one becomes (decision 10): the planned time, at most 60 minutes. Inference. */
export const EASY_MAX_SECONDS = 60 * 60;

/**
 * An easy steady session of one sport: one step at 60-70% of max heart rate
 * (about zone 2), so it fits every sport the schema allows and never reads as
 * hard. With no planned time it is 60 minutes.
 */
export function easyWorkout(sport: "swim" | "bike" | "run", plannedSeconds: number | null): Workout {
  const planned = plannedSeconds && plannedSeconds > 0 ? plannedSeconds : EASY_MAX_SECONDS;
  const seconds = Math.round(Math.max(5 * 60, Math.min(planned, EASY_MAX_SECONDS)));
  return {
    v: 1,
    sport,
    name: `Easy ${sport} (readiness)`,
    steps: [{ type: "work", end: { type: "time", seconds }, target: { metric: "hr", anchor: "max_hr", low: 60, high: 70 } }],
  };
}

export type SwapCandidate = { id: number; label: string; sport: "swim" | "bike" | "run" | null; hard: boolean; plannedDurationS: number | null; done: boolean };

export type ReadinessSwap = { sessionId: number; label: string; workout: Workout; minutes: number; text: string; flag: ReadinessFlag };

export const TAPER_NOTE = "In a taper HRV often drops. If you feel well, keep the plan.";

/**
 * D4: on a low-readiness morning, make today's first hard session (in day
 * order) easy. Only this morning's reading counts. Null when there is nothing
 * to suggest. One answer for the app and the assistant.
 */
export function readinessSwap(input: { flag: ReadinessFlag | null; today: string; sessions: SwapCandidate[]; taper: boolean }): ReadinessSwap | null {
  const { flag, today, sessions, taper } = input;
  if (!flag || flag.day !== today) return null;
  const s = sessions.find((x) => x.hard && !x.done && x.sport != null);
  if (!s || !s.sport) return null;
  const planned = s.plannedDurationS && s.plannedDurationS > 0 ? s.plannedDurationS : EASY_MAX_SECONDS;
  const minutes = Math.round(Math.max(5 * 60, Math.min(planned, EASY_MAX_SECONDS)) / 60);
  return {
    sessionId: s.id,
    label: s.label,
    workout: easyWorkout(s.sport, s.plannedDurationS),
    minutes,
    flag,
    text: `Low readiness today: ${flag.text}. Make "${s.label}" an easy ${minutes} min zone 2 session?${taper ? ` ${TAPER_NOTE}` : ""}`,
  };
}

// ── Weekly load ramp (D2) ───────────────────────────────────────────────────
//
// "Planned 7-day CTL ramp over 8: Reject or cut the week" — Coach convention.
// "CTL 45 or below and ramp over 6: Cut to 3-5/week" — Vendor/coach
// convention. The acute:chronic ratio does not predict injury (Study,
// Impellizzeri), so the rule uses the CTL ramp. docs/research/
// endurance-training-reference.md, "CTL ramp limits are conventions, and the
// ACWR is not an injury predictor". Endurance CTL only (swim + bike + run;
// hub decision 1); the planned load is D1's estimate (Inference).

export const RAMP_LIMIT = 8;
export const RAMP_LIMIT_LOW = 6;
/** At or below this CTL the lower limit applies. */
export const RAMP_LOW_CTL = 45;
const RAMP_EVIDENCE = "Coach convention (Friel, TrainingPeaks); the planned load is an estimate (Inference)";
const CTL_DAYS = 42;

/** What the projection starts from: endurance CTL at the end of yesterday, CTL of past days, and load already done today. */
export type RampStart = { today: string; ctlYesterday: number; pastCtl: ReadonlyMap<string, number>; doneToday: number };

export type RampWeek = { monday: string; ctlStart: number; ctlEnd: number; ramp: number; limit: number; plannedLoad: number; partialSessions: number };

/**
 * The planned endurance load by day from today on: planned sessions not yet
 * done, plus what was done today. Past days are in the fitness series.
 */
export function plannedDayLoads(start: RampStart, sessions: PlacedSession[]): { loads: Map<string, number>; partial: Map<string, number> } {
  const loads = new Map<string, number>([[start.today, start.doneToday]]);
  const partial = new Map<string, number>();
  for (const s of sessions) {
    if (s.date < start.today || s.done || s.sport == null) continue;
    loads.set(s.date, (loads.get(s.date) ?? 0) + (s.plannedLoad ?? 0));
    if (s.plannedLoad == null || s.loadPartial) partial.set(s.date, (partial.get(s.date) ?? 0) + 1);
  }
  return { loads, partial };
}

/**
 * Each calendar week's endurance CTL ramp, projected day by day with the
 * PMC model (CTL(d) = CTL(d-1) + (load(d) - CTL(d-1)) / 42) from yesterday's
 * CTL. A week's start is the CTL at the end of the Sunday before.
 */
export function weeklyRamps(start: RampStart, sessions: PlacedSession[], mondays: string[]): Map<string, RampWeek> {
  const { loads, partial } = plannedDayLoads(start, sessions);
  const out = new Map<string, RampWeek>();
  if (!mondays.length) return out;
  const last = addDaysStr([...mondays].sort().at(-1)!, 6);
  const ctl = new Map<string, number>(start.pastCtl);
  let prev = start.ctlYesterday;
  ctl.set(addDaysStr(start.today, -1), prev);
  for (let d = start.today; d <= last; d = addDaysStr(d, 1)) {
    prev = prev + ((loads.get(d) ?? 0) - prev) / CTL_DAYS;
    ctl.set(d, prev);
  }
  for (const monday of mondays) {
    const ctlStart = ctl.get(addDaysStr(monday, -1));
    const ctlEnd = ctl.get(addDaysStr(monday, 6));
    if (ctlStart == null || ctlEnd == null) continue;
    let plannedLoad = 0;
    let partialSessions = 0;
    for (let d = monday; d <= addDaysStr(monday, 6); d = addDaysStr(d, 1)) {
      if (d >= start.today) plannedLoad += loads.get(d) ?? 0;
      partialSessions += partial.get(d) ?? 0;
    }
    out.set(monday, {
      monday,
      ctlStart,
      ctlEnd,
      ramp: ctlEnd - ctlStart,
      limit: ctlStart <= RAMP_LOW_CTL ? RAMP_LIMIT_LOW : RAMP_LIMIT,
      plannedLoad,
      partialSessions,
    });
  }
  return out;
}

const r1n = (n: number) => Math.round(n * 10) / 10;

/** Broken when a week's ramp after the write is over its limit and above the ramp before (a new week counts as no ramp before). */
export function weeklyLoadRamp(before: ReadonlyMap<string, RampWeek>, after: ReadonlyMap<string, RampWeek>, thisMonday: string): BrokenLimit | null {
  const hits = [...after.values()]
    .filter((w) => w.ramp > w.limit && w.ramp > (before.get(w.monday)?.ramp ?? -Infinity) + 1e-9)
    .sort((a, b) => a.monday.localeCompare(b.monday));
  if (!hits.length) return null;
  const text = (w: RampWeek) => {
    const which = w.monday === thisMonday ? "This week" : `The week of ${w.monday}`;
    const partial = w.partialSessions ? ` ${w.partialSessions} session${w.partialSessions === 1 ? " has" : "s have"} no time or no power or pace target, so the estimate is rough.` : "";
    return `${which} would raise fitness (endurance CTL) by ${r1n(w.ramp)} in 7 days, from ${Math.round(w.ctlStart)} to ${Math.round(w.ctlEnd)}. Limit ${w.limit} a week (${RAMP_LIMIT_LOW} while fitness is ${RAMP_LOW_CTL} or less). The planned load is an estimate.${partial}`;
  };
  const shown = hits.slice(0, 3).map(text);
  if (hits.length > 3) shown.push(`And ${hits.length - 3} more weeks.`);
  const numbers = (w: RampWeek) => ({
    week: w.monday,
    ctlStart: r1n(w.ctlStart),
    ctlEnd: r1n(w.ctlEnd),
    ramp: r1n(w.ramp),
    limit: w.limit,
    plannedLoad: Math.round(w.plannedLoad),
    partialSessions: w.partialSessions,
  });
  return {
    rule: "weekly_load_ramp",
    message: shown.join(" "),
    numbers: hits.length === 1 ? numbers(hits[0]) : { weeks: hits.map(numbers) },
    evidence: RAMP_EVIDENCE,
    source: `${REFERENCE} (CTL ramp limits are conventions, and the ACWR is not an injury predictor)`,
  };
}

/** The share of peak a set with a peak anchor runs at in one week, or null to use its stored values. */
export type WeekShare = (cycleId: number | null, date: string) => number | null;

/**
 * Planned steps of a program's endurance sets for D1's estimate (brief
 * 3.1.1, Inference): a `work` role or zone 4-5 is a work step, zone 1 a
 * recovery step, the rest steady (warm-up IF). Time is the set's duration,
 * or with only a distance, the distance at that IF of the threshold speed
 * (run) or CSS (swim).
 */
export type LoadSet = {
  discipline: "swim" | "bike" | "run" | null;
  sessionRole: string | null;
  targetHeartRateZone: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
};

export function programSteps(
  sets: LoadSet[],
  anchors: { runThresholdSpeed?: number | null; swimCss?: number | null },
  defaultIf: Record<"warmup" | "work" | "recovery", number>,
): { type: "warmup" | "work" | "recovery"; seconds: number | null }[] {
  return sets
    .filter((s) => s.discipline != null)
    .map((s) => {
      const type = s.sessionRole === "work" || (s.targetHeartRateZone ?? 0) >= 4 ? "work" : s.targetHeartRateZone === 1 ? "recovery" : "warmup";
      let seconds = s.durationSeconds && s.durationSeconds > 0 ? s.durationSeconds : null;
      if (seconds == null && s.distanceMeters && s.distanceMeters > 0) {
        const speed = s.discipline === "run" ? anchors.runThresholdSpeed : s.discipline === "swim" ? anchors.swimCss : null;
        if (speed && speed > 0) seconds = s.distanceMeters / (defaultIf[type] * speed);
      }
      return { type, seconds };
    });
}

