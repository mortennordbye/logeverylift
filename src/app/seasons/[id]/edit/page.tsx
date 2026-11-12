import { SeasonForm } from "@/components/features/SeasonForm";
import { getSeasonDetail } from "@/lib/seasons";
import { requireSession } from "@/lib/utils/session";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

/** Edit a season's name, goal, dates and next goal; delete it at the bottom. */
export default async function EditSeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isInteger(seasonId) || seasonId <= 0) notFound();
  const auth = await requireSession();
  const detail = await getSeasonDetail(auth.user.id, seasonId);
  if (!detail) notFound();
  const s = detail.season;
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href={`/seasons/${s.id}`} className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Edit season</h1>
      </div>
      <div className="px-4 pb-nav-safe shrink-0" style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))" }}>
        <SeasonForm initial={{ id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, nextGoal: s.nextGoal }} />
      </div>
    </div>
  );
}
