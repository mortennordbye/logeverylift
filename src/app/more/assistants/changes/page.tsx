import { AssistantChangesClient } from "@/components/features/AssistantChangesClient";
import { getAssistantChanges } from "@/lib/actions/plan-revisions";
import { getUserSettings } from "@/lib/user-settings";
import { shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

/** What connected assistants changed, by conversation (docs/plans/revisions.md, 2.9). */
export default async function AssistantChangesPage() {
  const auth = await requireSession();
  const [result, { timeZone }] = await Promise.all([getAssistantChanges(), getUserSettings(auth.user.id)]);
  const sets = result.success ? result.data : [];
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/assistants", label: "Connected assistants" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Assistant changes</h1>
      </div>
      <AssistantChangesClient
        sets={sets.map((s) => ({
          changeSetId: s.changeSetId,
          clientName: s.clientName,
          when: shortDateTime(s.firstAt, timeZone),
          reasons: s.reasons,
          overrides: s.overrides,
          objects: s.objects,
        }))}
      />
    </div>
  );
}
