"use server";

/**
 * Step alerts on this device (docs/plans/bike-ride-logger.md, 4.7): save the
 * browser's push subscription for the signed-in user, or delete it.
 */

import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { pushKeys } from "@/lib/push";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const endpointSchema = z.string().url().startsWith("https://").max(2048);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(256);

const saveSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: keySchema, auth: keySchema }),
});

/**
 * Save this device's subscription (`PushSubscription.toJSON()`). The same
 * device signed in as another user moves to this user: an endpoint is one
 * device, and its alerts follow whoever turned them on last.
 */
export async function savePushSubscription(data: unknown): Promise<ActionResult<{ saved: true }>> {
  const auth = await requireSession();
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!pushKeys()) return { success: false, error: "Step alerts are off on this server" };
  const { endpoint, keys } = parsed.data;

  try {
    await db
      .insert(pushSubscriptions)
      .values({ userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth },
      });
    return { success: true, data: { saved: true } };
  } catch {
    console.error("[savePushSubscription] failed");
    return { success: false, error: "Failed to turn on step alerts" };
  }
}

const deleteSchema = z.object({ endpoint: endpointSchema });

/** Delete the user's subscription of this device. Another user's row with the same endpoint stays. */
export async function deletePushSubscription(data: unknown): Promise<ActionResult<{ deleted: boolean }>> {
  const auth = await requireSession();
  const parsed = deleteSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  try {
    const rows = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, parsed.data.endpoint), eq(pushSubscriptions.userId, auth.user.id)))
      .returning({ id: pushSubscriptions.id });
    return { success: true, data: { deleted: rows.length > 0 } };
  } catch {
    console.error("[deletePushSubscription] failed");
    return { success: false, error: "Failed to turn off step alerts" };
  }
}
