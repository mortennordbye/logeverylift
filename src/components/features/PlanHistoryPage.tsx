import { PlanHistoryClient } from "@/components/features/PlanHistoryClient";
import { getPlanHistory } from "@/lib/actions/plan-revisions";
import { getUserSettings } from "@/lib/user-settings";
import { shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

/** The shared server half of the program and cycle history pages. */
export async function PlanHistoryPage({ type, id }: { type: "program" | "cycle"; id: number }) {
  if (!Number.isInteger(id) || id <= 0) notFound();
  const auth = await requireSession();
  const [result, { timeZone }] = await Promise.all([getPlanHistory({ type, id }), getUserSettings(auth.user.id)]);
  if (!result.success) notFound();
  const { name, deleted, revisions } = result.data;
  const list = type === "program" ? "/programs" : "/cycles";
  const back = deleted ? list : `${list}/${id}`;

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href={back} className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium truncate max-w-[60vw]">
            {deleted ? (type === "program" ? "Programs" : "Cycles") : name}
          </span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        {deleted && (
          <p className="text-sm text-muted-foreground mt-1">
            “{name}” is deleted. Restore a version to bring it back.
          </p>
        )}
      </div>
      <PlanHistoryClient
        kind={type}
        rows={revisions.map((r) => ({
          id: r.id,
          action: r.action,
          writer: r.writer,
          clientName: r.clientName,
          reason: r.reason,
          when: shortDateTime(r.createdAt, timeZone),
          changes: r.changes,
        }))}
      />
    </div>
  );
}
