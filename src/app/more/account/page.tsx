import { AccountClient } from "@/components/features/AccountClient";
import { parseUserGoals } from "@/lib/utils/goals";
import { db } from "@/db";
import { gyms } from "@/db/schema/gyms";
import { users } from "@/db/schema/users";
import { garminConnections } from "@/db/schema";
import { getThresholdsData } from "@/lib/actions/athlete-profile";
import { getAthleteProfile, listDeletedInjuries, listInjuries } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { listIllness } from "@/lib/illness";
import { sessionCompliance } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { CONSISTENCY_WEEKS, consistency, mondayOf } from "@/lib/utils/session-compliance";
import { requireSession } from "@/lib/utils/session";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import { eq } from "drizzle-orm";

import { garminAllowed } from "@/lib/garmin/access";
import { BackLink } from "@/components/ui/BackLink";

export default async function AccountPage() {
  const session = await requireSession();
  const userId = session.user.id;
  // The Garmin weight sync switch shows only to a user with a Garmin connection.
  const [user, [garmin], endurance, today, numbers] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    garminAllowed(session.user.role)
      ? db.select({ syncWeight: garminConnections.syncWeight }).from(garminConnections).where(eq(garminConnections.userId, userId))
      : Promise.resolve([]),
    enduranceEnabledFor(userId),
    userToday(userId).then(toDateStr),
    getThresholdsData(),
  ]);
  const monday = mondayOf(today);
  // The athlete rows show only with the endurance switch on (D18).
  const [gym, athlete, injuries, deletedInjuries, illness, sessions] = await Promise.all([
    user?.primaryGymId ? db.query.gyms.findFirst({ where: eq(gyms.id, user.primaryGymId), columns: { name: true } }) : undefined,
    endurance ? getAthleteProfile(userId) : null,
    endurance ? listInjuries(userId) : [],
    endurance ? listDeletedInjuries(userId) : [],
    endurance ? listIllness(userId) : [],
    endurance ? sessionCompliance(userId, addDaysStr(monday, -7 * CONSISTENCY_WEEKS), addDaysStr(monday, 6)) : [],
  ]);
  const weeks = consistency(
    sessions.map((s) => ({ date: s.date, done: s.state === "done", skipped: s.status === "skipped", statusOn: s.statusOn })),
    today,
  );
  const numbersData = numbers.success ? numbers.data : null;

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      </div>
      {!numbers.success && <p className="px-4 text-sm text-destructive">{numbers.error}</p>}

      <AccountClient
        data={{
          name: session.user.name,
          email: session.user.email,
          role: (session.user as { role?: string }).role ?? "user",
          invited: !!user?.invitedById,
          goals: parseUserGoals(user?.goals),
          experienceLevel: user?.experienceLevel ?? null,
          gender: user?.gender ?? null,
          birthYear: user?.birthYear ?? null,
          heightCm: user?.heightCm ?? null,
          weightKg: user?.weightKg ?? null,
          garminWeightSync: garmin ? garmin.syncWeight : null,
          endurance,
          athlete: athlete && {
            enduranceLevel: athlete.enduranceLevel,
            availableDays: athlete.availableDays,
            hoursPerWeek: athlete.hoursPerWeek,
            longestDayMinutes: athlete.longestDayMinutes,
            longDay: athlete.longDay,
            strengthGoal: athlete.strengthGoal,
          },
          interviewDoneOn: athlete?.interviewCompletedAt ? toDateStr(athlete.interviewCompletedAt) : null,
          injuries: injuries.map((i) => ({
            id: i.id,
            area: i.area,
            side: i.side,
            description: i.description,
            avoid: i.avoid,
            status: i.status,
            startedOn: i.startedOn,
            endedOn: i.endedOn,
          })),
          deletedInjuries: deletedInjuries.map((i) => ({ id: i.id, text: i.description, deletedOn: i.deletedAt!.toISOString().slice(0, 10) })),
          illness: illness.map((p) => ({ id: p.id, startedOn: p.startedOn, endedOn: p.endedOn, severity: p.severity, notes: p.notes })),
          consistency: { complete: weeks.completeWeeks, counted: weeks.countedWeeks, thisWeek: weeks.thisWeek },
          thresholds: (numbersData?.thresholds ?? []).map((t) => ({ id: t.id, kind: t.kind, value: t.value, measuredOn: t.measuredOn, source: t.source })),
          deletedThresholds: (numbersData?.deleted ?? []).map((t) => ({
            id: t.id,
            kind: t.kind,
            value: t.value,
            measuredOn: t.measuredOn,
            source: t.source,
            deletedOn: t.deletedAt!.toISOString().slice(0, 10),
          })),
          suggestions: (numbersData?.suggestions ?? []).map((s) => ({ kind: s.kind, value: s.value, basis: s.basis })),
          units: numbersData?.units ?? DEFAULT_UNITS,
          today,
        }}
        showActivityToFriends={user?.showActivityToFriends ?? true}
        aiConsent={!!user?.aiConsentAt}
        primaryGymName={gym?.name ?? null}
      />
    </div>
  );
}
