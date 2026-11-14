import { AccountClient } from "@/components/features/AccountClient";
import { parseUserGoals } from "@/lib/utils/goals";
import { db } from "@/db";
import { gyms } from "@/db/schema/gyms";
import { users } from "@/db/schema/users";
import { garminConnections } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

import { garminAllowed } from "@/lib/garmin/access";
import { BackLink } from "@/components/ui/BackLink";

export default async function AccountPage() {
  const session = await requireSession();
  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  // The Garmin weight sync switch shows only to a user with a Garmin connection.
  const [garmin] = garminAllowed(session.user.role)
    ? await db.select({ syncWeight: garminConnections.syncWeight }).from(garminConnections).where(eq(garminConnections.userId, session.user.id))
    : [];
  const gym = user?.primaryGymId
    ? await db.query.gyms.findFirst({ where: eq(gyms.id, user.primaryGymId), columns: { name: true } })
    : undefined;

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      </div>

      <AccountClient
        name={session.user.name}
        email={session.user.email}
        role={(session.user as { role?: string }).role ?? "user"}
        invited={!!user?.invitedById}
        profile={{
          gender: user?.gender ?? null,
          birthYear: user?.birthYear ?? null,
          heightCm: user?.heightCm ?? null,
          weightKg: user?.weightKg ?? null,
          goals: parseUserGoals(user?.goals),
          experienceLevel: user?.experienceLevel ?? null,
        }}
        showActivityToFriends={user?.showActivityToFriends ?? true}
        aiConsent={!!user?.aiConsentAt}
        primaryGymName={gym?.name ?? null}
        garminWeightSync={garmin ? garmin.syncWeight : null}
      />
    </div>
  );
}
