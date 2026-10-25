"use server";

import { db } from "@/db";
import { friendships, users } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";

/** Only an account this new can redeem a code, so a leaked link can't add existing users. */
const REDEEM_WINDOW_MS = 60 * 60 * 1000;

const redeemSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/) });

/** This user's share-link code, made on first use. */
export async function getMyFriendCode(): Promise<ActionResult<string>> {
  const auth = await requireSession();
  const me = auth.user.id;
  try {
    // Set only where still null, then read back: two first shares at once
    // both end up with the same code.
    await db
      .update(users)
      .set({ friendCode: randomBytes(9).toString("base64url") })
      .where(and(eq(users.id, me), isNull(users.friendCode)));
    const [row] = await db.select({ code: users.friendCode }).from(users).where(eq(users.id, me));
    if (!row?.code) return { success: false, error: "Failed to create invite link" };
    return { success: true, data: row.code };
  } catch (e) {
    console.error("[getMyFriendCode] failed", e);
    return { success: false, error: "Failed to create invite link" };
  }
}

/**
 * Send the person whose link a new account signed up through a friend
 * request from it, for them to accept. Runs
 * right after sign-up; an unknown code, the user's own code, an account older
 * than REDEEM_WINDOW_MS or an existing friendship (any status) is a no-op.
 */
export async function redeemFriendCode(data: unknown): Promise<ActionResult<{ connected: boolean }>> {
  const auth = await requireSession();
  const parsed = redeemSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  const me = auth.user.id;

  try {
    const [[self], [inviter]] = await Promise.all([
      db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, me)),
      db.select({ id: users.id }).from(users).where(eq(users.friendCode, parsed.data.code)),
    ]);
    if (!self || !inviter || inviter.id === me) return { success: true, data: { connected: false } };
    if (Date.now() - self.createdAt.getTime() > REDEEM_WINDOW_MS) {
      return { success: true, data: { connected: false } };
    }

    // Check and insert under a lock on the pair, so two redeems at once
    // (two tabs, a retried request) can't both insert.
    const connected = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${[me, inviter.id].sort().join(":")}))`);
      const [existing] = await tx
        .select({ id: friendships.id })
        .from(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, me), eq(friendships.addresseeId, inviter.id)),
            and(eq(friendships.requesterId, inviter.id), eq(friendships.addresseeId, me)),
          ),
        )
        .limit(1);
      if (existing) return false;
      // A request for the sharer to approve: a forwarded link must not show a
      // stranger their workouts.
      await tx.insert(friendships).values({ requesterId: me, addresseeId: inviter.id, status: "pending" });
      return true;
    });
    return { success: true, data: { connected } };
  } catch (e) {
    console.error("[redeemFriendCode] failed", e);
    return { success: false, error: "Failed to connect" };
  }
}
