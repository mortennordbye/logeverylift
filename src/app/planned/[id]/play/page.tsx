import { GuidedPlayer } from "@/components/features/guided/GuidedPlayer";
import { getBikeNumbers } from "@/lib/bike-numbers";
import { lastRideAutoLapKm } from "@/lib/bike-session";
import { enduranceEnabledFor } from "@/lib/endurance";
import { plannedSessionView } from "@/lib/planned-view";
import { thresholdValues } from "@/lib/session-compliance";
import { bikeAnchors, recordShort } from "@/lib/utils/bike-view";
import { requireSession } from "@/lib/utils/session";
import { profileBlocks } from "@/lib/utils/workout-profile";
import { notFound, redirect } from "next/navigation";

/**
 * The guided player (docs/plans/endurance-app.md, 3). One server render loads
 * the workout, the resolved targets and the units; after that the player
 * needs no network.
 */
export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const v = await plannedSessionView(user.id, id);
  if (!v) notFound();
  if (v.workout.sport !== "bike") {
    return (
      <div className="h-[100dvh] bg-background flex flex-col">
        <GuidedPlayer session={v.player} />
      </div>
    );
  }
  const [thresholds, numbers, autoLap] = await Promise.all([thresholdValues(user.id), getBikeNumbers(user.id), lastRideAutoLapKm(user.id)]);
  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <GuidedPlayer session={v.player} profile={profileBlocks(v.workout, bikeAnchors(thresholds, numbers), numbers.zones)} record={recordShort(v.workout, autoLap)} />
    </div>
  );
}
