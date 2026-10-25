import { WorkoutReactions } from "@/components/features/WorkoutReactions";
import { getFriendSessionDetail } from "@/lib/actions/friends";
import { formatDateLong, formatDuration } from "@/lib/utils/format";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

const FEELING_EMOJI: Record<string, string> = {
  Tired: "😓",
  OK: "😐",
  Good: "💪",
  Awesome: "🔥",
};

export default async function FriendSessionPage({
  params,
}: {
  params: Promise<{ userId: string; sessionId: string }>;
}) {
  const { userId, sessionId } = await params;
  const result = await getFriendSessionDetail({ sessionId: Number(sessionId) });
  if (!result.success || result.data.ownerId !== userId) notFound();
  const detail = result.data;

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link
          href={`/more/friends/${userId}`}
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">{detail.ownerName}</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <h1 className="text-3xl font-bold tracking-tight">
          {formatDateLong(detail.startTime ?? new Date(detail.date + "T12:00:00"))}
        </h1>
        <p className="text-muted-foreground mt-1">
          {detail.programName ?? "Workout"}
          {detail.durationMinutes > 0 && ` · ${formatDuration(detail.durationMinutes)}`}
          {detail.feeling && ` ${FEELING_EMOJI[detail.feeling] ?? ""}`}
        </p>
        <div data-testid="friend-session-reactions">
          <WorkoutReactions sessionId={detail.sessionId} initialReactions={detail.reactions} />
        </div>

        <div className="mt-6 space-y-6">
          {detail.exercises.map((group, i) => (
            <div key={i}>
              <h2 className="text-base font-semibold mb-2">{group.exerciseName}</h2>
              {group.sets.map((set) => (
                <div key={set.setNumber} className="flex items-center py-2.5 border-b border-border text-sm">
                  <span className="text-muted-foreground w-12">Set {set.setNumber}</span>
                  <span className="font-medium flex-1 text-center">{set.label}</span>
                  <span className="w-12" />
                </div>
              ))}
            </div>
          ))}
          {detail.exercises.length === 0 && (
            <p className="pt-16 text-center text-sm text-muted-foreground">No sets logged for this workout.</p>
          )}
        </div>
      </div>
    </div>
  );
}
