import { HOME_UI } from "@/components/features/home/fonts";
import { PlanItemDeleted } from "@/components/features/PlanItemDeleted";
import { SeasonForm } from "@/components/features/SeasonForm";
import { getSeasonDetail } from "@/lib/seasons";
import { ownDeletedSeason } from "@/lib/plan-deleted";
import { requireSession } from "@/lib/utils/session";

import { notFound } from "next/navigation";

/** Edit a season's name, goal, dates and next goal; delete it at the bottom. */
export default async function EditSeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isInteger(seasonId) || seasonId <= 0) notFound();
  const auth = await requireSession();
  const detail = await getSeasonDetail(auth.user.id, seasonId);
  // Delete season renders this page again in its response.
  const deleted = detail ? null : await ownDeletedSeason(auth.user.id, seasonId);
  if (deleted) return <PlanItemDeleted item={deleted} />;
  if (!detail) notFound();
  const s = detail.season;
  return (
    <div className={`${HOME_UI} h-[100dvh] overflow-y-auto bg-home`}>
      <SeasonForm initial={{ id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, nextGoal: s.nextGoal }} />
    </div>
  );
}
