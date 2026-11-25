import { db } from "@/db";
import { inviteTokens, users } from "@/db/schema";
import { registerWithToken } from "@/lib/actions/invite-tokens";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";

let ip = 0;
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `10.8.0.${++ip}` }),
}));

beforeEach(async () => {
  const inviter = await createUser();
  await db.insert(inviteTokens).values({ id: "one-use", token: "tok-one", createdBy: inviter.id, maxUses: 1 });
});

async function usedCount() {
  const [row] = await db.select({ usedCount: inviteTokens.usedCount }).from(inviteTokens).where(eq(inviteTokens.id, "one-use"));
  return row.usedCount;
}

describe("registerWithToken", () => {
  it("credits the token's creator as the inviter and counts the use", async () => {
    const result = await registerWithToken("tok-one", "Ada", "ada@test.local", "correct-horse-battery");
    expect(result.success).toBe(true);
    const [token] = await db.select().from(inviteTokens).where(eq(inviteTokens.id, "one-use"));
    const [user] = await db.select({ invitedById: users.invitedById }).from(users).where(eq(users.email, "ada@test.local"));
    expect(user.invitedById).toBe(token.createdBy);
    expect(token.usedCount).toBe(1);
  });

  it("refuses an expired or used-up token without creating an account", async () => {
    await db.update(inviteTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await registerWithToken("tok-one", "Ada", "ada@test.local", "correct-horse-battery")).toEqual({
      success: false,
      error: "This invite token has expired",
    });

    await db.update(inviteTokens).set({ expiresAt: null, usedCount: 1 });
    expect(await registerWithToken("tok-one", "Ada", "ada@test.local", "correct-horse-battery")).toEqual({
      success: false,
      error: "This invite token has already been used",
    });
    expect(await usedCount()).toBe(1);
    expect(await db.select().from(users).where(eq(users.email, "ada@test.local"))).toEqual([]);
  });

  it("creates one account from a one-use token when two sign-ups arrive at once", async () => {
    const results = await Promise.all([
      registerWithToken("tok-one", "First", "first@test.local", "correct-horse-battery"),
      registerWithToken("tok-one", "Second", "second@test.local", "correct-horse-battery"),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await usedCount()).toBe(1);
    const created = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, ["first@test.local", "second@test.local"]));
    expect(created).toHaveLength(1);
  });

  it("gives the use back when the account cannot be created", async () => {
    await createUser({ email: "taken@test.local" });

    const failed = await registerWithToken("tok-one", "Taken", "taken@test.local", "correct-horse-battery");
    expect(failed.success).toBe(false);
    expect(await usedCount()).toBe(0);

    const ok = await registerWithToken("tok-one", "Fresh", "fresh@test.local", "correct-horse-battery");
    expect(ok.success).toBe(true);
    expect(await usedCount()).toBe(1);
  });
});
