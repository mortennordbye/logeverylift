"use client";

import { respondToFriendRequest, removeFriend } from "@/lib/actions/friends";
import { WorkoutReactions } from "@/components/features/WorkoutReactions";
import type { FriendActivityItem, FriendWithActivity, LeaderboardEntry, PendingRequest, ReceivedNudge } from "@/types/workout";
import { Dumbbell, UserPlus, Users, ChevronRight, Check, X, UserMinus, Gift, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  friends: FriendWithActivity[];
  pendingRequests: PendingRequest[];
  activityFeed: FriendActivityItem[];
  leaderboard: LeaderboardEntry[];
  nudges: ReceivedNudge[];
  currentUserId: string;
}

function Avatar({ name, image, size = 10 }: { name: string; image: string | null; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`w-${size} h-${size} rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar URL from auth provider; not worth wiring next/image loader
        <img src={image} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-sm font-semibold text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

function PendingRequestRow({
  request,
  onAccept,
  onDecline,
  loading,
}: {
  request: PendingRequest;
  onAccept: () => void;
  onDecline: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar name={request.requesterName} image={request.requesterImage} />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{request.requesterName}</p>
        <p className="text-sm text-muted-foreground">Wants to be your friend</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onDecline}
          disabled={loading}
          className="w-9 h-9 rounded-full border border-border flex items-center justify-center active:opacity-70 disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={onAccept}
          disabled={loading}
          className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:opacity-70 disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function FriendRow({
  friend,
  onRemove,
  removing,
}: {
  friend: FriendWithActivity;
  onRemove: () => void;
  removing: boolean;
}) {
  const [showRemove, setShowRemove] = useState(false);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link href={`/more/friends/${friend.userId}`} className="flex-1 flex items-center gap-3 min-w-0">
        <Avatar name={friend.name} image={friend.image} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{friend.name}</p>
            {friend.streak >= 3 && (
              <span className="text-xs font-semibold text-orange-500 shrink-0">
                🔥{friend.streak}
              </span>
            )}
          </div>
          {friend.workedOutToday !== null && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              {friend.workedOutToday ? (
                <>
                  <Dumbbell className="w-3 h-3 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">Worked out today</span>
                </>
              ) : (
                <span>No workout today</span>
              )}
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
      {showRemove ? (
        <button
          onClick={onRemove}
          disabled={removing}
          className="ml-2 text-destructive text-sm active:opacity-70 disabled:opacity-50 shrink-0"
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      ) : (
        <button
          onClick={() => setShowRemove(true)}
          className="ml-2 w-8 h-8 flex items-center justify-center text-muted-foreground active:opacity-70 shrink-0"
        >
          <UserMinus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

const FEELING_EMOJI: Record<string, string> = {
  Tired: "😓",
  OK: "😐",
  Good: "💪",
  Awesome: "🔥",
};

function relativeTimeLabel(isoString: string): string {
  const ago = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
  if (ago < 1) return "just now";
  if (ago < 60) return `${ago}m ago`;
  if (ago < 1440) return `${Math.floor(ago / 60)}h ago`;
  return `${Math.floor(ago / 1440)}d ago`;
}

function relativeDay(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

function formatTime(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ActivityFeedCard({ item }: { item: FriendActivityItem }) {
  const timeLabel = item.startTime
    ? `${relativeDay(item.startTime)}, ${formatTime(item.startTime)}`
    : relativeDay(new Date(item.date));

  return (
    <div className="px-4 py-3">
      <Link
        href={`/more/friends/${item.userId}`}
        className="block active:opacity-70 transition-opacity"
      >
        <div className="flex items-start gap-3">
          <Avatar name={item.name} image={item.image} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="font-medium truncate">{item.name}</p>
                {item.streak >= 2 && (
                  <span className="text-xs font-semibold text-orange-500 shrink-0">🔥{item.streak}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground shrink-0">{timeLabel}</p>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {item.programName ?? "Workout"}
              {item.durationMinutes > 0 && ` · ${item.durationMinutes}min`}
              {item.feeling && ` ${FEELING_EMOJI[item.feeling] ?? ""}`}
            </p>
            {item.prHighlight && (
              <p className="text-xs font-medium text-amber-500 mt-0.5">
                🏆 PR: {item.prHighlight.exerciseName} · {item.prHighlight.value}kg
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {item.exerciseCount} exercise{item.exerciseCount !== 1 ? "s" : ""} · {item.setCount} sets
              {item.totalVolumeKg > 0 && ` · ${Math.round(item.totalVolumeKg).toLocaleString()}kg`}
            </p>
          </div>
        </div>
      </Link>
      <div className="pl-13">
        <WorkoutReactions sessionId={item.sessionId} initialReactions={item.reactions} />
      </div>
    </div>
  );
}

const RANK_MEDAL: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" };

function LeaderboardSection({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length < 2) return null;
  const hasAnyVolume = entries.some((e) => e.totalVolumeKg > 0);

  return (
    <section className="mb-4">
      <div className="flex items-center gap-2 px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          This Week
        </p>
        <Trophy className="w-3.5 h-3.5 text-amber-500" />
      </div>
      <div className="divide-y divide-border border-y border-border">
        {entries.map((entry, i) => (
          <div
            key={entry.userId}
            className={`flex items-center gap-3 px-4 py-3 ${entry.isMe ? "bg-primary/5" : ""}`}
          >
            <span className="w-6 text-center text-sm font-bold shrink-0">
              {RANK_MEDAL[i] !== undefined ? (
                RANK_MEDAL[i]
              ) : (
                <span className="text-muted-foreground">{i + 1}</span>
              )}
            </span>
            <Avatar name={entry.name} image={entry.image} size={9} />
            <div className="flex-1 min-w-0">
              <p className={`font-medium truncate ${entry.isMe ? "text-primary" : ""}`}>
                {entry.isMe ? "You" : entry.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.workoutCount} workout{entry.workoutCount !== 1 ? "s" : ""}
              </p>
            </div>
            {hasAnyVolume && (
              <p className={`text-sm font-semibold shrink-0 tabular-nums ${entry.totalVolumeKg > 0 ? "" : "text-muted-foreground"}`}>
                {entry.totalVolumeKg > 0
                  ? `${Math.round(entry.totalVolumeKg).toLocaleString()}kg`
                  : "—"}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function FriendsClient({ friends, pendingRequests, activityFeed, leaderboard, nudges }: Props) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  async function handleRespond(friendshipId: number, action: "accepted" | "declined") {
    setLoadingId(friendshipId);
    await respondToFriendRequest({ friendshipId, action });
    setLoadingId(null);
    router.refresh();
  }

  async function handleRemove(friendshipId: number) {
    setRemovingId(friendshipId);
    await removeFriend({ friendshipId });
    setRemovingId(null);
    router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Action buttons */}
      <div className="px-4 py-3 flex gap-3">
        <Link
          href="/more/friends/search"
          className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80"
        >
          <UserPlus className="w-4 h-4" />
          Add Friends
        </Link>
        <Link
          href="/more/friends/shared-programs"
          className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border border-border font-medium text-sm active:opacity-70"
        >
          <Gift className="w-4 h-4" />
          Shared Programs
        </Link>
      </div>

      {/* Weekly Leaderboard */}
      <LeaderboardSection entries={leaderboard} />

      {/* Nudges */}
      {nudges.length > 0 && (
        <section className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2">
            Cheering you on
          </p>
          <div className="divide-y divide-border border-y border-border">
            {nudges.map((nudge) => (
              <div key={nudge.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={nudge.fromName} image={nudge.fromImage} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{nudge.fromName} 👊</p>
                  <p className="text-sm text-muted-foreground">is waiting for you to log a workout</p>
                </div>
                <p className="text-xs text-muted-foreground shrink-0">{relativeTimeLabel(nudge.createdAt)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity */}
      {activityFeed.length > 0 && (
        <section className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2">
            Recent Activity
          </p>
          <div className="divide-y divide-border border-y border-border">
            {activityFeed.map((item) => (
              <ActivityFeedCard key={item.sessionId} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <section className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2">
            Friend Requests
          </p>
          <div className="divide-y divide-border border-y border-border">
            {pendingRequests.map((req) => (
              <PendingRequestRow
                key={req.friendshipId}
                request={req}
                loading={loadingId === req.friendshipId}
                onAccept={() => handleRespond(req.friendshipId, "accepted")}
                onDecline={() => handleRespond(req.friendshipId, "declined")}
              />
            ))}
          </div>
        </section>
      )}

      {/* Friends list */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2">
          {friends.length > 0 ? `Friends · ${friends.length}` : "Friends"}
        </p>
        {friends.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center px-8">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <Users className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-medium">No friends yet</p>
            <p className="text-sm text-muted-foreground">Search for people you know to connect and share programs.</p>
          </div>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {friends.map((friend) => (
              <FriendRow
                key={friend.friendshipId}
                friend={friend}
                removing={removingId === friend.friendshipId}
                onRemove={() => handleRemove(friend.friendshipId)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
