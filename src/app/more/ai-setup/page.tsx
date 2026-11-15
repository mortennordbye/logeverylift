import { AiSetupClient } from "@/components/features/AiSetupClient";
import { loadAiSetupData } from "@/lib/ai-setup-data";
import { getRevision } from "@/lib/actions/ai-checkin";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

type Props = {
  /** `revise`: an AI Setup plan answered "doesn't fit" at its check-in. */
  searchParams: Promise<{ revise?: string }>;
};

/** The plan builder, under the AI coach hub (docs/plans/ai-coach-hub.md). */
export default async function AiSetupPage({ searchParams }: Props) {
  const session = await requireSession();
  const data = await loadAiSetupData(session.user.id);

  const reviseId = Number((await searchParams).revise);
  const revisionResult = reviseId ? await getRevision(reviseId) : null;
  const revision = revisionResult?.success ? revisionResult.data : null;

  return (
    <div className="h-[100dvh] bg-background overflow-y-auto">
      <div
        className="flex flex-col"
        style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))", paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px) + var(--kb-height, 0px))" }}
      >
        <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
          <BackLink fallback={{ href: "/more/ai-coach", label: "AI coach" }} />
        </div>
        <div className="px-4 pt-2 pb-4 shrink-0">
          <h1 className="text-3xl font-bold tracking-tight">Your plan</h1>
          <p className="text-sm text-muted-foreground mt-1">Four questions. You can change all of it later.</p>
        </div>
        <AiSetupClient
          exercises={data.exercises}
          userProfile={data.userProfile}
          prs={data.prs}
          existingProgramNames={data.existingProgramNames}
          revision={revision}
          isAdmin={(session.user as { role?: string }).role === "admin"}
          aiConsented={data.aiConsented}
        />
      </div>
    </div>
  );
}
