/**
 * The user's running cycle and scheduled draft, read for a screen that starts
 * or schedules a cycle, so it can say what that ends or drops
 * (src/lib/utils/cycle-start.ts has the words).
 *
 * Plain server code: the caller resolves the user.
 */

import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import { liveCycles } from "@/lib/plan-live";
import { cycleWeek, parseDateStr } from "@/lib/utils/cycle-position";
import type { RunningCycle, ScheduledDraft } from "@/lib/utils/cycle-start";
import { and, eq } from "drizzle-orm";

export async function cycleStartContext(userId: string, today: string): Promise<{ running: RunningCycle | null; scheduled: ScheduledDraft | null }> {
  const rows = await db
    .select({
      id: trainingCycles.id,
      name: trainingCycles.name,
      status: trainingCycles.status,
      startDate: trainingCycles.startDate,
      scheduledStartDate: trainingCycles.scheduledStartDate,
      durationWeeks: trainingCycles.durationWeeks,
      durationDays: trainingCycles.durationDays,
    })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.userId, userId), liveCycles));
  const active = rows.find((c) => c.status === "active" && c.startDate);
  const draft = rows
    .filter((c) => c.status === "draft" && c.scheduledStartDate)
    .sort((a, b) => a.scheduledStartDate!.localeCompare(b.scheduledStartDate!))[0];
  return {
    running: active
      ? {
          id: active.id,
          name: active.name,
          week: cycleWeek(parseDateStr(active.startDate!), active.durationWeeks, parseDateStr(today), active.durationDays).currentWeek,
          totalWeeks: active.durationWeeks,
        }
      : null,
    scheduled: draft ? { id: draft.id, name: draft.name, day: draft.scheduledStartDate! } : null,
  };
}
