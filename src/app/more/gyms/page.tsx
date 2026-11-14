import { GymMapClient } from "@/components/features/GymMapClient";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getGymMap } from "@/lib/actions/gyms";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";

export default async function GymMapPage() {
  const session = await requireSession();
  const [pinsResult, [me]] = await Promise.all([
    getGymMap(),
    db.select({ gymId: users.primaryGymId }).from(users).where(eq(users.id, session.user.id)),
  ]);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
        {me?.gymId != null && (
          <Link href="/more/account/gym" className="text-sm font-medium text-primary active:opacity-70 min-h-[44px] flex items-center">
            My gym
          </Link>
        )}
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Gyms</h1>
        <p className="text-sm text-muted-foreground mt-1">Where people on LogEveryLift train. Tap a gym to see who.</p>
      </div>
      <GymMapClient pins={pinsResult.success ? pinsResult.data : []} myGymId={me?.gymId ?? null} />
    </div>
  );
}
