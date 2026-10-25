import { db } from "@/db";
import { users } from "@/db/schema";
import { CONSENT_VERSION, LEGAL_VERSION, legalVersionBefore } from "@/lib/constants/legal";
import type { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

/**
 * Whether this signed-in user still has to accept the terms: they never have,
 * or only a version older than CONSENT_VERSION. Read
 * from the database, not the session, whose cookie cache can be minutes old.
 * An admin viewing the app as someone else is never asked: they must not
 * accept on that person's behalf.
 */
export async function needsTermsConsent(session: Awaited<ReturnType<typeof requireSession>>) {
  if ((session.session as { impersonatedBy?: string | null }).impersonatedBy) return false;
  const [row] = await db
    .select({ termsVersion: users.termsVersion })
    .from(users)
    .where(eq(users.id, session.user.id));
  return !row?.termsVersion || legalVersionBefore(row.termsVersion, CONSENT_VERSION);
}

/**
 * Whether to tell this user, once, that the policy changed since they last saw
 * it. Not shown to an impersonating admin, who must not dismiss it for them.
 */
export async function needsPolicyNotice(session: Awaited<ReturnType<typeof requireSession>>) {
  if ((session.session as { impersonatedBy?: string | null }).impersonatedBy) return false;
  const [row] = await db
    .select({ policySeenVersion: users.policySeenVersion })
    .from(users)
    .where(eq(users.id, session.user.id));
  return row?.policySeenVersion !== LEGAL_VERSION;
}
