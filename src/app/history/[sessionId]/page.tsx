import { SessionDetailClient } from "@/components/features/SessionDetailClient";
import { getSessionDetail } from "@/lib/actions/workout-sets";
import { enduranceEnabledFor } from "@/lib/endurance";
import { hasSessionCheck } from "@/lib/session-check";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const result = await getSessionDetail(Number(sessionId));
  if (!result.success) notFound();
  // A workout with a ride or run links its step page (docs/plans/session-check.md, decision 7).
  const { user } = await requireSession();
  const check = (await enduranceEnabledFor(user.id)) && (await hasSessionCheck(user.id, Number(sessionId)));
  return <SessionDetailClient detail={result.data} checkHref={check ? `/history/${sessionId}/check` : null} />;
}
