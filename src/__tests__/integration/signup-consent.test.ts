/**
 * The consent ticked on the sign-up form is stored with the new account, in
 * the request that creates it: open sign-up through the better-auth hook
 * (src/lib/auth.ts), invite sign-up through registerWithToken. Before, the
 * form sent it in a request of its own after sign-in; when that request failed
 * the account had no consent and home asked again.
 */

import { db } from "@/db";
import { inviteTokens, users } from "@/db/schema";
import { registerWithToken } from "@/lib/actions/invite-tokens";
import { auth } from "@/lib/auth";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";

let ip = 0;
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `10.9.0.${++ip}` }),
}));

const CONSENT = { version: LEGAL_VERSION, terms: true, healthData: true };

async function byEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row;
}

function signUp(email: string, extra: Record<string, unknown> = {}) {
  return auth.api.signUpEmail({
    body: { name: "New Lifter", email, password: "correct-horse-battery", ...extra },
  });
}

describe("open sign-up", () => {
  it("stores the consent with the account", async () => {
    await signUp("a@test.local", { consent: CONSENT });
    const row = await byEmail("a@test.local");
    expect(row.termsVersion).toBe(LEGAL_VERSION);
    expect(row.policySeenVersion).toBe(LEGAL_VERSION);
    expect(row.termsAcceptedAt).toBeInstanceOf(Date);
    expect(row.healthConsentAt).toEqual(row.termsAcceptedAt);
  });

  it("stores nothing without both boxes or for an old version", async () => {
    await signUp("none@test.local");
    await signUp("no-health@test.local", { consent: { ...CONSENT, healthData: false } });
    await signUp("old@test.local", { consent: { ...CONSENT, version: "2000-01-01" } });
    for (const email of ["none@test.local", "no-health@test.local", "old@test.local"]) {
      const row = await byEmail(email);
      expect(row.termsVersion).toBeNull();
      expect(row.healthConsentAt).toBeNull();
    }
  });

  it("refuses the consent columns set directly", async () => {
    await expect(signUp("direct@test.local", { termsVersion: LEGAL_VERSION })).rejects.toThrow();
    expect(await byEmail("direct@test.local")).toBeUndefined();
  });

  it("keeps the consent columns out of what it returns", async () => {
    const result = await signUp("out@test.local", { consent: CONSENT });
    expect(result.user).not.toHaveProperty("termsVersion");
    expect(result.user).not.toHaveProperty("healthConsentAt");
  });
});

describe("invite sign-up (registerWithToken)", () => {
  it("stores the consent with the account", async () => {
    const inviter = await createUser();
    await db.insert(inviteTokens).values({ id: "t1", token: "tok-1", createdBy: inviter.id, maxUses: 1 });

    const result = await registerWithToken("tok-1", "Invited", "inv@test.local", "correct-horse-battery", CONSENT);

    expect(result.success).toBe(true);
    const row = await byEmail("inv@test.local");
    expect(row.invitedById).toBe(inviter.id);
    expect(row.termsVersion).toBe(LEGAL_VERSION);
    expect(row.healthConsentAt).toBeInstanceOf(Date);
  });

  it("stores nothing without both boxes", async () => {
    const inviter = await createUser();
    await db.insert(inviteTokens).values({ id: "t2", token: "tok-2", createdBy: inviter.id, maxUses: 1 });

    await registerWithToken("tok-2", "Invited", "inv2@test.local", "correct-horse-battery", { ...CONSENT, terms: false });

    expect((await byEmail("inv2@test.local")).termsVersion).toBeNull();
  });
});
