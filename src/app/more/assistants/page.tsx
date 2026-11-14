import { AssistantsClient } from "@/components/features/AssistantsClient";
import { db } from "@/db";
import { oauthClients, oauthConsents } from "@/db/schema";
import { accessFromScopes } from "@/lib/mcp/scopes";
import { requireSession } from "@/lib/utils/session";
import { desc, eq } from "drizzle-orm";

import { BackLink } from "@/components/ui/BackLink";

/** The AI assistants the user has connected over MCP, with a way to disconnect each. */
export default async function AssistantsPage() {
  const auth = await requireSession();
  const rows = await db
    .select({
      id: oauthConsents.id,
      name: oauthClients.name,
      scopes: oauthConsents.scopes,
      createdAt: oauthConsents.createdAt,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(eq(oauthConsents.userId, auth.user.id))
    .orderBy(desc(oauthConsents.createdAt));

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Connected assistants</h1>
      </div>
      <AssistantsClient
        assistants={rows.map((r) => ({
          id: r.id,
          name: r.name,
          access: accessFromScopes(r.scopes),
          connectedAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
