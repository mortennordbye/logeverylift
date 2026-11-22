import { MoreClient } from "@/components/features/MoreClient";
import { getMyFriendCode } from "@/lib/actions/friend-invites";
import { getFriendsBadgeCount } from "@/lib/actions/friends";
import { requireSession } from "@/lib/utils/session";
import { garminAllowed } from "@/lib/garmin/access";
import { enduranceEnabledFor } from "@/lib/endurance";
import { openProposalCount } from "@/lib/threshold-proposals";

export default async function MorePage() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role ?? "user";
  const [badge, code, endurance, proposals] = await Promise.all([
    getFriendsBadgeCount(),
    getMyFriendCode(),
    enduranceEnabledFor(session.user.id),
    openProposalCount(session.user.id),
  ]);
  return (
    <MoreClient
      role={role}
      friendsBadge={badge.success ? badge.data : 0}
      accountDot={proposals > 0}
      friendCode={code.success ? code.data : null}
      showGarmin={garminAllowed(role)}
      showAthlete={endurance}
    />
  );
}
