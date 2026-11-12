/**
 * The completed source='auto' sessions for cycle days tracked outside the app,
 * as plain server code: getActiveCycleForUser writes them for due days, and
 * the MCP confirm_session tool writes one for a day the assistant confirms.
 * Moved unchanged from src/lib/actions/training-cycles.ts.
 */

import { db } from "@/db";
import { workoutSessions } from "@/db/schema";

/**
 * Write the completed source='auto' sessions for cycle days tracked outside the
 * app. Timed at noon on the day so startTime-keyed counts (weekly goal, streak)
 * and date-keyed ones agree. The uniq_ws_auto_day partial index turns a
 * concurrent duplicate into a no-op.
 */
export async function insertAutoSessions(
  userId: string,
  due: { date: string; programId: number; plannedSessionId?: number | null }[],
): Promise<void> {
  if (due.length === 0) return;
  await db
    .insert(workoutSessions)
    .values(
      due.map((d) => {
        const at = new Date(`${d.date}T12:00:00`);
        return {
          userId,
          programId: d.programId,
          plannedSessionId: d.plannedSessionId ?? null,
          date: d.date,
          startTime: at,
          endTime: at,
          isCompleted: true,
          source: "auto" as const,
        };
      }),
    )
    .onConflictDoNothing();
}
