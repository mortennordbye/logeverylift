import { db } from "@/db";
import { users } from "@/db/schema";
import { acceptTerms, setAiConsent } from "@/lib/actions/legal";
import { needsTermsConsent } from "@/lib/consent";
import { LEGAL_VERSION } from "@/lib/constants/legal";
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
  it("never asks an admin who is viewing the app as the user", async () => {
    expect(await needsTermsConsent(sessionFor(userId, "admin-1"))).toBe(false);
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
