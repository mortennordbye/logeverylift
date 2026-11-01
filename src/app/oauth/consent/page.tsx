import { OAuthConsentForm } from "@/components/features/OAuthConsentForm";
import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/utils/session";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";

/**
 * Where the OAuth provider sends a signed-in user to approve an MCP client
 * (an AI assistant) before it gets a token for /api/mcp. The query is signed
 * by Better Auth; anything else is refused rather than shown.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }

  const { secret } = await auth.$context;
  const clientId = query.get("client_id");
  const valid = clientId !== null && (await verifyOAuthQueryParams(query.toString(), secret));
  const [client] = valid
    ? await db.select({ name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.clientId, clientId))
    : [];

  return (
    <div className="h-[100dvh] overflow-y-auto bg-background">
      <div className="mx-auto max-w-md px-6 pt-16 pb-16 flex flex-col gap-6">
        {client ? (
          <>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Connect {client.name ?? "an AI assistant"}?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                It will be able to read and change your programs, training cycles, profile and body weight
                in LogEveryLift.
              </p>
            </div>
            <OAuthConsentForm />
          </>
        ) : (
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Link expired</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This connection request is no longer valid. Start connecting again from your AI assistant.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
