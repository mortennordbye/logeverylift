import { HistoryClient } from "@/components/features/HistoryClient";
import { getCompletedSessions } from "@/lib/actions/workout-sets";
import { requireSession } from "@/lib/utils/session";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  await requireSession();
  const result = await getCompletedSessions();
  const sessions = result.success ? result.data : [];
  return <HistoryClient sessions={sessions} />;
}
