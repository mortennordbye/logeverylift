/**
 * registerWithToken credits the token's creator as the new user's inviter
 * (users.invitedById, which drives the "Invited by founder" badge) and counts
 * the token use. Invalid tokens must not create or credit anyone.
 */

import { inviteTokens, users } from "@/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const updates: { table: unknown; values: Record<string, unknown> }[] = [];
const createUser = vi.fn();

vi.mock("@/db", () => ({
  db: {
    query: { inviteTokens: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { createUser: (...a: unknown[]) => createUser(...a) } } }));
// Each test gets its own IP so the per-IP register limit never trips.
let ip = 0;
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `10.0.0.${++ip}` }),
}));

const { registerWithToken } = await import("@/lib/actions/invite-tokens");

const TOKEN = {
  id: "tok1",
  token: "abc",
  createdBy: "founder-id",
  maxUses: null,
  usedCount: 2,
  expiresAt: null,
};

beforeEach(() => {
  findFirst.mockReset();
  createUser.mockReset();
  updates.length = 0;
});

describe("registerWithToken", () => {
  it("records the token creator as inviter and counts the use", async () => {
    findFirst.mockResolvedValue(TOKEN);
    createUser.mockResolvedValue({ user: { id: "new-user" } });

    const result = await registerWithToken("abc", "Ada", "ada@example.com", "password1");

    expect(result.success).toBe(true);
    expect(updates).toEqual([
      { table: users, values: { invitedById: "founder-id" } },
      { table: inviteTokens, values: { usedCount: 3 } },
    ]);
  });

  it("rejects an expired token without creating or crediting a user", async () => {
    findFirst.mockResolvedValue({ ...TOKEN, expiresAt: new Date(Date.now() - 1000) });

    const result = await registerWithToken("abc", "Ada", "ada@example.com", "password1");

    expect(result).toEqual({ success: false, error: "This invite token has expired" });
    expect(createUser).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("rejects a used-up token without creating or crediting a user", async () => {
    findFirst.mockResolvedValue({ ...TOKEN, maxUses: 2 });

    const result = await registerWithToken("abc", "Ada", "ada@example.com", "password1");

    expect(result).toEqual({ success: false, error: "This invite token has already been used" });
    expect(createUser).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});
