import { AthleteProfileClient } from "@/components/features/AthleteProfileClient";
import { getAthleteData } from "@/lib/actions/athlete-profile";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

/** The athlete profile (docs/plans/athlete-profile.md, 2.9), behind the endurance switch (D18). */
export default async function AthletePage() {
  const result = await getAthleteData();
  if (result.success && result.data === null) redirect("/more");
  const data = result.success ? result.data : null;
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Athlete profile</h1>
      </div>
      {!result.success && <p className="px-4 text-sm text-destructive">{result.error}</p>}
      <AthleteProfileClient
        profile={data?.profile ?? null}
        injuries={(data?.injuries ?? []).map((i) => ({
          id: i.id,
          area: i.area,
          side: i.side,
          description: i.description,
          avoid: i.avoid,
          status: i.status,
          startedOn: i.startedOn,
          endedOn: i.endedOn,
        }))}
        deletedInjuries={(data?.deletedInjuries ?? []).map((i) => ({
          id: i.id,
          text: i.description,
          deletedOn: i.deletedAt!.toISOString().slice(0, 10),
        }))}
        interviewDone={data?.profile?.interviewCompletedAt != null}
      />
    </div>
  );
}
