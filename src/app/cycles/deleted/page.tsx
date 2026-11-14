import { HOME_UI } from "@/components/features/home/fonts";
import { RecentlyDeletedList, type DeletedRow } from "@/components/features/RecentlyDeleted";
import { BackLink } from "@/components/ui/BackLink";
import { db } from "@/db";
import { seasons, trainingCycles } from "@/db/schema";
import { getDeletedPlans } from "@/lib/actions/plan-revisions";
import { getUserSettings } from "@/lib/user-settings";
import { dayMonth } from "@/lib/utils/plan-list";
import { requireSession } from "@/lib/utils/session";
import { localDateStr } from "@/lib/utils/user-date";
import { and, eq, inArray } from "drizzle-orm";

/** Recently deleted cycles, phases and seasons of the Plan tab (J7_RecentlyDeleted). */
export default async function PlanRecentlyDeletedPage() {
  const session = await requireSession();
  const userId = session.user.id;
  const [cyclesResult, seasonsResult, { timeZone }] = await Promise.all([
    getDeletedPlans({ type: "cycle" }),
    getDeletedPlans({ type: "season" }),
    getUserSettings(userId),
  ]);
  const deletedCycles = cyclesResult.success ? cyclesResult.data : [];
  const deletedSeasons = seasonsResult.success ? seasonsResult.data : [];

  // A deleted phase keeps its season id: name the season it was a phase of.
  const ids = deletedCycles.map((c) => c.id);
  const phaseOf = new Map<number, string>();
  if (ids.length) {
    const phases = await db
      // plan-read: includes deleted (deleted cycles, and the season of each, live or not)
      .select({ id: trainingCycles.id, season: seasons.name })
      .from(trainingCycles)
      .innerJoin(seasons, eq(seasons.id, trainingCycles.seasonId))
      .where(and(eq(trainingCycles.userId, userId), inArray(trainingCycles.id, ids)));
    for (const r of phases) phaseOf.set(r.id, r.season);
  }

  const deletedOn = (at: Date) => `deleted ${dayMonth(localDateStr(at, timeZone))}`;
  const items: (DeletedRow & { at: number })[] = [
    ...deletedCycles.map((c) => ({
      key: `cycle-${c.id}`,
      name: c.name,
      sub: `${phaseOf.has(c.id) ? `Phase of ${phaseOf.get(c.id)}` : "Cycle"} · ${deletedOn(c.deletedAt)}`,
      revisionId: c.revisionId,
      at: c.deletedAt.getTime(),
    })),
    ...deletedSeasons.map((s) => ({
      key: `season-${s.id}`,
      name: s.name,
      sub: `Season · ${deletedOn(s.deletedAt)}`,
      revisionId: s.revisionId,
      at: s.deletedAt.getTime(),
    })),
  ].sort((a, b) => b.at - a.at);
  const rows: DeletedRow[] = items.map((i) => ({ key: i.key, name: i.name, sub: i.sub, revisionId: i.revisionId }));

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      <header className="flex items-center px-4 pt-4 shrink-0">
        <BackLink fallback={{ href: "/cycles", label: "Plan" }} />
      </header>
      <div className="flex flex-col gap-4 px-4 pt-2">
        <h1 className="home-display text-[40px] uppercase">Recently deleted</h1>
        <RecentlyDeletedList items={rows} />
        <div aria-hidden className="shrink-0 pb-nav-safe" />
      </div>
    </div>
  );
}
