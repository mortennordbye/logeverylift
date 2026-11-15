/**
 * The user's running cycle and scheduled draft, read for a screen that starts
 * or schedules a cycle, so it can say what that ends or drops
 * (src/lib/utils/cycle-start.ts has the words).
 *
 * Plain server code: the caller resolves the user.
 */

import { db } from "@/db";
import { seasons, trainingCycles } from "@/db/schema";
import { liveCycles } from "@/lib/plan-live";
import { cycleWeek, parseDateStr } from "@/lib/utils/cycle-position";
import type { RunningCycle, ScheduledDraft } from "@/lib/utils/cycle-start";
import type { RunningBlock } from "@/lib/utils/season-start";
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";

/**
 * The running cycle, with the live season it is a phase of, and the draft
 * scheduled next, in one read.
 */
export async function startBlocks(userId: string) {
  const rows = await db
    .select({
      id: trainingCycles.id,
      name: trainingCycles.name,
      status: trainingCycles.status,
      startDate: trainingCycles.startDate,
      scheduledStartDate: trainingCycles.scheduledStartDate,
      durationWeeks: trainingCycles.durationWeeks,
      durationDays: trainingCycles.durationDays,
      seasonId: seasons.id,
      seasonName: seasons.name,
    })
    .from(trainingCycles)
    // A phase of a deleted season acts as a cycle with no season.
    .leftJoin(seasons, and(eq(seasons.id, trainingCycles.seasonId), isNull(seasons.deletedAt)))
    .where(and(eq(trainingCycles.userId, userId), liveCycles));
  const active = rows.find((c) => c.status === "active" && c.startDate);
  const draft = rows
    .filter((c) => c.status === "draft" && c.scheduledStartDate)
    .sort((a, b) => a.scheduledStartDate!.localeCompare(b.scheduledStartDate!))[0];
  const running: RunningBlock | null = active
    ? {
        id: active.id,
        name: active.name,
        startDate: active.startDate!,
        durationWeeks: active.durationWeeks,
        durationDays: active.durationDays,
        seasonId: active.seasonId,
      }
    : null;
  const scheduled: ScheduledDraft | null = draft
    ? {
        id: draft.id,
        name: draft.name,
        day: draft.scheduledStartDate!,
        season: draft.seasonId != null ? { id: draft.seasonId, name: draft.seasonName! } : null,
      }
    : null;
  return { running, scheduled };
}

/**
 * The block scheduled to start next: its id, name, start day and the season
 * it is a phase of. One cycle is scheduled at a time.
 */
export async function upcomingCycle(userId: string) {
  const [row] = await db
    .select({
      id: trainingCycles.id,
      name: trainingCycles.name,
      startsOn: trainingCycles.scheduledStartDate,
      seasonName: seasons.name,
    })
    .from(trainingCycles)
    .leftJoin(seasons, and(eq(seasons.id, trainingCycles.seasonId), isNull(seasons.deletedAt)))
    .where(
      and(
        eq(trainingCycles.userId, userId),
        eq(trainingCycles.status, "draft"),
        isNotNull(trainingCycles.scheduledStartDate),
        liveCycles,
      ),
    )
    .orderBy(asc(trainingCycles.scheduledStartDate))
    .limit(1);
  return row?.startsOn ? { id: row.id, name: row.name, startsOn: row.startsOn, seasonName: row.seasonName } : null;
}

export async function cycleStartContext(userId: string, today: string): Promise<{ running: RunningCycle | null; scheduled: ScheduledDraft | null }> {
  const { running, scheduled } = await startBlocks(userId);
  return {
    running: running
      ? {
          id: running.id,
          name: running.name,
          week: cycleWeek(parseDateStr(running.startDate), running.durationWeeks, parseDateStr(today), running.durationDays).currentWeek,
          totalWeeks: running.durationWeeks,
          startDate: running.startDate,
          durationDays: running.durationDays,
        }
      : null,
    scheduled,
  };
}

/**
 * The cycle that started first after `cycle` started: what really followed a
 * completed cycle. A draft scheduled later is not it when another block ran
 * in between.
 */
export async function cycleStartedAfter(
  userId: string,
  cycle: { id: number; startDate: string | null },
): Promise<{ id: number; name: string; startDate: string } | null> {
  if (!cycle.startDate) return null;
  const [row] = await db
    .select({ id: trainingCycles.id, name: trainingCycles.name, startDate: trainingCycles.startDate })
    .from(trainingCycles)
    .where(
      and(
        eq(trainingCycles.userId, userId),
        liveCycles,
        ne(trainingCycles.id, cycle.id),
        inArray(trainingCycles.status, ["active", "completed"]),
        gt(trainingCycles.startDate, cycle.startDate),
      ),
    )
    .orderBy(asc(trainingCycles.startDate), asc(trainingCycles.id))
    .limit(1);
  return row ? { id: row.id, name: row.name, startDate: row.startDate! } : null;
}
