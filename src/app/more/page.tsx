import { MoreClient } from "@/components/features/MoreClient";
import { getMyFriendCode } from "@/lib/actions/friend-invites";
import { getFriendsBadgeCount } from "@/lib/actions/friends";
import { requireSession } from "@/lib/utils/session";

export default async function MorePage() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role ?? "user";
  const [badge, code] = await Promise.all([getFriendsBadgeCount(), getMyFriendCode()]);
  return (
    <MoreClient
      role={role}
      friendsBadge={badge.success ? badge.data : 0}
      friendCode={code.success ? code.data : null}
    />
  );
}
