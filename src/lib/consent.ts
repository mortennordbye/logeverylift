import { db } from "@/db";
import { users } from "@/db/schema";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import type { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

/**
 * Whether this signed-in user still has to accept the current terms. Read
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
  return row?.termsVersion !== LEGAL_VERSION;
}
