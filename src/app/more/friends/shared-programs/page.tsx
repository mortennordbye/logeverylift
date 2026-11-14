import { SharedProgramsClient } from "@/components/features/SharedProgramsClient";
import { getIncomingShares } from "@/lib/actions/program-shares";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

export default async function SharedProgramsPage() {
  await requireSession();

  const sharesResult = await getIncomingShares();

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/friends", label: "Friends" }} />
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Shared Programs</h1>
      </div>

      <SharedProgramsClient
        shares={sharesResult.success ? sharesResult.data : []}
      />
    </div>
  );
}
