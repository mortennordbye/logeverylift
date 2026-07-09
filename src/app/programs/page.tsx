/**
 * Programs Page
 *
 * Lists all of the user's workout programs.
 * Programs can be tapped to see their exercises, or a new one can be created.
 * In edit mode, programs can be deleted from the list.
 */

import { ProgramListClient } from "@/components/features/ProgramListClient";
import { getPrograms } from "@/lib/actions/programs";
import { requireSession } from "@/lib/utils/session";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  await requireSession();
  const programResult = await getPrograms();
  const programList = programResult.success ? programResult.data : [];

  return (
    <div className="h-[100dvh] bg-background overflow-y-auto pb-nav-safe">
      <div style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))" }}>
        <ProgramListClient programs={programList} />
      </div>
    </div>
  );
}
