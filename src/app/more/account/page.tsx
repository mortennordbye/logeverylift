import { AccountClient } from "@/components/features/AccountClient";
import { parseUserGoals } from "@/lib/utils/goals";
import { db } from "@/db";
import { users } from "@/db/schema/users";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();
  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      </div>

      <AccountClient
        name={session.user.name}
        email={session.user.email}
        role={(session.user as { role?: string }).role ?? "user"}
        profile={{
          gender: user?.gender ?? null,
          birthYear: user?.birthYear ?? null,
          heightCm: user?.heightCm ?? null,
          weightKg: user?.weightKg ?? null,
          goals: parseUserGoals(user?.goals),
          experienceLevel: user?.experienceLevel ?? null,
        }}
        showActivityToFriends={user?.showActivityToFriends ?? true}
      />
    </div>
  );
}
