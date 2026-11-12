/**
 * Training limits that an assistant's plan write is checked against
 * (decision D3 in docs/triathlon-coach-audit.md; docs/plans/ai-coach.md, 2.4).
 * Pure: the server code passes the plan before and after the write and the
 * athlete's history in. A limit is broken only when the write makes things
 * worse, so a plan that is already over a limit does not block an unrelated
 * edit. User edits in the app are never checked (D4).
 */

import { hoursLabel, kmLabel } from "@/lib/garmin/analytics/demands";

export const LIMIT_RULES = ["long_run_cap", "hard_sessions_per_week"] as const;
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
  if (!c?.overridden?.length) return null;
  return overrideLine(c.overridden, c.overrideReason ?? "none given");
}

