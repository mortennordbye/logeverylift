"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// Both boxes must be ticked: the terms, and explicit consent to health data
// (GDPR Art. 9(2)(a)), which the training log can't work without.
const acceptTermsSchema = z.object({
  version: z.literal(LEGAL_VERSION),
  terms: z.literal(true),
  healthData: z.literal(true),
});

/** Record that the caller accepted the current terms and gave health data consent. */
export async function acceptTerms(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = acceptTermsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Please tick both boxes to continue." };
  }
  try {
    const now = new Date();
    await db
      .update(users)
      .set({ termsVersion: LEGAL_VERSION, termsAcceptedAt: now, healthConsentAt: now })
      .where(eq(users.id, auth.user.id));
    revalidatePath("/");
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[acceptTerms] failed", e);
    return { success: false, error: "Failed to save. Please try again." };
  }
}

const aiConsentSchema = z.object({ consent: z.boolean() });

/** Give or withdraw consent to sending AI Setup requests to outside models. */
export async function setAiConsent(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = aiConsentSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  try {
    await db
      .update(users)
      .set({ aiConsentAt: parsed.data.consent ? new Date() : null })
      .where(eq(users.id, auth.user.id));
    revalidatePath("/more/ai-setup");
    revalidatePath("/more/account");
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[setAiConsent] failed", e);
    return { success: false, error: "Failed to save. Please try again." };
  }
}
