"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { setDisplayUnitsSchema, setTimeZoneSchema } from "@/lib/validators/user-settings";
import type { ActionResult } from "@/types/workout";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/** Set the user's time zone (src/lib/utils/user-date.ts). */
export async function setTimeZone(data: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const auth = await requireSession();
  const parsed = setTimeZoneSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const where = parsed.data.ifUnset
      ? and(eq(users.id, auth.user.id), isNull(users.timeZone))
      : eq(users.id, auth.user.id);
    const rows = await db
      .update(users)
      .set({ timeZone: parsed.data.timeZone })
      .where(where)
      .returning({ id: users.id });
    // Not for the one-time fill: it runs on whatever page the user opens
    // first, and revalidating there re-renders that page under the user.
    // The provider already has the zone, and every later request reads it.
    if (rows.length > 0 && !parsed.data.ifUnset) revalidatePath("/settings");
    return { success: true, data: { changed: rows.length > 0 } };
  } catch (e) {
    console.error("[setTimeZone] failed", e);
    return { success: false, error: "Failed to update the time zone" };
  }
}

/** Set the user's display units (src/lib/utils/units.ts). Storage stays metric. */
export async function setDisplayUnits(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = setDisplayUnitsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const { distanceUnit, swimUnit } = parsed.data;
    await db
      .update(users)
      .set({ ...(distanceUnit ? { distanceUnit } : {}), ...(swimUnit ? { swimUnit } : {}) })
      .where(eq(users.id, auth.user.id));
    revalidatePath("/settings");
    return { success: true, data: null };
  } catch (e) {
    console.error("[setDisplayUnits] failed", e);
    return { success: false, error: "Failed to update units" };
  }
}
