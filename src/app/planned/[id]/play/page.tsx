import { GuidedPlayer } from "@/components/features/guided/GuidedPlayer";
import { enduranceEnabledFor } from "@/lib/endurance";
import { plannedSessionView } from "@/lib/planned-view";
import { requireSession } from "@/lib/utils/session";
import { notFound, redirect } from "next/navigation";

/**
 * The guided player (docs/plans/endurance-app.md, 3). One server render loads
 * the workout, the resolved targets and the units; after that the player
 * needs no network. A bike-only program goes to ride mode instead (D14).
 */
export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const v = await plannedSessionView(user.id, id);
  if (!v) notFound();
  // D14 (docs/plans/bike-ride-logger.md): a bike-only program rides in ride
  // mode inside its bike exercise. Run, swim and multi-sport keep this player.
  const bike = v.session.sport === "bike" && v.session.programId != null ? v.session.programWorkouts.find((p) => p.sport === "bike") : undefined;
  if (bike) redirect(`/programs/${v.session.programId}/workout/exercises/${bike.programExerciseId}?ride=1&planned=${id}`);
  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <GuidedPlayer session={v.player} />
    </div>
  );
}
