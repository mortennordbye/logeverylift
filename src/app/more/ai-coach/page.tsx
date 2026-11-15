import { AiCoachHubClient } from "@/components/features/AiCoachHubClient";
import { db } from "@/db";
import { oauthClients, oauthConsents } from "@/db/schema";
import { getPendingCheckin } from "@/lib/actions/ai-checkin";
import { getCoachMemory } from "@/lib/actions/coach-memory";
import { getAssistantChanges } from "@/lib/actions/plan-revisions";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { accessFromScopes } from "@/lib/mcp/scopes";
import { getUserSettings } from "@/lib/user-settings";
import { lastChangeLines } from "@/lib/utils/coach-hub";
import { shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";
import { desc, eq } from "drizzle-orm";

import { BackLink } from "@/components/ui/BackLink";

const WEEK_MS = 7 * 86_400_000;

/**
 * The AI coach hub (docs/plans/ai-coach-hub.md): the plan, the check-in, what
 * the coach knows, and, once the user connects their own AI, what it changed.
 * Parts draw from the user's data; there is no mode switch.
 */
export default async function AiCoachPage() {
  const auth = await requireSession();
  const [cycleResult, checkinResult, memoryResult, changesResult, consents, { timeZone }] = await Promise.all([
    getActiveCycleForUser(),
    getPendingCheckin(),
    getCoachMemory(),
    getAssistantChanges(),
    db
      .select({ id: oauthConsents.id, name: oauthClients.name, scopes: oauthConsents.scopes })
      .from(oauthConsents)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
      .where(eq(oauthConsents.userId, auth.user.id))
      .orderBy(desc(oauthConsents.createdAt)),
    getUserSettings(auth.user.id),
  ]);

  const info = cycleResult.success ? cycleResult.data : null;
  const changes = changesResult.success ? changesResult.data : [];
  const last = changes[0] ?? null;
  // eslint-disable-next-line react-hooks/purity -- a server render, once per request
  const now = Date.now();

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
      </div>
      <div className="px-4 pt-2 pb-2 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">AI coach</h1>
      </div>
      <AiCoachHubClient
        plan={
          info
            ? {
                cycleId: info.cycle.id,
                name: info.cycle.name,
                week: Math.min(info.currentWeek, info.cycle.durationWeeks),
                weeks: info.cycle.durationWeeks,
                weekdays:
                  info.cycle.scheduleType === "day_of_week"
                    ? [...new Set(info.cycle.slots.map((s) => s.dayOfWeek).filter((d): d is number => d !== null))]
                    : null,
              }
            : null
        }
        checkin={checkinResult.success ? checkinResult.data : null}
        memoryCount={memoryResult.success ? memoryResult.data.entries.filter((e) => e.active).length : 0}
        assistants={consents.map((c) => ({ id: c.id, name: c.name ?? "Your assistant", access: accessFromScopes(c.scopes) }))}
        lastChange={
          last
            ? {
                clientName: last.clientName,
                when: shortDateTime(last.firstAt, timeZone),
                lines: lastChangeLines(last.objects),
              }
            : null
        }
        changesThisWeek={changes.filter((c) => now - c.firstAt.getTime() < WEEK_MS).length}
      />
    </div>
  );
}
