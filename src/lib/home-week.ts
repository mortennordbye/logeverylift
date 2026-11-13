/**
 * The home screen's week of dated sessions (docs/plans/sessions.md, 5). Reading
 * them can write (the first read of a cycle makes its sessions), so a failure
 * here must not take the home screen down: the week strip falls back to the
 * template, as before C2 (review 5).
 */

import { listPlanned, type PlannedView } from "@/lib/planned-sessions";

export async function homeWeekPlanned(userId: string, from: string, to: string, cycleId: number): Promise<PlannedView[] | null> {
  try {
    return await listPlanned(userId, from, to, cycleId);
  } catch (e) {
    console.error("[home] planned week failed", { cycleId }, e instanceof Error ? e.message : "unknown");
    return null;
  }
}
