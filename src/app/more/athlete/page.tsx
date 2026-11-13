import { AthleteProfileClient } from "@/components/features/AthleteProfileClient";
import { getAthleteData } from "@/lib/actions/athlete-profile";
import { listIllness } from "@/lib/illness";
import { sessionCompliance } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { CONSISTENCY_WEEKS, consistency, mondayOf } from "@/lib/utils/session-compliance";
import { addDaysStr } from "@/lib/utils/seasons";
import { requireSession } from "@/lib/utils/session";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

/** The athlete profile (docs/plans/athlete-profile.md, 2.9), behind the endurance switch (D18). */
export default async function AthletePage() {
  const result = await getAthleteData();
  if (result.success && result.data === null) redirect("/more");
  const data = result.success ? result.data : null;
  const { user } = await requireSession();
  const today = toDateStr(await userToday(user.id));
  // Sick periods and the consistency line (docs/plans/workouts-and-compliance.md, 6.9 and 7).
  const monday = mondayOf(today);
  const [illness, sessions] = await Promise.all([
    listIllness(user.id),
    sessionCompliance(user.id, addDaysStr(monday, -7 * CONSISTENCY_WEEKS), addDaysStr(monday, 6)),
  ]);
  const weeks = consistency(
    sessions.map((s) => ({ date: s.date, done: s.state === "done", skipped: s.status === "skipped", statusOn: s.statusOn })),
    today,
  );
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
        today={today}
        illness={illness.map((p) => ({ id: p.id, startedOn: p.startedOn, endedOn: p.endedOn, severity: p.severity, notes: p.notes }))}
        consistency={{ complete: weeks.completeWeeks, counted: weeks.countedWeeks, thisWeek: weeks.thisWeek }}
      />
    </div>
  );
}
