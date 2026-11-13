import { PoolList, type PoolBlock } from "@/components/features/guided/PoolList";
import { enduranceEnabledFor } from "@/lib/endurance";
import { plannedSessionView } from "@/lib/planned-view";
import { thresholdValues } from "@/lib/session-compliance";
import { requireSession } from "@/lib/utils/session";
import { describeWorkout, resolveTarget, type WorkoutStep } from "@/lib/utils/workout-steps";
import { notFound, redirect } from "next/navigation";

const EQUIPMENT: Record<string, string> = { pull_buoy: "pull buoy", paddles: "paddles", fins: "fins", kickboard: "kickboard", snorkel: "snorkel" };

/**
 * The pool view (docs/plans/endurance-app.md, 4.4): one block per screen in
 * large text, and a send-off clock (the player with the swim layout).
 */
export default async function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [v, anchors] = await Promise.all([plannedSessionView(user.id, id), thresholdValues(user.id)]);
  if (!v) notFound();
  const { workout, units } = v;
  const target = (s: WorkoutStep) => (s.target ? resolveTarget(s.target, workout.sport, anchors, units).text : null);
  const blocks: PoolBlock[] = workout.steps.map((n, i) => {
    const steps = n.type === "repeat" ? n.steps : [n];
    return {
      key: n.id ?? `b${i}`,
      title: describeWorkout({ ...workout, steps: [n] }, units),
      targets: steps.map(target).filter((t): t is string => t !== null),
      extras: [...new Set(steps.flatMap((s) => s.equipment ?? []).map((e) => EQUIPMENT[e] ?? e))],
      notes: steps.map((s) => s.note).filter((t): t is string => !!t),
    };
  });
  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <PoolList plannedSessionId={id} name={workout.name} poolLengthM={workout.poolLengthM ?? null} swimUnit={units.swim} blocks={blocks} />
    </div>
  );
}
