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
import { ensureCycleSessions, listPlanned } from "@/lib/planned-sessions";
import { getSeasonDetail, listSeasons } from "@/lib/seasons";
import { sessionCompliance } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import {
  blockEnd,
  dayMonth,
  heroLabel,
  pastEnd,
  pastRow,
  rotationChips,
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
import { weekDatesOf } from "@/lib/utils/user-date";
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

async function weekHero(userId: string, c: Cycle, today: string, active: boolean, endurance: boolean): Promise<HeroView> {
  const start = active ? c.startDate! : c.scheduledStartDate!;
  const dates = weekDatesOf(active ? today : start);
  let sessions: WeekSession[] = [];
  // Reading can write (the first read makes the dated sessions), so a failure
  // shows an empty week instead of taking the list down, as on home.
  try {
    await ensureCycleSessions(userId, c.id);
    const rows = await sessionCompliance(userId, dates[0], dates[6], { cycleId: c.id });
    sessions = rows.map((r) => ({
      date: r.date,
      name: r.programName ?? r.label ?? r.workout?.name ?? null,
      sport: r.sport,
      sports: r.sports,
      key: r.priority === "key",
      brick: r.brickParentId != null,
      skipped: r.status === "skipped",
      durationSeconds: r.planned.durationSeconds,
    }));
  } catch (e) {
    console.error("[planList] week failed", { cycleId: c.id }, e instanceof Error ? e.message : "unknown");
  }
  return {
    kind: "week",
    id: c.id,
    name: c.name,
    label: heroLabel(c, today, active),
    ends: `Ends ${dayMonth(blockEnd(start, c))}`,
    days: weekDays(dates, sessions, today, endurance),
    summary: weekSummary(sessions),
  };
}

async function rotationHero(userId: string, c: Cycle, today: string, active: boolean): Promise<HeroView> {
  const start = active ? c.startDate! : c.scheduledStartDate!;
  const withSlots = await getTrainingCycleWithSlots(c.id);
  const slots = withSlots.success
    ? withSlots.data.slots.map((s) => ({ id: s.id, orderIndex: s.orderIndex, name: s.programId != null ? (s.program?.name ?? s.label ?? "Session") : null }))
    : [];
  let lastDone: number | null = null;
  let next: { slotId: number | null; name: string | null } | null = null;
  if (active) {
    try {
      const days = await listPlanned(userId, addDaysStr(today, -14), addDaysStr(today, slots.length + 7), c.id);
      const done = days.filter((d) => d.date < today && d.status === "done").at(-1);
      const upcoming = days.find((d) => d.date >= today && d.status === "planned");
      lastDone = done?.slotId ?? null;
      next = upcoming ? { slotId: upcoming.slotId, name: upcoming.programName } : null;
    } catch (e) {
      console.error("[planList] rotation failed", { cycleId: c.id }, e instanceof Error ? e.message : "unknown");
    }
  } else {
    const first = [...slots].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)).find((s) => s.name != null);
    next = first ? { slotId: first.id, name: first.name } : null;
  }
  return {
    kind: "rotation",
    id: c.id,
    name: c.name,
    label: heroLabel(c, today, active),
    ends: `Ends ${dayMonth(blockEnd(start, c))}`,
    chips: rotationChips(slots, lastDone, next?.slotId ?? null),
    next: next?.name ?? null,
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

  const liveSeasons = seasonList.filter((s) => s.status !== "done");
  const details = (await Promise.all(liveSeasons.map((s) => getSeasonDetail(userId, s.id)))).filter((d) => d != null);
  const seasons = details.map((d) => seasonCard(d.season, d.phases, d.aRace, today));
  const inCard = new Set(details.flatMap((d) => d.phases.map((p) => p.id)));

  const active = cycles.find((c) => c.status === "active") ?? null;
  const scheduled = cycles
    .filter((c) => c.status === "draft" && c.scheduledStartDate)
    .sort((a, b) => a.scheduledStartDate!.localeCompare(b.scheduledStartDate!));
  const heroCycle = active ?? scheduled[0] ?? null;
  const hero = heroCycle
    ? heroCycle.scheduleType === "rotation"
      ? await rotationHero(userId, heroCycle, today, heroCycle === active)
      : await weekHero(userId, heroCycle, today, heroCycle === active, endurance)
    : null;

  const drafts = cycles
    .filter((c) => c.status === "draft" && !inCard.has(c.id))
    .sort((a, b) => (a.scheduledStartDate ?? "9999").localeCompare(b.scheduledStartDate ?? "9999"));
  const completed = cycles
    .filter((c) => c.status === "completed" && !inCard.has(c.id))
    .sort((a, b) => (pastEnd(b, today) ?? "").localeCompare(pastEnd(a, today) ?? ""));
  const selectRow = (r: CycleRow): SelectRow => ({ id: r.id, name: r.name, sub: r.starts ? `${r.sub} · ${r.starts}` : r.sub });

  return {
    empty: cycles.length === 0 && seasonList.length === 0,
    hero,
    seasons,
    upNext: drafts.filter((c) => c.id !== heroCycle?.id).map((c) => upNextRow(c, today)),
    past: completed.map((c) => pastRow(c, today)),
    pastSeasons: seasonList
      .filter((s) => s.status === "done")
      .map((s) => ({ id: s.id, name: s.name, sub: `Season · ended ${dayMonth(s.endDate)}${s.endDate.slice(0, 4) !== today.slice(0, 4) ? ` ${s.endDate.slice(0, 4)}` : ""}` })),
    select: {
      current: active && !inCard.has(active.id) ? [{ id: active.id, name: active.name, sub: hero?.label ?? "" }] : [],
      upNext: drafts.map((c) => selectRow(upNextRow(c, today))),
      past: completed.map((c) => selectRow(pastRow(c, today))),
    },
  };
}
