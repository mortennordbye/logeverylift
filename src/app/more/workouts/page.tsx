import { WorkoutsLibraryClient } from "@/components/features/WorkoutsLibraryClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { listWorkouts } from "@/lib/workouts";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * The workouts library (docs/plans/workouts-and-compliance.md, 7), behind the
 * endurance switch (D18). No step editor yet: the assistant creates workouts.
 */
export default async function WorkoutsPage() {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/more");
  const [live, deleted] = await Promise.all([listWorkouts(user.id), listWorkouts(user.id, { deleted: true })]);
  const view = (w: (typeof live)[number]) => ({ id: w.id, name: w.name, sport: w.sport, summary: w.summary });
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Workouts</h1>
      </div>
      <WorkoutsLibraryClient workouts={live.map(view)} deleted={deleted.map(view)} />
    </div>
  );
}
