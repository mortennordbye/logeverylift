import { MoreClient } from "@/components/features/MoreClient";
import { getMyFriendCode } from "@/lib/actions/friend-invites";
import { getFriendsBadgeCount } from "@/lib/actions/friends";
import { requireSession } from "@/lib/utils/session";
import { garminAllowed } from "@/lib/garmin/access";
import { enduranceEnabledFor } from "@/lib/endurance";

export default async function MorePage() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role ?? "user";
  const [badge, code, endurance] = await Promise.all([getFriendsBadgeCount(), getMyFriendCode(), enduranceEnabledFor(session.user.id)]);
  return (
    <MoreClient
      role={role}
      friendsBadge={badge.success ? badge.data : 0}
      friendCode={code.success ? code.data : null}
      showGarmin={garminAllowed(role)}
      showAthlete={endurance}
    />
  );
}
