import { SessionDetailClient } from "@/components/features/SessionDetailClient";
import { getSessionDetail } from "@/lib/actions/workout-sets";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const result = await getSessionDetail(Number(sessionId));
  if (!result.success) notFound();
  return <SessionDetailClient detail={result.data} />;
}
