import { db } from "@/db";
import { exercises } from "@/db/schema";
import type { Exercise } from "@/types/workout";
import { asc, isNull } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

/**
 * The system exercise library — every row with `userId IS NULL`.
 *
 * These 191 rows are seeded, never written by the app, and byte-identical for
 * every user, yet they were re-queried and re-serialised into the RSC payload
 * on all three routes that mount an exercise picker (measured: the
 * add-exercise payload is ~27 KB larger than its siblings).
 *
 * This lives outside `lib/actions/` on purpose: a `"use server"` module makes
 * every export a Server Action, and this is a data loader, not an action.
 *
 * Custom exercises are deliberately NOT cached here — they are per-user, so
 * including them would either leak one user's rows to another or make the
 * cache key per-user and pointless. `getAllExercises` merges them in per
 * request instead.
 *
 * Invalidation: nothing in the app writes system exercises; they change only
 * when `pnpm db:seed` runs, which happens at container boot and takes the
 * in-memory cache with it. The tag is here so that if an admin surface for
 * editing system exercises is ever added, it has a `revalidateTag` target.
 */
export async function getSystemExercises(): Promise<Exercise[]> {
  "use cache";
  cacheTag("exercises:system");
  cacheLife("max");

  return db
    .select()
    .from(exercises)
    .where(isNull(exercises.userId))
    .orderBy(asc(exercises.name));
}

/** Tag to pass to `revalidateTag` if system exercises ever become editable. */
export const SYSTEM_EXERCISES_TAG = "exercises:system";
