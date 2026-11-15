import { WorkoutEditor } from "@/components/features/workout-editor/WorkoutEditor";
import { editorNumbers, sessionForEditor } from "@/components/features/workout-editor/load";
import { BackLink } from "@/components/ui/BackLink";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { notFound, redirect } from "next/navigation";

/** Edit one dated session's workout (docs/plans/bike-sessions.md, 5.3). */
export default async function EditPlannedWorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [s, numbers] = await Promise.all([sessionForEditor(user.id, id), editorNumbers(user.id)]);
  if (!s) notFound();
  const back = { href: `/planned/${id}`, label: "Session" };
  if (!s.open) {
    return (
      <div className="h-[100dvh] bg-background flex flex-col gap-3 px-4 pt-6">
        <BackLink fallback={back} />
        <h1 className="text-2xl font-bold tracking-tight">Edit workout</h1>
        <p className="text-[15px] text-muted-foreground" role="status">
          {s.why}
        </p>
      </div>
    );
  }
  return (
    <WorkoutEditor
      initial={s.workout}
      numbers={numbers}
      context={{ kind: "session", sessionId: id, libraryId: s.libraryId, date: s.date }}
      title="Edit workout"
      back={back}
    />
  );
}
