"use server";

import { db } from "@/db";
import { BODY_SIDES, BODY_SITES, bodyMeasurements } from "@/db/schema/body-measurements";
import { userToday } from "@/lib/user-settings";
import { SIDED_SITES } from "@/lib/utils/body-measurement-parts";
import type { MeasurementRow } from "@/lib/utils/body-measurements";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const columns = {
  id: bodyMeasurements.id,
  site: bodyMeasurements.site,
  side: bodyMeasurements.side,
  valueCm: bodyMeasurements.valueCm,
  measuredOn: bodyMeasurements.measuredOn,
};

const saveSchema = z
  .object({
    site: z.enum(BODY_SITES),
    side: z.enum(BODY_SIDES),
    // 1 to 300 cm, one decimal (decision 2).
    valueCm: z
      .number()
      .min(1)
      .max(300)
      .transform((v) => Math.round(v * 10) / 10),
    // A real calendar date, so 2026-02-30 never reaches Postgres.
    measuredOn: z.iso.date(),
  })
  .refine((d) => (SIDED_SITES.includes(d.site) ? d.side !== "none" : d.side === "none"), {
    message: "Wrong side for this part",
    path: ["side"],
  });

/** Save one value; a second save on the same date and side replaces it (decision 3). */
export async function saveBodyMeasurement(data: unknown): Promise<ActionResult<MeasurementRow>> {
  const auth = await requireSession();
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const today = toDateStr(await userToday(auth.user.id));
    if (parsed.data.measuredOn > today) return { success: false, error: "The date is in the future" };
    const [row] = await db
      .insert(bodyMeasurements)
      .values({ userId: auth.user.id, ...parsed.data })
      .onConflictDoUpdate({
        target: [bodyMeasurements.userId, bodyMeasurements.site, bodyMeasurements.side, bodyMeasurements.measuredOn],
        set: { valueCm: parsed.data.valueCm },
      })
      .returning(columns);
    revalidatePath("/more/account", "layout");
    return { success: true, data: row };
  } catch (e) {
    console.error("[saveBodyMeasurement] failed", e);
    return { success: false, error: "Failed to save" };
  }
}

const deleteSchema = z.object({ id: z.number().int().positive() });

export async function deleteBodyMeasurement(data: unknown): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const parsed = deleteSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  try {
    const deleted = await db
      .delete(bodyMeasurements)
      .where(and(eq(bodyMeasurements.id, parsed.data.id), eq(bodyMeasurements.userId, auth.user.id)))
      .returning({ id: bodyMeasurements.id });
    if (deleted.length === 0) {
      console.error("[deleteBodyMeasurement] not_found", { id: parsed.data.id });
      return { success: false, error: "Not found" };
    }
    revalidatePath("/more/account", "layout");
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[deleteBodyMeasurement] failed", e);
    return { success: false, error: "Failed to delete" };
  }
}

/** All of the user's values, oldest first. */
export async function getBodyMeasurements(): Promise<ActionResult<MeasurementRow[]>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select(columns)
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, auth.user.id))
      .orderBy(asc(bodyMeasurements.measuredOn), asc(bodyMeasurements.id));
    return { success: true, data: rows };
  } catch (e) {
    console.error("[getBodyMeasurements] failed", e);
    return { success: false, error: "Failed to load measurements" };
  }
}
