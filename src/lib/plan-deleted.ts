/**
 * Is a missing cycle or season one the user deleted (softly)? A page that
 * deletes the item it shows is rendered again in the delete's action
 * response (revalidatePath). A notFound() there reaches the client as an
 * uncaught React error while it goes back, so such a page shows a short
 * deleted state for the user's own deleted item instead.
 */

import { db } from "@/db";
import { seasons, trainingCycles } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

export async function ownDeletedCycle(userId: string, cycleId: number): Promise<boolean> {
  const [row] = await db
    // plan-read: includes deleted (only a deleted cycle of this user matches)
    .select({ id: trainingCycles.id })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId), isNotNull(trainingCycles.deletedAt)));
  return row != null;
}

export async function ownDeletedSeason(userId: string, seasonId: number): Promise<boolean> {
  const [row] = await db
    // plan-read: includes deleted (only a deleted season of this user matches)
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.userId, userId), isNotNull(seasons.deletedAt)));
  return row != null;
}
