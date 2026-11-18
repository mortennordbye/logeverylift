/**
 * Web push for ride step alerts (docs/plans/bike-ride-logger.md, 4.7; the
 * design is docs/plans/web-push-and-reminders.md, 3a).
 *
 * Push is on only when the three VAPID env vars are set. Then:
 * - every ride event rewrites the ride's `ride_pushes` rows from its timeline
 *   (`scheduleRidePushes`), for a user with at least one device turned on;
 * - a loop started from `src/instrumentation.ts` (`startRidePushLoop`) claims
 *   due rows every 5 s with DELETE … RETURNING, so two pods never send one
 *   row twice, and sends each to the user's devices (`sendDueRidePushes`).
 *
 * The payload holds the alert's title and body, the ride's tag and the link.
 * It is encrypted for the device. The push service sees the device's address,
 * the time, the size, the TTL and urgency headers and the VAPID subject (the
 * operator's contact), never a ride id.
 */

import { db } from "@/db";
import { programExercises, pushSubscriptions, ridePushes, rides } from "@/db/schema";
import type { RideView } from "@/lib/actions/rides";
import { env } from "@/lib/env";
import { getUserSettings } from "@/lib/user-settings";
import { ridePushSchedule, ridePushTag, ridePushUrl, type PushPayload } from "@/lib/utils/ride-pushes";
import { rideTimeline } from "@/lib/utils/ride-timeline";
import { and, eq, inArray, lte } from "drizzle-orm";

type Executor = Pick<typeof db, "select" | "insert" | "delete">;

/** How often the loop looks for due alerts. */
export const RIDE_PUSH_TICK_MS = 5_000;
/** An app on screen sent a heartbeat this recently: it plays its own cue, so no push (4.7). */
export const HEARTBEAT_FRESH_MS = 15_000;
/** An alert this late (the server was down) is dropped: the step it names has moved on. */
export const RIDE_PUSH_STALE_MS = 60_000;
/** Devices per user: a new one past this pushes out the oldest. */
export const MAX_DEVICES_PER_USER = 10;

/** The VAPID keys, or null when push is off. */
export function pushKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** The public key the browser subscribes with; null when push is off. */
export function pushPublicKey(): string | null {
  return pushKeys()?.publicKey ?? null;
}

/**
 * Rewrite a ride's alerts from its timeline at `view.serverNow`. The old rows
 * always go; new ones are written only while push is on and the user has a
 * device turned on.
 */
export async function scheduleRidePushes(ex: Executor, userId: string, view: RideView): Promise<void> {
  await ex.delete(ridePushes).where(eq(ridePushes.rideId, view.ride.id));
  if (!pushKeys()) return;
  const [device] = await ex.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).limit(1);
  if (!device) return;
  const t = rideTimeline(view.plan, view.events, view.serverNow, { heartbeatAt: view.ride.heartbeatAt });
  const { units } = await getUserSettings(userId);
  const rows = ridePushSchedule(view.plan, t, view.serverNow, units);
  if (!rows.length) return;
  await ex.insert(ridePushes).values(rows.map((r) => ({ ...r, rideId: view.ride.id, userId, sendAt: new Date(r.sendAt) })));
}

type WebPushError = { statusCode?: number };

/**
 * Claim the alerts that are due and send them. Of several due alerts of one
 * ride only the latest goes (they share one tag, so it would replace the
 * others at once). An alert is dropped when the ride's app sent a heartbeat
 * in the last 15 s, or when it is more than a minute late. A device whose
 * push service answers 404 or 410 has gone and is deleted.
 */
export async function sendDueRidePushes(now = Date.now()): Promise<{ claimed: number; sent: number; skipped: number; gone: number }> {
  const keys = pushKeys();
  const result = { claimed: 0, sent: 0, skipped: 0, gone: 0 };
  if (!keys) return result;
  const due = await db.delete(ridePushes).where(lte(ridePushes.sendAt, new Date(now))).returning();
  result.claimed = due.length;
  if (!due.length) return result;

  const latest = new Map<number, (typeof due)[number]>();
  for (const row of due) {
    const seen = latest.get(row.rideId);
    if (!seen || row.sendAt > seen.sendAt || (row.sendAt.getTime() === seen.sendAt.getTime() && row.id > seen.id)) latest.set(row.rideId, row);
  }
  result.skipped = due.length - latest.size;

  const webpush = (await import("web-push")).default;
  const rideRows = await db
    .select({ id: rides.id, userId: rides.userId, heartbeatAt: rides.heartbeatAt, programExerciseId: rides.programExerciseId, programId: programExercises.programId })
    // plan-read: includes deleted (the link of a running ride stays, as the ride's plan is frozen)
    .from(rides)
    .leftJoin(programExercises, eq(programExercises.id, rides.programExerciseId))
    .where(inArray(rides.id, [...latest.keys()]));
  const rideById = new Map(rideRows.map((r) => [r.id, r]));

  for (const row of latest.values()) {
    const ride = rideById.get(row.rideId);
    const fresh = ride?.heartbeatAt && now - ride.heartbeatAt.getTime() < HEARTBEAT_FRESH_MS;
    if (!ride || ride.userId !== row.userId || fresh || now - row.sendAt.getTime() > RIDE_PUSH_STALE_MS) {
      result.skipped++;
      continue;
    }
    const payload: PushPayload = {
      title: row.title,
      body: row.body,
      tag: ridePushTag(ride.id),
      url: ride.programId !== null && ride.programExerciseId !== null ? ridePushUrl(ride.programId, ride.programExerciseId) : "/",
    };
    const devices = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, row.userId));
    for (const d of devices) {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(payload), {
          vapidDetails: keys,
          // A step alert is worth nothing a minute late. No Topic header: it would show the push service the ride id.
          TTL: 60,
          urgency: "high",
          // A push service that does not answer must not hold the loop (web-push sets no timeout of its own).
          timeout: 10_000,
        });
        result.sent++;
        await db.update(pushSubscriptions).set({ lastUsedAt: new Date(now) }).where(eq(pushSubscriptions.id, d.id));
      } catch (e) {
        const status = (e as WebPushError)?.statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, d.id), eq(pushSubscriptions.endpoint, d.endpoint)));
          result.gone++;
        } else {
          console.error("[ridePush] send failed", { rideId: ride.id, subscriptionId: d.id, status: status ?? null });
        }
      }
    }
  }
  return result;
}

/**
 * One run of the loop: never two at once, and a run that throws or times out
 * is logged and lets the next run go.
 */
export function ridePushTick(send: () => Promise<unknown> = () => sendDueRidePushes()): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await send();
    } catch (e) {
      console.error("[ridePush] loop failed", e instanceof Error ? e.message : "unknown");
    } finally {
      running = false;
    }
  };
}

/** Start the send loop: every 5 s. Null when push is off, so no loop runs. */
export function startRidePushLoop(): ReturnType<typeof setInterval> | null {
  if (!pushKeys()) return null;
  const tick = ridePushTick();
  const id = setInterval(() => void tick(), RIDE_PUSH_TICK_MS);
  id.unref?.();
  return id;
}
