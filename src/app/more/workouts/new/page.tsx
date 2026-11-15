import { WorkoutEditor } from "@/components/features/workout-editor/WorkoutEditor";
import { editorNumbers } from "@/components/features/workout-editor/load";
import { enduranceEnabledFor } from "@/lib/endurance";
import { emptyWorkout } from "@/lib/utils/workout-edit";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { requireSession } from "@/lib/utils/session";
import { FTP_TEST_TEMPLATE_ID, ftpTestWorkout, templateById } from "@/lib/utils/workout-templates";
import { redirect } from "next/navigation";

/**
 * A new library workout (docs/plans/bike-sessions.md, 5.3). `template` starts
 * from a template (`ftp-test`: the FTP test of 7.3); `cycle` and `date` (from
 * the calendar's Add session) also plan it on that day.
 */
export default async function NewWorkoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/more");
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const template = one("template") ? templateById(one("template")!) : null;
  const start = template ? parseWorkout(template.id === FTP_TEST_TEMPLATE_ID ? ftpTestWorkout() : { v: 1, sport: "bike", name: template.name, steps: template.nodes }) : null;
  const initial = start?.ok ? start.workout : emptyWorkout();
  const cycleId = Number(one("cycle"));
  const date = one("date");
  const plan = Number.isInteger(cycleId) && cycleId > 0 && date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { cycleId, date } : null;
  const back = plan ? { href: "/more/calendar", label: "Calendar" } : { href: "/more/workouts", label: "Workouts" };
  return <WorkoutEditor initial={initial} numbers={await editorNumbers(user.id)} context={{ kind: "new", plan }} title="New workout" back={back} />;
}
