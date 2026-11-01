import { db } from "@/db";
import { trainingCycleSlots, trainingCycles } from "@/db/schema";
import { cycleWeek, parseDateStr } from "@/lib/utils/cycle-position";
import { deloadCadenceForLevel, periodizedLoad } from "@/lib/utils/periodization";
import { and, eq } from "drizzle-orm";

/**
 * This week's share of peak for a program in the user's active cycle: the curve
 * times the adaptation nudge, the same factor the weekly sync scales peaks by.
 * 1 when the program is in no active cycle, so a typed value is the peak.
 *
 * Takes `userId` because it is called from a Server Action and an MCP tool that
 * have each already resolved it; it is not an action itself.
 */
export async function periodizationShare(programId: number, userId: string): Promise<number> {
  const [cycle] = await db
    .select({
      startDate: trainingCycles.startDate,
      durationWeeks: trainingCycles.durationWeeks,
      goal: trainingCycles.goal,
      athleteLevel: trainingCycles.athleteLevel,
      adaptationPct: trainingCycles.adaptationPct,
    })
    .from(trainingCycleSlots)
    .innerJoin(trainingCycles, eq(trainingCycles.id, trainingCycleSlots.trainingCycleId))
    .where(
      and(
        eq(trainingCycleSlots.programId, programId),
        eq(trainingCycles.userId, userId),
        eq(trainingCycles.status, "active"),
      ),
    )
    .limit(1);
  if (!cycle?.startDate) return 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { currentWeek } = cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, today);
  const { multiplier } = periodizedLoad(
    currentWeek,
    cycle.durationWeeks,
    cycle.goal,
    deloadCadenceForLevel(cycle.athleteLevel),
  );
  const share = multiplier * (cycle.adaptationPct / 100);
  return share > 0 ? share : 1;
}
