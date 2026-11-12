/**
 * One Garmin activity in depth (docs/plans/garmin-insights-design.md, 3.6).
 */

import { GarminActivityView } from "@/components/features/GarminActivityView";
import { getActivityDetail } from "@/lib/garmin/queries";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";
import { garminAllowed } from "@/lib/garmin/access";

export default async function GarminActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!garminAllowed(auth.user.role)) notFound();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const detail = await getActivityDetail(auth.user.id, id);
  if (!detail) notFound();
  return <GarminActivityView d={detail} />;
}
