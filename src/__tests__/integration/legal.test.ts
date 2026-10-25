import { db } from "@/db";
import { users } from "@/db/schema";
import { acceptTerms, markPolicySeen, setAiConsent } from "@/lib/actions/legal";
import { needsPolicyNotice, needsTermsConsent } from "@/lib/consent";
import { CONSENT_VERSION, LEGAL_VERSION } from "@/lib/constants/legal";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

let userId: string;
const sessionFor = (id: string, impersonatedBy: string | null = null) =>
  ({ user: { id }, session: { impersonatedBy } }) as unknown as Parameters<typeof needsTermsConsent>[0];

async function row() {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u;
}

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
});

describe("acceptTerms", () => {
  it("records the current version and both consents", async () => {
    expect(await needsTermsConsent(sessionFor(userId))).toBe(true);
    expect(await acceptTerms({ version: LEGAL_VERSION, terms: true, healthData: true })).toEqual({
      success: true,
      data: undefined,
    });
    const u = await row();
    expect(u.termsVersion).toBe(LEGAL_VERSION);
    expect(u.policySeenVersion).toBe(LEGAL_VERSION);
    expect(u.termsAcceptedAt).not.toBeNull();
    expect(u.healthConsentAt).not.toBeNull();
    expect(await needsTermsConsent(sessionFor(userId))).toBe(false);
  });

  it("refuses without health data consent or for an old version", async () => {
    expect((await acceptTerms({ version: LEGAL_VERSION, terms: true, healthData: false })).success).toBe(false);
    expect((await acceptTerms({ version: "2000-01-01", terms: true, healthData: true })).success).toBe(false);
    expect((await row()).termsVersion).toBeNull();
  });
});

describe("needsTermsConsent", () => {
  it("asks again only when the accepted version is older than CONSENT_VERSION", async () => {
    await db.update(users).set({ termsVersion: CONSENT_VERSION }).where(eq(users.id, userId));
    expect(await needsTermsConsent(sessionFor(userId))).toBe(false);
    await db.update(users).set({ termsVersion: "2000-01-01" }).where(eq(users.id, userId));
    expect(await needsTermsConsent(sessionFor(userId))).toBe(true);
  });

  it("never asks an admin who is viewing the app as the user", async () => {
    expect(await needsTermsConsent(sessionFor(userId, "admin-1"))).toBe(false);
  });
});

describe("policy update notice", () => {
  it("tells a user behind on the policy once, then not after they dismiss it", async () => {
    await db
      .update(users)
      .set({ termsVersion: CONSENT_VERSION, policySeenVersion: "2000-01-01" })
      .where(eq(users.id, userId));
    expect(await needsTermsConsent(sessionFor(userId))).toBe(false);
    expect(await needsPolicyNotice(sessionFor(userId))).toBe(true);
    expect(await markPolicySeen({ version: LEGAL_VERSION })).toEqual({ success: true, data: undefined });
    expect(await needsPolicyNotice(sessionFor(userId))).toBe(false);
    // Dismissing the notice is not accepting the terms.
    expect((await row()).termsVersion).toBe(CONSENT_VERSION);
  });

  it("is never shown to an admin viewing the app as the user", async () => {
    expect(await needsPolicyNotice(sessionFor(userId, "admin-1"))).toBe(false);
  });
});

describe("setAiConsent", () => {
  it("gives and withdraws the AI opt-in", async () => {
    await setAiConsent({ consent: true });
    expect((await row()).aiConsentAt).not.toBeNull();
    await setAiConsent({ consent: false });
    expect((await row()).aiConsentAt).toBeNull();
  });
});
