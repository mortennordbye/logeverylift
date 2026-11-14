/**
 * Is a missing cycle or season one the user deleted (softly)? A page that
 * deletes the item it shows is rendered again in the delete's action
 * response (revalidatePath). A notFound() there reaches the client as an
 * uncaught React error while it goes back, so such a page shows a short
 * deleted state for the user's own deleted item instead, with its name and
 * a Restore.
 */

import { db } from "@/db";
import { seasons, trainingCycles } from "@/db/schema";
import { deleteRevisionId } from "@/lib/plan-revisions";
import { and, count, eq, isNotNull } from "drizzle-orm";

/** A deleted item of the user: what it was, its name and the revision that restores it. */
export type DeletedItem = { what: "cycle" | "season"; name: string; revisionId: number | null };

export async function ownDeletedCycle(userId: string, cycleId: number): Promise<DeletedItem | null> {
  const [row] = await db
    // plan-read: includes deleted (only a deleted cycle of this user matches)
    .select({ name: trainingCycles.name })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId), isNotNull(trainingCycles.deletedAt)));
  if (!row) return null;
  return { what: "cycle", name: row.name, revisionId: await deleteRevisionId(userId, "cycle", cycleId) };
}

export async function ownDeletedSeason(userId: string, seasonId: number): Promise<DeletedItem | null> {
  const [row] = await db
    // plan-read: includes deleted (only a deleted season of this user matches)
    .select({ name: seasons.name })
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.userId, userId), isNotNull(seasons.deletedAt)));
  if (!row) return null;
  return { what: "season", name: row.name, revisionId: await deleteRevisionId(userId, "season", seasonId) };
}

/** How many cycles and seasons the user deleted: the Plan list's "Recently deleted (n)". */
export async function deletedPlanCount(userId: string): Promise<number> {
  const [[c], [s]] = await Promise.all([
    db.select({ n: count() }).from(trainingCycles).where(and(eq(trainingCycles.userId, userId), isNotNull(trainingCycles.deletedAt))),
    db.select({ n: count() }).from(seasons).where(and(eq(seasons.userId, userId), isNotNull(seasons.deletedAt))),
  ]);
  return c.n + s.n;
}
