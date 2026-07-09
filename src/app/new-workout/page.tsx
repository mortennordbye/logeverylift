/**
 * New Workout Page
 *
 * Program picker shown when starting a new workout from the home screen.
 * If the user has an active training cycle with a program scheduled for today,
 * a cycle card is shown at the top with quick Start / Skip / Different program actions.
 */

import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { getPrograms } from "@/lib/actions/programs";
import NewWorkoutClient from "@/components/features/NewWorkoutClient";
import { requireSession } from "@/lib/utils/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewWorkoutPage() {
  await requireSession();
  const [cycleResult, programsResult] = await Promise.all([
    getActiveCycleForUser(),
    getPrograms(),
  ]);

  const activeCycleInfo = cycleResult.success ? cycleResult.data : null;
  const programs = programsResult.success ? programsResult.data : [];

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <Link href="/" className="text-primary text-sm font-medium">
          &lt; Home
        </Link>
        <span className="w-16" />
      </div>

      {/* Title */}
      <div className="px-4 pt-2 pb-6 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">New Workout</h1>
      </div>

      <NewWorkoutClient activeCycleInfo={activeCycleInfo} programs={programs} />
    </div>
  );
}
