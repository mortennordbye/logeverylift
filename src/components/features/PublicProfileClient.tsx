"use client";

import { removeFriend, respondToFriendRequest, sendFriendRequest, sendNudge } from "@/lib/actions/friends";
import type { FriendProfileStats, FriendSessionCard } from "@/types/workout";
import { Check, Dumbbell, Loader2, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FriendshipStatus = "none" | "pending_sent" | "pending_received" | "accepted";

interface Profile {
  id: string;
  name: string;
  image: string | null;
  workedOutToday: boolean | null;
}

interface Props {
  profile: Profile;
  friendshipStatus: FriendshipStatus;
  friendshipId: number | null;
  profileStats: FriendProfileStats | null;
  alreadyNudged?: boolean;
}

const FEELING_EMOJI: Record<string, string> = {
  Tired: "😓",
  OK: "😐",
  Good: "💪",
  Awesome: "🔥",
};

function relativeDay(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

function formatTime(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function streakLabel(streak: number): string {
  if (streak >= 100) return "💯";
  if (streak >= 30) return "🌟";
  if (streak >= 7) return "⚡";
  return "🔥";
}

function SessionRow({ session }: { session: FriendSessionCard }) {
  const timeLabel = session.startTime
    ? `${relativeDay(session.startTime)}, ${formatTime(session.startTime)}`
    : relativeDay(new Date(session.date + "T12:00:00"));

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {session.programName ?? "Workout"}
            {session.feeling && ` ${FEELING_EMOJI[session.feeling] ?? ""}`}
          </p>
          {session.prHighlight && (
            <p className="text-xs font-medium text-amber-500 mt-0.5">
              🏆 PR: {session.prHighlight.exerciseName} · {session.prHighlight.value}kg
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {session.exerciseCount} exercise{session.exerciseCount !== 1 ? "s" : ""} · {session.setCount} sets
            {session.durationMinutes > 0 && ` · ${session.durationMinutes}min`}
            {session.totalVolumeKg > 0 && ` · ${Math.round(session.totalVolumeKg).toLocaleString()}kg`}
          </p>
        </div>
        <p className="text-xs text-muted-foreground shrink-0">{timeLabel}</p>
      </div>
    </div>
  );
}

export function PublicProfileClient({
  profile,
  friendshipStatus: initialStatus,
  friendshipId: initialFriendshipId,
  profileStats,
  alreadyNudged: initialAlreadyNudged = false,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [friendshipId, setFriendshipId] = useState(initialFriendshipId);
  const [loading, setLoading] = useState(false);
  const [nudged, setNudged] = useState(initialAlreadyNudged);
  const [nudging, setNudging] = useState(false);

  const initials = profile.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleAction() {
    setLoading(true);

    if (status === "none") {
      const result = await sendFriendRequest({ addresseeId: profile.id });
      if (result.success) setStatus("pending_sent");
    } else if (status === "pending_sent" && friendshipId) {
      const result = await removeFriend({ friendshipId });
      if (result.success) { setStatus("none"); setFriendshipId(null); }
    } else if (status === "pending_received" && friendshipId) {
      const result = await respondToFriendRequest({ friendshipId, action: "accepted" });
      if (result.success) setStatus("accepted");
    } else if (status === "accepted" && friendshipId) {
      const result = await removeFriend({ friendshipId });
      if (result.success) { setStatus("none"); setFriendshipId(null); }
    }

    setLoading(false);
    router.refresh();
  }

  async function handleNudge() {
    setNudging(true);
    const result = await sendNudge({ toUserId: profile.id });
    if (result.success) setNudged(true);
    setNudging(false);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Profile header */}
      <div className="flex flex-col items-center gap-4 py-8 px-4">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center overflow-hidden">
          {profile.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar URL from auth provider; not worth wiring next/image loader
            <img src={profile.image} alt={profile.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl font-bold text-muted-foreground">{initials}</span>
          )}
        </div>

        <h1 className="text-2xl font-bold tracking-tight">{profile.name}</h1>

        {/* Streak + activity badges */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {profileStats && profileStats.streak >= 2 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 text-sm font-medium">
              <span>{streakLabel(profileStats.streak)}</span>
              <span>{profileStats.streak}-day streak</span>
            </div>
          )}
          {profile.workedOutToday !== null && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                profile.workedOutToday
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Dumbbell className="w-3.5 h-3.5" />
              {profile.workedOutToday ? "Worked out today" : "No workout today"}
            </div>
          )}
        </div>

        {/* Friendship action button */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={`flex items-center gap-2 h-11 px-6 rounded-xl font-medium text-sm active:opacity-80 disabled:opacity-50 ${
            status === "accepted"
              ? "border border-border text-foreground"
              : status === "pending_sent"
              ? "border border-border text-muted-foreground"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status === "accepted" ? (
            <>
              <UserMinus className="w-4 h-4" />
              Remove Friend
            </>
          ) : status === "pending_sent" ? (
            <>
              <UserCheck className="w-4 h-4" />
              Request Sent
            </>
          ) : status === "pending_received" ? (
            <>
              <Check className="w-4 h-4" />
              Accept Request
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              Add Friend
            </>
          )}
        </button>

        {/* Nudge button — only for accepted friends who haven't worked out today */}
        {status === "accepted" && profile.workedOutToday === false && (
          <button
            onClick={handleNudge}
            disabled={nudged || nudging}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl border border-border text-sm font-medium text-muted-foreground active:opacity-70 disabled:opacity-50"
          >
            {nudged ? "Nudged 👊" : nudging ? "Sending…" : "Nudge 👊"}
          </button>
        )}
      </div>

      {/* Stats row */}
      {profileStats && (profileStats.totalWorkouts > 0 || profileStats.thisWeekWorkouts > 0) && (
        <div className="grid grid-cols-3 divide-x divide-border border-y border-border mb-4">
          <div className="flex flex-col items-center py-4 gap-0.5">
            <p className="text-xl font-bold">{profileStats.totalWorkouts}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="flex flex-col items-center py-4 gap-0.5">
            <p className="text-xl font-bold">{profileStats.thisWeekWorkouts}</p>
            <p className="text-xs text-muted-foreground">This week</p>
          </div>
          <div className="flex flex-col items-center py-4 gap-0.5">
            <p className="text-xl font-bold">
              {profileStats.thisWeekVolume > 0
                ? `${Math.round(profileStats.thisWeekVolume / 1000 * 10) / 10}t`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Volume</p>
          </div>
        </div>
      )}

      {/* Recent sessions */}
      {profileStats && profileStats.recentSessions.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2">
            Recent Workouts
          </p>
          <div className="divide-y divide-border border-y border-border">
            {profileStats.recentSessions.map((s) => (
              <SessionRow key={s.sessionId} session={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
