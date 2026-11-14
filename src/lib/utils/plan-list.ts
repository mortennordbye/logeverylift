/**
 * The Plan list (docs/plans/plan-tab-redesign.md, P1): the words and marks of
 * the hero card, the season cards and the cycle rows, worked out from plain
 * data and the user's today. No database access and no Intl, so the server
 * builds these and the client renders the same text.
 */

import { dayMonth } from "@/lib/home/labels";
import { dayLabelOn, type RotationRow } from "@/lib/utils/cycle-detail";
import { cycleLengthDays } from "@/lib/utils/cycle-position";
import {
  PHASE_TYPE_LABELS,
  addDaysStr,
  cutByStart,
  daysBetweenStr,
  nextPhase,
  rangeLabel,
  runLength,
  runLengthDays,
  seasonPaused,
  seasonTimeline,
  shortDay,
  shownTimeline,
  taperFit,
  type PhaseLike,
  type TimelinePhase,
} from "@/lib/utils/seasons";

// ── Words ────────────────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Build · 12 wk · 5 Apr – 27 Jun". */
export function phaseSub(p: Pick<TimelinePhase, "phaseType" | "lengthDays" | "start" | "end">): string {
  return [p.phaseType ? PHASE_TYPE_LABELS[p.phaseType] : null, runLength(p), rangeLabel(p.start, p.end)].filter(Boolean).join(" · ");
}

/** "Starts today", "Starts tomorrow", "Starts Mon 16 Nov" inside a week, else "Starts 21 Dec". A weekday never comes without its date (J4-17). */
export function startsLabel(today: string, start: string): string {
  const n = daysBetweenStr(today, start);
  if (n <= 0) return "Starts today";
  if (n === 1) return "Starts tomorrow";
  if (n <= 6) return `Starts ${shortDay(start)}`;
  return `Starts ${dayMonth(start)}`;
}

/**
 * The badge of a season's next phase, the same on the Plan list and the
 * season page: its start day when it is scheduled, Paused when the chain is
 * paused (seasonPaused), else Next for a season not started.
 */
export function nextPhaseBadge(next: { scheduled: boolean; plannedStart: string }, timeline: { state: TimelinePhase["state"] }[], today: string): string {
  if (next.scheduled) return startsLabel(today, next.plannedStart);
  return seasonPaused(next, timeline, today) ? "Paused" : "Next";
}

/**
 * One colour rule for a phase badge, on the Plan list and the season page
 * (spec: the accent marks only now and next): "Now", "Next" and "Starts ..."
 * in the accent; "Done" and "Paused" grey.
 */
export function badgeAccent(badge: string | null): boolean {
  return badge === "Now" || badge === "Next" || (badge?.startsWith("Starts") ?? false);
}

/**
 * A phase's part of the season bar: filled once it has started (done, or the
 * running one with an outline), only outlined when it is the next phase and
 * nothing runs, else grey. A phase that has not started is never filled.
 */
export function phaseBarTone(state: TimelinePhase["state"], outlinedNext: boolean): BarSegment["tone"] {
  if (state === "done") return "accent";
  if (state === "active") return "current";
  return outlinedNext ? "next" : "grey";
}

/** The last day of the running block: its planned end, or the day before another block's scheduled start. */
export function runningEnd(start: string, end: string, otherStart: string | null): string {
  return cutByStart(start, end, otherStart);
}

export const scheduleWords = (t: "day_of_week" | "rotation") => (t === "rotation" ? "Rotation" : "Same days each week");

// ── Cycles ───────────────────────────────────────────────────────────────────

type CycleLike = {
  id: number;
  name: string;
  durationWeeks: number;
  durationDays: number | null;
  scheduleType: "day_of_week" | "rotation";
  startDate: string | null;
  scheduledStartDate: string | null;
};

/** The last day of a block that starts on `start` (inclusive). */
export const blockEnd = (start: string, c: { durationWeeks: number; durationDays: number | null }) => addDaysStr(start, cycleLengthDays(c) - 1);

/** `starts` is drawn in the accent when it is a scheduled start. */
export type CycleRow = { id: number; name: string; sub: string; starts: string | null; startsAccent: boolean };

/** An "Up next" row: "4 weeks · Same days each week", and "Starts 21 Dec" when scheduled, else "Not started". */
export function upNextRow(c: CycleLike, today: string): CycleRow {
  return {
    id: c.id,
    name: c.name,
    sub: `${plural(c.durationWeeks, "week")} · ${scheduleWords(c.scheduleType)}`,
    starts: c.scheduledStartDate ? startsLabel(today, c.scheduledStartDate) : "Not started",
    startsAccent: c.scheduledStartDate != null,
  };
}

/** The day a completed block ended: its planned last day, or today when it was ended early. */
export function pastEnd(c: CycleLike, today: string): string | null {
  if (!c.startDate) return null;
  const end = blockEnd(c.startDate, c);
  return end < today ? end : today;
}

/** A "Past cycles" row: "8 weeks · ended 8 Nov". */
export function pastRow(c: CycleLike, today: string): CycleRow {
  const end = pastEnd(c, today);
  return { id: c.id, name: c.name, sub: `${plural(c.durationWeeks, "week")}${end ? ` · ended ${dayMonth(end)}` : ""}`, starts: null, startsAccent: false };
}

// ── Hero ─────────────────────────────────────────────────────────────────────

export type HeroDay = {
  date: string;
  /** "Mon". */
  day: string;
  /** "Lift", "Bike", "Multi", "Brick", "Rest", or a day's own label up to its first comma ("Mobility"). */
  short: string;
  rest: boolean;
  key: boolean;
  today: boolean;
  /** What the day holds, for the accessible name. */
  names: string;
};

export type RotationChip = { id: number; name: string; rest: boolean; tag: "Done" | "Next" | "Skipped" | "Swapped" | null };

type HeroBase = { id: number; name: string; label: string; ends: string };
export type HeroView =
  | (HeroBase & { kind: "week"; days: HeroDay[]; summary: string })
  | (HeroBase & { kind: "rotation"; chips: RotationChip[]; next: string | null });

/**
 * "Week 3 of 6 · Rotation", or "Starts Mon 16 Nov · Week 1 of 8" for a block
 * that has not started. A running block counts its weeks to the day another
 * block's scheduled start (`otherStart`) cuts it.
 */
export function heroLabel(c: CycleLike, today: string, active: boolean, otherStart: string | null = null): string {
  const start = active ? c.startDate! : c.scheduledStartDate!;
  if (!active) return `Starts ${shortDay(start)} · Week 1 of ${c.durationWeeks}`;
  const runDays = runLengthDays(start, cycleLengthDays(c), otherStart);
  const weeks = runDays === cycleLengthDays(c) ? c.durationWeeks : Math.ceil(runDays / 7);
  const week = Math.min(Math.floor(Math.max(daysBetweenStr(start, today), 0) / 7) + 1, weeks);
  return `Week ${week} of ${weeks} · ${scheduleWords(c.scheduleType)}`;
}

export type WeekSession = {
  date: string;
  name: string | null;
  sport: "swim" | "bike" | "run" | null;
  /** Every endurance sport in the session; more than one (or a sport with lifts) leaves `sport` null. */
  sports: ("swim" | "bike" | "run")[];
  key: boolean;
  brick: boolean;
  skipped: boolean;
  durationSeconds: number | null;
};

const SPORT_WORDS = { swim: "Swim", bike: "Bike", run: "Run" } as const;

/**
 * The strip of a weekday block: the days of one block week, from the block's
 * start weekday. A day with no session reads its own label (`dayLabels`) when
 * the template gives it one, else Rest.
 */
export function weekDays(dates: string[], sessions: WeekSession[], today: string, keyMarks: boolean, labels?: Record<number, string>): HeroDay[] {
  return dates.map((date) => {
    const mine = sessions.filter((s) => s.date === date && !s.skipped);
    const rest = mine.length === 0;
    const label = rest ? dayLabelOn(labels, date) : null;
    const first = mine[0];
    // A session with more than one sport, or a sport and lifts, is "Multi", never "Lift".
    const word = (s: WeekSession) => (s.sport ? SPORT_WORDS[s.sport] : s.sports.length ? "Multi" : "Lift");
    const short = rest ? (label?.split(",")[0].trim() ?? "Rest") : mine.some((s) => s.brick) ? "Brick" : mine.length > 1 ? `${word(first)} +${mine.length - 1}` : word(first);
    return {
      date,
      day: shortDay(date).slice(0, 3),
      short,
      rest,
      key: keyMarks && mine.some((s) => s.key),
      today: date === today,
      names: rest ? (label ?? "Rest") : mine.map((s) => s.name ?? "Session").join(", "),
    };
  });
}

/**
 * "6 sessions · about 7 h": the count, and the planned time only when every
 * session has one. A lift or a session planned by distance has no time, and a
 * sum without them would read as the whole week.
 */
export function weekSummary(sessions: WeekSession[]): string {
  const live = sessions.filter((s) => !s.skipped);
  const count = plural(live.length, "session");
  if (live.some((s) => !s.durationSeconds)) return count;
  const seconds = live.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);
  if (seconds <= 0) return count;
  const time = seconds >= 3600 ? `about ${Math.round(seconds / 3600)} h` : `about ${Math.max(5, Math.round(seconds / 300) * 5)} min`;
  return `${count} · ${time}`;
}

/**
 * The rotation in order from the detail's order rows (`rotationRows`), so a
 * swapped session shows its program and a skipped one its mark, as the
 * detail and the hero's footer do. Of the sessions done, only the last one
 * done is marked.
 */
export function rotationChips(rows: Pick<RotationRow, "slotId" | "name" | "rest" | "mark" | "lastDone">[]): RotationChip[] {
  let last: (typeof rows)[number] | null = null;
  for (const r of rows) if (r.lastDone && (!last || r.lastDone > last.lastDone!)) last = r;
  return rows.map((r) => ({
    id: r.slotId,
    name: r.name,
    rest: r.rest,
    tag: r.mark === "next" ? "Next" : r.mark === "skipped" ? "Skipped" : r.mark === "swapped" ? "Swapped" : r === last ? "Done" : null,
  }));
}

// ── Seasons ──────────────────────────────────────────────────────────────────

export type SeasonPhaseData = PhaseLike;

export type PhaseRowView = { id: number; name: string; sub: string; mark: "accent" | "grey"; badge: string | null; badgeAccent: boolean };
export type BarSegment = { id: number; flex: number; tone: "accent" | "current" | "next" | "grey" };

export type SeasonCardView = {
  id: number;
  name: string;
  replan: boolean;
  /** The A race; null makes it a goal season. */
  race: { name: string; when: string; daysLeft: number | null } | null;
  /** "Goal by 7 Feb" and the days left, counted as the season page counts them, for a goal season. */
  goalBy: string;
  daysLeft: number;
  bar: BarSegment[];
  barLabel: string;
  phases: PhaseRowView[];
  /** What select mode needs to say what deleting phases does. */
  startDate: string;
  raceDate: string | null;
  phaseData: SeasonPhaseData[];
};

export function seasonCard(
  s: { id: number; name: string; startDate: string; endDate: string; replanFlaggedAt: Date | null },
  phases: PhaseLike[],
  aRace: { name: string; raceDate: string } | null,
  today: string,
  otherStart: string | null = null,
): SeasonCardView {
  const phaseData: SeasonPhaseData[] = phases.map((p) => ({
    id: p.id,
    name: p.name,
    phaseOrder: p.phaseOrder,
    phaseType: p.phaseType,
    durationWeeks: p.durationWeeks,
    durationDays: p.durationDays,
    status: p.status,
    startDate: p.startDate,
    scheduledStartDate: p.scheduledStartDate,
  }));
  const timeline = shownTimeline(s.startDate, phaseData, otherStart, today);
  const active = timeline.find((p) => p.state === "active");
  const next = nextPhase(timeline);
  // The next phase's badge says what the season page says (nextPhaseBadge).
  const nextBadge = (p: TimelinePhase) => nextPhaseBadge({ scheduled: p.scheduledStartDate != null, plannedStart: p.start }, timeline, today);
  const bar = timeline.map<BarSegment>((p) => ({ id: p.id, flex: p.lengthDays, tone: phaseBarTone(p.state, !active && p.id === next?.id) }));
  const rows = timeline.map<PhaseRowView>((p) => {
    const isNext = p.id === next?.id;
    const badge = p.state === "active" ? "Now" : p.state === "done" ? "Done" : isNext ? nextBadge(p) : null;
    return {
      id: p.id,
      name: p.name,
      sub: phaseSub(p),
      mark: p.state === "active" || (!active && isNext) ? "accent" : "grey",
      badge,
      badgeAccent: badgeAccent(badge),
    };
  });
  const barLabel = timeline.length
    ? `Phase bar: ${timeline.map((p) => `${p.name}${p.state === "active" ? " now" : p.state === "done" ? " done" : ""}`).join(", then ")}`
    : "No phases yet";
  return {
    id: s.id,
    name: s.name,
    replan: s.replanFlaggedAt != null,
    race: aRace
      ? { name: aRace.name, when: dayMonth(aRace.raceDate), daysLeft: aRace.raceDate >= today ? daysBetweenStr(today, aRace.raceDate) : null }
      : null,
    goalBy: `Goal by ${dayMonth(s.endDate)}`,
    daysLeft: Math.max(0, daysBetweenStr(today, s.endDate)),
    bar,
    barLabel,
    phases: rows,
    startDate: s.startDate,
    raceDate: aRace?.raceDate ?? null,
    phaseData,
  };
}

// ── Select mode ──────────────────────────────────────────────────────────────

/** The phases a season would have with `removed` deleted, the chain laid out again. */
function chained(startDate: string, phases: SeasonPhaseData[], removed: Set<number>) {
  return seasonTimeline(
    startDate,
    phases.filter((p) => !removed.has(p.id)).map((p) => (p.status === "draft" ? { ...p, scheduledStartDate: null } : p)),
  );
}

/**
 * The confirm sheet of a delete in select mode: it names each cycle that goes
 * and says where to get it back, as the one-cycle delete does.
 */
export function deleteManyConfirm(names: string[]): { title: string; body: string; action: string } {
  const n = names.length;
  const what = `${n} ${n === 1 ? "cycle" : "cycles"}`;
  const quoted = names.map((x) => `“${x}”`);
  const list = n > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted[n - 1]}` : (quoted[0] ?? "");
  return {
    title: `Delete ${what}?`,
    body: `${list} ${n === 1 ? "goes" : "go"} to Recently deleted. You can restore ${n === 1 ? "it" : "them"} for 90 days.`,
    action: `Delete ${what}`,
  };
}

/**
 * What deleting the selected cycles does to each season they are phases of
 * (J7_SelectMode): the later phases move earlier, and the taper can end
 * before race day. Null when no selected cycle is a phase.
 */
export function phaseDeleteWarning(seasons: Pick<SeasonCardView, "name" | "startDate" | "raceDate" | "phaseData">[], selected: Set<number>): string | null {
  const parts: string[] = [];
  for (const s of seasons) {
    const mine = s.phaseData.filter((p) => selected.has(p.id));
    if (mine.length === 0) continue;
    const all = mine.length === selected.size;
    let text =
      mine.length === 1
        ? `“${mine[0].name}” is a phase of ${s.name}.`
        : all
          ? `${mine.length === 2 ? "Both" : `All ${mine.length}`} are phases of ${s.name}.`
          : `${mine.length} of them are phases of ${s.name}.`;
    // Only planned phases move the chain the way it is laid out here; a
    // started one keeps its real dates.
    if (mine.every((p) => p.status === "draft")) {
      const removed = new Set(mine.map((p) => p.id));
      const before = chained(s.startDate, s.phaseData, new Set());
      const after = chained(s.startDate, s.phaseData, removed);
      const firstRemoved = before.findIndex((p) => removed.has(p.id));
      const later = before.slice(firstRemoved).find((p) => !removed.has(p.id));
      const moved = later ? daysBetweenStr(after.find((p) => p.id === later.id)!.start, later.start) : 0;
      const race = s.raceDate ? { raceDate: s.raceDate } : null;
      const fitBefore = taperFit(before, race);
      const fitAfter = taperFit(after, race);
      const taperGone = fitBefore.status !== "no_taper" && fitBefore.status !== "no_race" && fitAfter.status === "no_taper";
      const early = fitAfter.status === "early" && (fitBefore.status !== "early" || fitAfter.days > fitBefore.days);
      if (moved > 0) {
        text += ` The later phases move ${plural(moved, "day")} earlier${early ? ", so the taper will end before race day. You will need to re-plan." : "."}`;
      }
      if (taperGone) text += " The season will have no taper. You will need to re-plan.";
    }
    parts.push(text);
  }
  return parts.length ? parts.join(" ") : null;
}
