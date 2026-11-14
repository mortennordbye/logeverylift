import { CoachMemoryClient } from "@/components/features/CoachMemoryClient";
import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import { getCoachMemory } from "@/lib/actions/coach-memory";
import { inArray } from "drizzle-orm";

import { BackLink } from "@/components/ui/BackLink";

/** Coach memory (docs/plans/ai-coach.md, 2.7): what the user's assistant keeps between conversations. */
export default async function CoachMemoryPage() {
  const result = await getCoachMemory();
  const entries = result.success ? result.data.entries : [];
  const deleted = result.success ? result.data.deleted : [];
  const clientIds = [...new Set(entries.map((e) => e.lastClientId).filter((id): id is string => !!id))];
  const names = clientIds.length
    ? new Map(
        (
          await db
            .select({ clientId: oauthClients.clientId, name: oauthClients.name })
            .from(oauthClients)
            .where(inArray(oauthClients.clientId, clientIds))
        ).map((c) => [c.clientId, c.name ?? "Your assistant"]),
      )
    : new Map<string, string>();

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/assistants", label: "Connected assistants" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Coach memory</h1>
      </div>
      <CoachMemoryClient
        entries={entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          text: e.text,
          date: e.entryDate,
          active: e.active,
          by: e.lastWriter === "assistant" ? (e.lastClientId && names.get(e.lastClientId)) || "Your assistant" : "You",
        }))}
        deleted={deleted.map((e) => ({ id: e.id, text: e.text, deletedOn: e.deletedAt!.toISOString().slice(0, 10) }))}
      />
    </div>
  );
}
