import { HOME_UI } from "@/components/features/home/fonts";
import { PlanHistoryClient } from "@/components/features/PlanHistoryClient";
import { limitOverrideLine } from "@/lib/utils/training-limits";
import { getPlanHistory } from "@/lib/actions/plan-revisions";
import { getUserSettings } from "@/lib/user-settings";
import { shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";

import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

/** The shared server half of the program and cycle history pages. */
export async function PlanHistoryPage({ type, id }: { type: "program" | "cycle" | "season"; id: number }) {
  if (!Number.isInteger(id) || id <= 0) notFound();
  const auth = await requireSession();
  const [result, { timeZone }] = await Promise.all([getPlanHistory({ type, id }), getUserSettings(auth.user.id)]);
  if (!result.success) notFound();
  const { name, deleted, revisions } = result.data;
  const list = type === "program" ? "/programs" : "/cycles";
  const back = deleted ? list : type === "season" ? `/seasons/${id}` : `${list}/${id}`;

  // Cycle and season history are Plan pages: the Plan look and its display title.
  const plan = type !== "program";
  return (
    <div className={`h-[100dvh] pb-nav-safe flex flex-col overflow-hidden ${plan ? `${HOME_UI} bg-home` : "bg-background"}`}>
      <div className={`flex items-center px-4 pb-2 shrink-0 ${plan ? "pt-4" : "pt-6"}`}>
        <BackLink fallback={{ href: back, label: deleted ? (type === "program" ? "Programs" : "Plan") : name }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className={plan ? "home-display text-[34px] leading-9 uppercase" : "text-3xl font-bold tracking-tight"}>Change history</h1>
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
          override: limitOverrideLine(r.limitCheck),
        }))}
      />
    </div>
  );
}
