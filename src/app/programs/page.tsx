/**
 * Programs Page
 *
 * Lists all of the user's workout programs.
 * Programs can be tapped to see their exercises, or a new one can be created.
 * In edit mode, programs can be deleted from the list.
 */

import { ProgramListClient } from "@/components/features/ProgramListClient";
import { RecentlyDeleted } from "@/components/features/RecentlyDeleted";
import { getDeletedPlans } from "@/lib/actions/plan-revisions";
import { getPrograms } from "@/lib/actions/programs";
import { getUserSettings } from "@/lib/user-settings";
import { shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";

export default async function ProgramsPage() {
  const auth = await requireSession();
  const [programResult, deletedResult, { timeZone }] = await Promise.all([
    getPrograms(),
    getDeletedPlans({ type: "program" }),
    getUserSettings(auth.user.id),
  ]);
  const programList = programResult.success ? programResult.data : [];
  const deleted = deletedResult.success
    ? deletedResult.data.map((d) => ({ id: d.id, name: d.name, revisionId: d.revisionId, deletedOn: shortDateTime(d.deletedAt, timeZone) }))
    : [];

  return (
    <div className="h-[100dvh] bg-background overflow-y-auto pb-nav-safe">
      <div style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))" }}>
        <ProgramListClient programs={programList} />
        <div className="px-4">
          <RecentlyDeleted kind="program" items={deleted} />
        </div>
      </div>
    </div>
  );
}
