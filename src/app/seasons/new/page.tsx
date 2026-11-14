import { SeasonForm } from "@/components/features/SeasonForm";
import { getUserSettings } from "@/lib/user-settings";
import { localDateStr } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

/** New season (docs/plans/seasons.md, 2.10). For every user (D22). */
export default async function NewSeasonPage() {
  const auth = await requireSession();
  const { timeZone } = await getUserSettings(auth.user.id);
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/cycles", label: "Cycles" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">New season</h1>
      </div>
      <div className="px-4 pb-nav-safe shrink-0" style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))" }}>
        <SeasonForm defaultStart={localDateStr(new Date(), timeZone)} />
      </div>
    </div>
  );
}
