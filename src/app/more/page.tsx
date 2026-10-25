import { MoreClient } from "@/components/features/MoreClient";
import { getFriendsBadgeCount } from "@/lib/actions/friends";
import { requireSession } from "@/lib/utils/session";

export default async function MorePage() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role ?? "user";
  const badge = await getFriendsBadgeCount();
  return <MoreClient role={role} friendsBadge={badge.success ? badge.data : 0} />;
}
