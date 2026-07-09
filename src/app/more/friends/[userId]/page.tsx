import { PublicProfileClient } from "@/components/features/PublicProfileClient";
import { db } from "@/db";
import { friendships, nudges, users, workoutSessions } from "@/db/schema";
import { getFriendProfile } from "@/lib/actions/friends";
import { requireSession } from "@/lib/utils/session";
import { and, eq, gt, or } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await requireSession();
  const me = session.user.id;

  if (userId === me) notFound();

  const [targetUser, friendshipRow] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.friendships.findFirst({
      where: or(
        and(eq(friendships.requesterId, me), eq(friendships.addresseeId, userId)),
        and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, me)),
      ),
    }),
  ]);

  if (!targetUser) notFound();

  type FriendshipStatus = "none" | "pending_sent" | "pending_received" | "accepted";
  let friendshipStatus: FriendshipStatus = "none";
  if (friendshipRow) {
    if (friendshipRow.status === "accepted") {
      friendshipStatus = "accepted";
    } else if (friendshipRow.status === "pending") {
      friendshipStatus = friendshipRow.requesterId === me ? "pending_sent" : "pending_received";
    }
  }

  let workedOutToday: boolean | null = null;
  if (friendshipStatus === "accepted" && targetUser.showActivityToFriends) {
    const today = new Date().toISOString().slice(0, 10);
    const ws = await db.query.workoutSessions.findFirst({
      where: and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        eq(workoutSessions.date, today),
      ),
    });
    workedOutToday = !!ws;
  }

  const profileStatsResult =
    friendshipStatus === "accepted" ? await getFriendProfile(userId) : null;

  let alreadyNudged = false;
  if (friendshipStatus === "accepted") {
    // eslint-disable-next-line react-hooks/purity -- async server component; Date.now() is the request-time cutoff
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recentNudge] = await db
      .select({ id: nudges.id })
      .from(nudges)
      .where(and(eq(nudges.fromUserId, me), eq(nudges.toUserId, userId), gt(nudges.createdAt, cutoff)))
      .limit(1);
    alreadyNudged = !!recentNudge;
  }

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/friends" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Friends</span>
        </Link>
      </div>

      <PublicProfileClient
        profile={{
          id: targetUser.id,
          name: targetUser.name,
          image: targetUser.image,
          workedOutToday,
        }}
        friendshipStatus={friendshipStatus}
        friendshipId={friendshipRow?.id ?? null}
        profileStats={profileStatsResult?.success ? profileStatsResult.data : null}
        alreadyNudged={alreadyNudged}
      />
    </div>
  );
}
