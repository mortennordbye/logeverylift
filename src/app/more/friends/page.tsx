import { FriendsClient } from "@/components/features/FriendsClient";
import {
  getFriends,
  getFriendsActivityFeed,
  getFriendsLeaderboard,
  getPendingRequests,
  getReactionsToMyWorkouts,
  getFriendsReadTime,
  getReceivedNudges,
} from "@/lib/actions/friends";
import { MarkFriendsSeen } from "@/components/features/MarkFriendsSeen";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

export default async function FriendsPage() {
  const session = await requireSession();

  // Taken before the reads: anything arriving after them stays unseen.
  const readAt = await getFriendsReadTime();
  const [friendsResult, pendingResult, feedResult, leaderboardResult, nudgesResult, reactionsResult] =
    await Promise.all([
      getFriends(),
      getPendingRequests(),
      getFriendsActivityFeed(),
      getFriendsLeaderboard(),
      getReceivedNudges(),
      getReactionsToMyWorkouts(),
    ]);
  const allLoaded = [pendingResult, nudgesResult, reactionsResult].every((r) => r.success);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Friends</h1>
      </div>

      {allLoaded && <MarkFriendsSeen at={readAt} />}
      <FriendsClient
        friends={friendsResult.success ? friendsResult.data : []}
        pendingRequests={pendingResult.success ? pendingResult.data : []}
        activityFeed={feedResult.success ? feedResult.data : []}
        leaderboard={leaderboardResult.success ? leaderboardResult.data : []}
        nudges={nudgesResult.success ? nudgesResult.data : []}
        reactions={reactionsResult.success ? reactionsResult.data : []}
        currentUserId={session.user.id}
      />
    </div>
  );
}
