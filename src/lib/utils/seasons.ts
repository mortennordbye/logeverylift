/**
 * Pure rules for seasons, races and phases (docs/plans/seasons.md, 2.4-2.6).
 * No database access: the timeline of a season's phases, where the taper must
 * sit for the A race, whether a race change needs a re-plan (D17), and which
 * phase comes next. The database side is src/lib/seasons.ts.
 */

import type { PhaseType } from "@/lib/utils/periodization";
import { dateLabel } from "@/lib/utils/date-label";

export type RaceDiscipline = "triathlon" | "run" | "ride" | "swim" | "other";
export type TriDistance = "full" | "half" | "olympic" | "sprint";
export type RacePriority = "A" | "B" | "C";

export type RaceLike = {
  id: number;
  name: string;
  raceDate: string;
  discipline: RaceDiscipline;
  distance: TriDistance | null;
  distanceMeters: number | null;
  priority: RacePriority;
};

export type PhaseLike = {
  id: number;
  name: string;
  phaseOrder: number | null;
  phaseType: PhaseType | null;
  durationWeeks: number;
  durationDays: number | null;
  status: "draft" | "active" | "completed";
  startDate: string | null;
  scheduledStartDate: string | null;
};

export type TimelinePhase = PhaseLike & {
  /** First day. */
  start: string;
  /** Last day (inclusive). */
  end: string;
  lengthDays: number;
  state: "done" | "active" | "planned";
};

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` plus whole days, by the calendar (no time zone involved). */
export function addDaysStr(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export function daysBetweenStr(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

const lengthOf = (p: { durationWeeks: number; durationDays: number | null }) => p.durationDays ?? p.durationWeeks * 7;

// ── Taper (2.5) ──────────────────────────────────────────────────────────────

/** Default taper days for a full, half, olympic or sprint triathlon. */
export const TAPER_DAYS_TRI: Record<TriDistance, number> = {
  // Research: 14-21 days for a full (Study, mixed endurance sports).
  full: 14,
  // Research appendix: 7-14 days for a half, 10 common (Coach convention).
  half: 10,
  // Short races: Inference.
  olympic: 7,
  sprint: 7,
};
/** A run of this length or more tapers like a full (Inference). */
export const LONG_RUN_RACE_METERS = 30_000;
export const TAPER_DAYS_LONG_RUN = 14;
/** Every other race (Inference). */
export const TAPER_DAYS_DEFAULT = 7;

/** The default taper length in days for a race. */
export function taperDaysFor(race: Pick<RaceLike, "discipline" | "distance" | "distanceMeters">): number {
  if (race.discipline === "triathlon" && race.distance) return TAPER_DAYS_TRI[race.distance];
  if (race.discipline === "run" && (race.distanceMeters ?? 0) >= LONG_RUN_RACE_METERS) return TAPER_DAYS_LONG_RUN;
  return TAPER_DAYS_DEFAULT;
}

/** The A race a season plans for: the next one on or after today, else the last one. */
export function seasonARace<R extends Pick<RaceLike, "raceDate" | "priority">>(races: R[], today: string): R | null {
  const a = races.filter((r) => r.priority === "A").sort((x, y) => x.raceDate.localeCompare(y.raceDate));
  return a.find((r) => r.raceDate >= today) ?? a.at(-1) ?? null;
}

// ── Timeline (2.4) ───────────────────────────────────────────────────────────

/**
 * The last day of a running block that starts on `start` and is planned to
 * end on `end`: the day before `otherStart` when another block is scheduled
 * to start inside it, since that start completes this one.
 */
export function cutByStart(start: string, end: string, otherStart: string | null): string {
  return otherStart && otherStart > start && otherStart <= end ? addDaysStr(otherStart, -1) : end;
}

/** How many days a running block of `lengthDays` from `start` runs, cut as cutByStart cuts it. */
export function runLengthDays(start: string, lengthDays: number, otherStart: string | null): number {
  return daysBetweenStr(start, cutByStart(start, addDaysStr(start, lengthDays - 1), otherStart)) + 1;
}

/**
 * Each phase's dates, forward from the season start: a started phase keeps
 * its real start, a scheduled one its scheduled day, and any other phase
 * starts the day after the one before it ends. Nothing stores these dates.
 *
 * `otherStart` is the day the user's scheduled draft starts, if one is: that
 * start completes the running cycle (startDueScheduledCycle), so a running
 * phase ends the day before it.
 */
export function seasonTimeline(seasonStart: string, phases: PhaseLike[], otherStart: string | null = null): TimelinePhase[] {
  const ordered = [...phases].sort((a, b) => (a.phaseOrder ?? 0) - (b.phaseOrder ?? 0) || a.id - b.id);
  let cursor = seasonStart;
  return ordered.map((p) => {
    const started = p.status !== "draft" && p.startDate;
    const start = started ? p.startDate! : (p.scheduledStartDate ?? cursor);
    const planned = addDaysStr(start, lengthOf(p) - 1);
    const end = p.status === "active" ? cutByStart(start, planned, otherStart) : planned;
    const lengthDays = daysBetweenStr(start, end) + 1;
    cursor = addDaysStr(end, 1);
    return { ...p, start, end, lengthDays, state: p.status === "completed" ? "done" : p.status === "active" ? "active" : "planned" };
  });
}

export type TaperFit =
  | { status: "no_race" }
  | { status: "no_taper" }
  | { status: "fits"; taperId: number }
  /** `days`: how many days before (early) or after (late) the race the taper ends. */
  | { status: "early" | "late"; taperId: number; days: number };

/** Whether the taper ends on the A race day. The taper used is the last one that starts on or before the race. */
export function taperFit(timeline: TimelinePhase[], aRace: Pick<RaceLike, "raceDate"> | null): TaperFit {
  if (!aRace) return { status: "no_race" };
  const tapers = timeline.filter((p) => p.phaseType === "taper");
  if (tapers.length === 0) return { status: "no_taper" };
  const taper = tapers.filter((p) => p.start <= aRace.raceDate).at(-1) ?? tapers[0];
  const diff = daysBetweenStr(taper.end, aRace.raceDate);
  if (diff === 0) return { status: "fits", taperId: taper.id };
  return diff > 0 ? { status: "early", taperId: taper.id, days: diff } : { status: "late", taperId: taper.id, days: -diff };
}

/**
 * "Fit taper": the new length in days of the phase before the taper, so the
 * taper ends on the race day. A string says why it cannot be done.
 */
export function fitTaperChange(
  timeline: TimelinePhase[],
  aRace: Pick<RaceLike, "raceDate"> | null,
  today: string,
): { cycleId: number; durationDays: number } | string {
  const fit = taperFit(timeline, aRace);
  if (fit.status === "no_race") return "The season has no A race.";
  if (fit.status === "no_taper") return "The season has no taper phase.";
  if (fit.status !== "early" && fit.status !== "late") return "The taper already ends on the race day.";
  const i = timeline.findIndex((p) => p.id === fit.taperId);
  const before = timeline[i - 1];
  if (!before) return "The taper is the first phase, so there is no phase before it to lengthen or shorten.";
  if (before.state === "done") return `"${before.name}" has ended, so its length cannot change.`;
  const shift = fit.status === "early" ? fit.days : -fit.days;
  const durationDays = before.lengthDays + shift;
  if (durationDays < 1) return `"${before.name}" would have no days left.`;
  if (before.state === "active" && addDaysStr(before.start, durationDays - 1) < today) {
    return `"${before.name}" would end before today.`;
  }
  return { cycleId: before.id, durationDays };
}

/** The draft phase that comes next: the first after the last started one, or the first. */
export function nextPhase(timeline: TimelinePhase[]): TimelinePhase | null {
  const lastStarted = timeline.findLastIndex((p) => p.state !== "planned");
  return timeline.slice(lastStarted + 1).find((p) => p.state === "planned") ?? null;
}

/**
 * The season's chain is paused: its next phase is not scheduled although the
 * season is under way, or that phase was due to start on a later day. Another
 * block took the one scheduled start (scheduleCycle), and Resume picks the
 * chain up again. False when nothing has started and the next phase is due
 * today or earlier: that season is not started yet.
 */
export function seasonPaused(
  next: { scheduled: boolean; plannedStart: string } | null,
  phases: { state: TimelinePhase["state"] }[],
  today: string,
): boolean {
  if (!next || next.scheduled) return false;
  return phases.some((p) => p.state !== "planned") || next.plannedStart > today;
}

/**
 * The timeline the screens show (J4-18). While the chain is paused, the other
 * block's start does not date the season's next phase: that phase starts on
 * the day Resume gives it (resumeSeason), today when its planned day on the
 * chain without the other start has come, else that day. Later phases follow
 * it, so the taper fit is never read from the other block's start.
 */
export function shownTimeline(seasonStart: string, phases: PhaseLike[], otherStart: string | null, today: string): TimelinePhase[] {
  const timeline = seasonTimeline(seasonStart, phases, otherStart);
  const next = nextPhase(timeline);
  if (!next || !seasonPaused({ scheduled: next.scheduledStartDate != null, plannedStart: next.start }, timeline, today)) return timeline;
  const planned = nextPhase(seasonTimeline(seasonStart, phases))!.start;
  const resumeDay = planned <= today ? today : planned;
  return seasonTimeline(
    seasonStart,
    phases.map((p) => (p.id === next.id ? { ...p, scheduledStartDate: resumeDay } : p)),
    otherStart,
  ).map((p) => (p.id === next.id ? { ...p, scheduledStartDate: null } : p));
}

/** How many planned phases before this one a start today skips: 0 for the next phase, or a phase that is not planned. */
export function phasesSkippedBy(timeline: TimelinePhase[], cycleId: number): number {
  const next = nextPhase(timeline);
  if (!next) return 0;
  return Math.max(0, timeline.findIndex((p) => p.id === cycleId) - timeline.indexOf(next));
}

// ── The re-plan flag (2.6, D17) ──────────────────────────────────────────────

// "the A race", so the priority does not read as the article "a" (J4-11).
const raceLabel = (r: Pick<RaceLike, "name" | "priority">) => `the ${r.priority} race "${r.name}"`;

/**
 * Why a change to a season's races needs a re-plan, or null. Flags a date
 * change of any race, an A race added or removed, and a priority change to or
 * from A. A name or distance change does not flag.
 */
export function replanReason(before: RaceLike[], after: RaceLike[]): string | null {
  const out: string[] = [];
  const prev = new Map(before.map((r) => [r.id, r]));
  const next = new Map(after.map((r) => [r.id, r]));
  for (const r of after) {
    const was = prev.get(r.id);
    if (!was) {
      if (r.priority === "A") out.push(`${raceLabel(r)} added on ${dayLabel(r.raceDate)}`);
      continue;
    }
    if (was.raceDate !== r.raceDate) out.push(`${raceLabel(r)} moved from ${dayLabel(was.raceDate)} to ${dayLabel(r.raceDate)}`);
    if (was.priority !== r.priority && (was.priority === "A" || r.priority === "A")) {
      out.push(`"${r.name}" changed from ${was.priority} priority to ${r.priority} priority`);
    }
  }
  for (const r of before) if (!next.has(r.id) && r.priority === "A") out.push(`${raceLabel(r)} on ${dayLabel(r.raceDate)} removed`);
  if (!out.length) return null;
  const text = out.join("; ");
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * A line for Add a phase when the new phase falls outside the plan: it starts
 * after the A race, or it runs past the season end. Null when it fits.
 * `lengthDays` is null for a cycle that keeps its own length.
 */
export function addPhaseWarning(p: { startsOn: string; lengthDays: number | null; raceDate: string | null; seasonEnd: string }): string | null {
  if (p.raceDate && p.startsOn > p.raceDate) return `This phase starts after race day on ${dayLabel(p.raceDate)}.`;
  if (p.startsOn > p.seasonEnd) return `This phase starts after the season ends on ${dayLabel(p.seasonEnd)}.`;
  if (p.lengthDays == null) return null;
  const over = daysBetweenStr(p.seasonEnd, addDaysStr(p.startsOn, p.lengthDays - 1));
  return over > 0 ? `This phase runs ${over} day${over === 1 ? "" : "s"} past the season end on ${dayLabel(p.seasonEnd)}.` : null;
}

export const PHASE_TYPE_LABELS: Record<PhaseType, string> = {
  general: "General",
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  transition: "Transition",
};

/** A season holds at most this many phases, so the read tool stays small. */
export const SEASON_MAX_PHASES = 30;

/** A cycle in a season refuses its own race fields (D8). */
export const SEASON_CYCLE_RACE = "This cycle is a phase of a season. Set races on the season.";
/** A phase's length changes on the season, which schedules the next phase again. */
export const SEASON_CYCLE_LENGTH = "This cycle is a phase of a season. Change its length on the season.";

/** `YYYY-MM-DD` as "22 Aug 2027", by the calendar (no time zone). */
export function dayLabel(day: string): string {
  return dateLabel(day, "d MMM yyyy");
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `YYYY-MM-DD` as "Thu 14 Nov", by the calendar (no time zone). Written by
 * hand, not with Intl: engines format these options differently (Linux WebKit
 * gives "Thu, 14 Nov"), and client components render it on the server and in
 * the browser, which must agree for hydration.
 */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/**
 * A short phase length for a list row: "8 wk" or "10 days"
 * (docs/design/plan-redesign/spec.md). Days that make whole weeks read as
 * weeks: a fitted 105 days is "15 wk".
 */
export function lengthShort(p: { durationWeeks: number; durationDays: number | null }): string {
  if (p.durationDays != null && p.durationDays % 7 !== 0) return `${p.durationDays} day${p.durationDays === 1 ? "" : "s"}`;
  return `${p.durationDays != null ? p.durationDays / 7 : p.durationWeeks} wk`;
}

/** A length in days as a phase length: whole weeks as weeks, else days. */
export function lengthFromDays(days: number): { durationWeeks: number; durationDays: number | null } {
  return days % 7 === 0 ? { durationWeeks: days / 7, durationDays: null } : { durationWeeks: Math.ceil(days / 7), durationDays: days };
}

/**
 * The length a phase runs, by its dates: "1 wk" for a 7 week phase that a
 * scheduled start cuts after one week (cutByStart). The planned length shows
 * only where the user edits it.
 */
export function runLength(p: { lengthDays: number }): string {
  return lengthShort(lengthFromDays(p.lengthDays));
}

export type LengthUnit = "weeks" | "days";

/**
 * A phase length field moved to another unit, the length kept: 15 weeks is
 * 105 days, and days become weeks only when they are whole weeks. Otherwise
 * the field stays in days, with a note that says why.
 */
export function switchLengthUnit(length: string, from: LengthUnit, to: LengthUnit): { length: string; unit: LengthUnit; note: string | null } {
  const n = Number(length);
  if (from === to || !length || !Number.isInteger(n) || n <= 0) return { length, unit: to, note: null };
  if (to === "days") return { length: String(n * 7), unit: "days", note: null };
  if (n % 7 === 0) return { length: String(n / 7), unit: "weeks", note: null };
  return { length, unit: "days", note: `${n} days is not a whole number of weeks, so the length stays in days.` };
}

/** How the phase sheet opens a length: in weeks when the days make whole weeks. */
export function lengthField(p: { durationWeeks: number; durationDays: number | null }): { length: string; unit: LengthUnit } {
  if (p.durationDays != null && p.durationDays % 7 !== 0) return { length: String(p.durationDays), unit: "days" };
  return { length: String(p.durationDays != null ? p.durationDays / 7 : p.durationWeeks), unit: "weeks" };
}

/** Two days as a range: "16 Nov – 10 Jan", or "17 – 26 Aug" in one month. */
export function rangeLabel(start: string, end: string): string {
  const a = shortDay(start).slice(4);
  const b = shortDay(end).slice(4);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${a.split(" ")[0]} – ${b}`;
  return `${a} – ${b}`;
}

/** A phase length in words: "10 days" or "6 weeks". */
export function lengthLabel(p: { durationWeeks: number; durationDays: number | null }): string {
  if (p.durationDays != null) return `${p.durationDays} day${p.durationDays === 1 ? "" : "s"}`;
  return `${p.durationWeeks} week${p.durationWeeks === 1 ? "" : "s"}`;
}
