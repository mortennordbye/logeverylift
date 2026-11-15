import { OwnAiChatClient } from "@/components/features/OwnAiChatClient";
import { loadAiSetupData } from "@/lib/ai-setup-data";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

/** "Use your own AI chat" under the AI coach hub (docs/plans/ai-coach-hub.md). */
export default async function OwnAiChatPage() {
  const session = await requireSession();
  const data = await loadAiSetupData(session.user.id);
  return (
    <div className="h-[100dvh] bg-background overflow-y-auto">
      <div className="flex flex-col" style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px) + var(--kb-height, 0px))" }}>
        <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
          <BackLink fallback={{ href: "/more/ai-coach", label: "AI coach" }} />
        </div>
        <div className="px-4 pt-2 pb-4 shrink-0">
          <h1 className="text-3xl font-bold tracking-tight">Your own AI chat</h1>
        </div>
        <OwnAiChatClient
          exercises={data.exercises}
          userProfile={data.userProfile}
          prs={data.prs}
          existingProgramNames={data.existingProgramNames}
        />
      </div>
    </div>
  );
}
