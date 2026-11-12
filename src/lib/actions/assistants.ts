"use server";

import { db } from "@/db";
import { oauthAccessTokens, oauthConsents, oauthRefreshTokens } from "@/db/schema";
import { ForbiddenError, assertOwner, requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const disconnectSchema = z.object({ id: z.string().min(1) });

/**
 * Disconnect an AI assistant (More → Connected assistants). Deletes the user's
 * consent for that client and revokes its refresh and opaque access tokens.
 * The JWT access token the assistant still holds then fails the consent check
 * on its next MCP request (src/lib/mcp/access.ts). The client row stays: a
 * dynamically registered client has no owner and other users may use it.
 */
export async function disconnectAssistant(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = disconnectSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await db.transaction(async (tx) => {
      const [consent] = await tx
        .select({ userId: oauthConsents.userId, clientId: oauthConsents.clientId })
        .from(oauthConsents)
        .where(eq(oauthConsents.id, parsed.data.id));
      assertOwner(consent && { ...consent, userId: consent.userId ?? "" }, auth.user.id);

      const now = new Date();
      await tx
        .delete(oauthConsents)
        .where(and(eq(oauthConsents.userId, auth.user.id), eq(oauthConsents.clientId, consent.clientId)));
      await tx
        .update(oauthRefreshTokens)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthRefreshTokens.userId, auth.user.id),
            eq(oauthRefreshTokens.clientId, consent.clientId),
            isNull(oauthRefreshTokens.revoked),
          ),
        );
      await tx
        .update(oauthAccessTokens)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthAccessTokens.userId, auth.user.id),
            eq(oauthAccessTokens.clientId, consent.clientId),
            isNull(oauthAccessTokens.revoked),
          ),
        );
    });
    revalidatePath("/more/assistants");
    return { success: true, data: null };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[disconnectAssistant] failed", { id: parsed.data.id });
    return { success: false, error: "Failed to disconnect" };
  }
}
