/**
 * Resolves what one MCP request may do, from its verified token claims and the
 * user's live consent (src/lib/mcp/scopes.ts explains the rule).
 *
 * The consent check is what makes a disconnect instant: MCP access tokens are
 * JWTs, which the OAuth provider cannot revoke, so the endpoint asks the
 * database on every request whether the user still allows this client.
 */

import { db } from "@/db";
import { oauthConsents } from "@/db/schema";
import { effectiveAccess, type McpAccess } from "@/lib/mcp/scopes";
import { and, eq } from "drizzle-orm";

export type ConnectionAccess =
  | { kind: "ok"; access: McpAccess }
  /** No consent for this client: never given or disconnected. */
  | { kind: "revoked" }
  /** Consent exists, but neither it nor the token grants an mcp scope. */
  | { kind: "no_scope" };

export async function connectionAccess(
  userId: string,
  clientId: string | undefined,
  tokenScope: string | undefined,
): Promise<ConnectionAccess> {
  if (!clientId) return { kind: "revoked" };
  const rows = await db
    .select({ scopes: oauthConsents.scopes })
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)));
  if (rows.length === 0) return { kind: "revoked" };
  const access = effectiveAccess(
    tokenScope,
    rows.flatMap((r) => r.scopes),
  );
  return access ? { kind: "ok", access } : { kind: "no_scope" };
}
