import { db } from "@/db";
import { friendships } from "@/db/schema";
import { getMyFriendCode, redeemFriendCode } from "@/lib/actions/friend-invites";
import { describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

async function codeOf(userId: string) {
  asUser(userId);
  const result = await getMyFriendCode();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function redeemAs(userId: string, code: string) {
  asUser(userId);
  const result = await redeemFriendCode({ code });
  if (!result.success) throw new Error(result.error);
  return result.data.connected;
}

describe("getMyFriendCode", () => {
  it("makes a code once and keeps it", async () => {
    const me = await createUser();
    const first = await codeOf(me.id);
    expect(first).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await codeOf(me.id)).toBe(first);
  });
});

describe("redeemFriendCode", () => {
  it("sends the person whose link a new account used a friend request, once", async () => {
    const inviter = await createUser();
    const code = await codeOf(inviter.id);
    const newcomer = await createUser();

    expect(await redeemAs(newcomer.id, code)).toBe(true);
    expect(await redeemAs(newcomer.id, code)).toBe(false);

    const rows = await db.select().from(friendships);
    expect(rows).toHaveLength(1);
    // A request for the sharer to approve, not a friendship: a forwarded link
    // must not show a stranger their workouts.
    expect(rows[0]).toMatchObject({ requesterId: newcomer.id, addresseeId: inviter.id, status: "pending" });
  });

  it("does nothing for an account older than an hour", async () => {
    const inviter = await createUser();
    const code = await codeOf(inviter.id);
    const old = await createUser({ createdAt: new Date(Date.now() - 2 * 3600_000) });
    expect(await redeemAs(old.id, code)).toBe(false);
  });

  it("does nothing for your own code or an unknown one", async () => {
    const me = await createUser();
    expect(await redeemAs(me.id, await codeOf(me.id))).toBe(false);
    expect(await redeemAs(me.id, "unknown-code")).toBe(false);
    expect(await db.select().from(friendships)).toHaveLength(0);
  });

  it("leaves an existing friendship alone, even a declined one", async () => {
    const inviter = await createUser();
    const code = await codeOf(inviter.id);
    const newcomer = await createUser();
    await db.insert(friendships).values({ requesterId: newcomer.id, addresseeId: inviter.id, status: "declined" });
    expect(await redeemAs(newcomer.id, code)).toBe(false);
  });

  it("sends one request even when redeemed twice at once", async () => {
    const inviter = await createUser();
    const code = await codeOf(inviter.id);
    const newcomer = await createUser();
    asUser(newcomer.id);
    await Promise.all([redeemFriendCode({ code }), redeemFriendCode({ code })]);
    expect(await db.select().from(friendships)).toHaveLength(1);
  });

  it("rejects malformed input", async () => {
    const me = await createUser();
    asUser(me.id);
    expect((await redeemFriendCode({ code: "a b" })).success).toBe(false);
  });
});
