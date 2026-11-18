"use server";

/**
 * Step alerts on this device (docs/plans/bike-ride-logger.md, 4.7): save the
 * browser's push subscription for the signed-in user, or delete it.
 */

import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { MAX_DEVICES_PER_USER, pushKeys } from "@/lib/push";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

/**
 * The push services browsers use: Google (Chrome, Edge on Android), Apple
 * (Safari), Mozilla (Firefox) and Microsoft (Edge on Windows). Our server
 * posts to the endpoint, so any other host is refused: no request to an
 * address a user picks.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

function isPushServiceEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname;
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

const endpointSchema = z.string().max(2048).refine(isPushServiceEndpoint, "not a push service address");
const keySchema = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(256);

const saveSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: keySchema, auth: keySchema }),
});

/**
 * Save this device's subscription (`PushSubscription.toJSON()`). The same
 * device signed in as another user moves to this user: an endpoint is one
 * device, and its alerts follow whoever turned them on last. A user keeps at
 * most 10 devices; a new one pushes out the oldest.
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
      .values({ userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, createdAt: new Date() })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth, createdAt: new Date() },
      });
    const keep = db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, auth.user.id))
      .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
      .limit(MAX_DEVICES_PER_USER);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, auth.user.id), notInArray(pushSubscriptions.id, keep)));
    return { success: true, data: { saved: true } };
  } catch {
    console.error("[savePushSubscription] failed");
    return { success: false, error: "Failed to turn on step alerts" };
  }
}

const deleteSchema = z.object({ endpoint: endpointSchema });

/**
 * Delete this device's subscription when it belongs to the caller. An
 * endpoint is unique and moves to whoever saved it last, so when another user
 * turned alerts on later on this device, the row is theirs and stays.
 */
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
