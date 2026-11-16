/**
 * The data of the Plan list (/cycles, docs/plans/plan-tab-redesign.md, P1),
 * read on the server in the user's time zone and turned into plain view
 * models by src/lib/utils/plan-list.ts.
 *
 * Plain server code: the caller resolves the user.
 */

import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { liveCycles } from "@/lib/plan-live";
import { cyclesCompletedAt } from "@/lib/plan-revisions";
import { ensureCycleSessions, listPlanned } from "@/lib/planned-sessions";
import { getSeasonDetail, listSeasons } from "@/lib/seasons";
import { sessionCompliance } from "@/lib/session-compliance";
import { dayMonth } from "@/lib/home/labels";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { blockWeeks, dayLabels, weekDays as blockWeekDays, rotationRows, weekIndexOf, type RotationWalkDay } from "@/lib/utils/cycle-detail";
import { cycleLengthDays, toDateStr } from "@/lib/utils/cycle-position";
import {
  blockEnd,
  heroLabel,
  pastEnd,
  pastRow,
  rotationChips,
  runningEnd,
  seasonCard,
  upNextRow,
  weekDays,
  weekSummary,
  type CycleRow,
  type HeroView,
  type SeasonCardView,
  type WeekSession,
} from "@/lib/utils/plan-list";
import { addDaysStr } from "@/lib/utils/seasons";
import { localDateStr } from "@/lib/utils/user-date";
import { and, asc, eq } from "drizzle-orm";

type Cycle = typeof trainingCycles.$inferSelect;

/** A cycle as select mode lists it. */
export type SelectRow = { id: number; name: string; sub: string };

export type PlanListData = {
  /** True when the user has no cycle and no season: the first-open screen. */
  empty: boolean;
  hero: HeroView | null;
  seasons: SeasonCardView[];
  upNext: CycleRow[];
  past: CycleRow[];
  pastSeasons: { id: number; name: string; sub: string }[];
  /** Select mode: the cycles outside a season card. */
  select: { current: SelectRow[]; upNext: SelectRow[]; past: SelectRow[] };
};

async function weekHero(userId: string, c: Cycle, today: string, active: boolean, endurance: boolean, ends: string, cut: boolean): Promise<HeroView> {
  const start = active ? c.startDate! : c.scheduledStartDate!;
  // The block week that holds today, from the block's start day: the 7 days the cycle detail shows.
  const weeks = blockWeeks(start, cycleLengthDays(c));
  const dates = blockWeekDays(weeks[weekIndexOf(weeks, today)]);
  const [withSlots, rows] = await Promise.all([
    getTrainingCycleWithSlots(c.id),
    // Reading can write (the first read makes the dated sessions), so a failure
    // shows an empty week instead of taking the list down, as on home.
    ensureCycleSessions(userId, c.id)
      .then(() => sessionCompliance(userId, dates[0], dates[dates.length - 1], { cycleId: c.id }))
      .catch((e: unknown) => {
        console.error("[planList] week failed", { cycleId: c.id }, e instanceof Error ? e.message : "unknown");
        return [];
      }),
  ]);
  // Days the template names with no session, such as "Mobility".
  const labels = withSlots.success ? dayLabels(withSlots.data.slots) : {};
  const sessions: WeekSession[] = rows.map((r) => ({
    date: r.date,
    name: r.programName ?? r.label ?? null,
    sport: r.sport,
    sports: r.sports,
    key: r.priority === "key",
    brick: r.brickParentId != null,
    skipped: r.status === "skipped",
    durationSeconds: r.planned.durationSeconds,
  }));
  return {
    kind: "week",
    id: c.id,
    name: c.name,
    label: heroLabel(c, today, active, cut),
    ends,
    days: weekDays(dates, sessions, today, endurance, labels),
    summary: weekSummary(sessions),
  };
}

async function rotationHero(userId: string, c: Cycle, today: string, active: boolean, ends: string, cut: boolean): Promise<HeroView> {
  const withSlots = await getTrainingCycleWithSlots(c.id);
  const slots = withSlots.success
    ? withSlots.data.slots.map((s) => ({ id: s.id, orderIndex: s.orderIndex ?? null, programId: s.programId ?? null, label: s.label ?? null, programName: s.program?.name ?? null }))
    : [];
  // The walk, as the cycle detail reads it: a swapped session shows its program, a skipped one its mark.
  let walk: RotationWalkDay[] = [];
  if (active) {
    try {
      walk = (await listPlanned(userId, addDaysStr(today, -14), addDaysStr(today, slots.length + 7), c.id)).filter((d) => d.rotationPosition != null);
    } catch (e) {
      console.error("[planList] rotation failed", { cycleId: c.id }, e instanceof Error ? e.message : "unknown");
    }
  }
  let rows = rotationRows(slots, walk, today);
  if (!active) {
    // A block that has not started begins at its first session.
    const first = rows.find((r) => !r.rest);
    rows = rows.map((r) => (r === first ? { ...r, mark: "next" } : r));
  }
  return {
    kind: "rotation",
    id: c.id,
    name: c.name,
    label: heroLabel(c, today, active, cut),
    ends,
    chips: rotationChips(rows),
    next: rows.find((r) => r.mark === "next")?.name ?? null,
  };
}

export async function loadPlanList(userId: string, endurance: boolean): Promise<PlanListData> {
  const today = toDateStr(await userToday(userId));
  const [cycles, seasonList] = await Promise.all([
    db
      .select()
      .from(trainingCycles)
      .where(and(eq(trainingCycles.userId, userId), liveCycles))
      .orderBy(asc(trainingCycles.createdAt)),
    listSeasons(userId),
  ]);

  // The running season first, then the rest by start day.
  const liveSeasons = seasonList
    .filter((s) => s.status !== "done")
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.startDate.localeCompare(b.startDate) || a.id - b.id);
  const active = cycles.find((c) => c.status === "active") ?? null;
  const scheduled = cycles
    .filter((c) => c.status === "draft" && c.scheduledStartDate)
    .sort((a, b) => a.scheduledStartDate!.localeCompare(b.scheduledStartDate!));
  // The scheduled start ends the running cycle the day before (J4-18).
  const otherStart = scheduled[0]?.scheduledStartDate ?? null;
  const heroCycle = active ?? scheduled[0] ?? null;
  const heroStart = heroCycle ? (heroCycle === active ? heroCycle.startDate! : heroCycle.scheduledStartDate!) : null;
  const heroPlannedEnd = heroCycle && heroStart ? blockEnd(heroStart, heroCycle) : null;
  const heroLast = heroCycle && heroStart && heroPlannedEnd ? (heroCycle === active ? runningEnd(heroStart, heroPlannedEnd, otherStart) : heroPlannedEnd) : null;
  const heroEnds = heroLast ? `Ends ${dayMonth(heroLast)}` : "";
  // A start that ends the running cycle early drops the hero's "of M" (round 10).
  const heroCut = heroLast != null && heroLast !== heroPlannedEnd;
  const [seasonDetails, hero] = await Promise.all([
    Promise.all(liveSeasons.map((s) => getSeasonDetail(userId, s.id))),
    heroCycle
      ? heroCycle.scheduleType === "rotation"
        ? rotationHero(userId, heroCycle, today, heroCycle === active, heroEnds, heroCut)
        : weekHero(userId, heroCycle, today, heroCycle === active, endurance, heroEnds, heroCut)
      : null,
  ]);
  const details = seasonDetails.filter((d) => d != null);
  const seasons = details.map((d) => seasonCard(d.season, d.phases, d.aRace, today, otherStart));
  const inCard = new Set(details.flatMap((d) => d.phases.map((p) => p.id)));

  const drafts = cycles
    .filter((c) => c.status === "draft" && !inCard.has(c.id))
    .sort((a, b) => (a.scheduledStartDate ?? "9999").localeCompare(b.scheduledStartDate ?? "9999"));
  const done = cycles.filter((c) => c.status === "completed" && !inCard.has(c.id));
  // The day each one completed, in the user's zone: an early end is dated by it.
  const [completedAt, { timeZone }] = await Promise.all([cyclesCompletedAt(userId, done.map((c) => c.id)), getUserSettings(userId)]);
  const completedOn = new Map([...completedAt].map(([id, at]) => [id, localDateStr(at, timeZone)]));
  const endOf = (c: Cycle) => pastEnd(c, completedOn.get(c.id) ?? null) ?? "";
  const past = done.sort((a, b) => endOf(b).localeCompare(endOf(a))).map((c) => pastRow(c, completedOn.get(c.id) ?? null));
  const selectRow = (r: CycleRow): SelectRow => ({ id: r.id, name: r.name, sub: r.starts ? `${r.sub} · ${r.starts}` : r.sub });

  return {
    empty: cycles.length === 0 && seasonList.length === 0,
    hero,
    seasons,
    upNext: drafts.filter((c) => c.id !== heroCycle?.id).map((c) => upNextRow(c, today)),
    past,
    pastSeasons: seasonList
      .filter((s) => s.status === "done")
      .map((s) => ({ id: s.id, name: s.name, sub: `Season · ended ${dayMonth(s.endDate)}` })),
    select: {
      current: active && !inCard.has(active.id) ? [{ id: active.id, name: active.name, sub: hero?.label ?? "" }] : [],
      upNext: drafts.map((c) => selectRow(upNextRow(c, today))),
      past: past.map(selectRow),
    },
  };
}
