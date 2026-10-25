import { GymPickerClient } from "@/components/features/GymPickerClient";
import { db } from "@/db";
import { gyms, users } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export default async function GymPickerPage() {
  const session = await requireSession();
  const [current] = await db
    .select({ name: gyms.name, address: gyms.address })
    .from(users)
    .innerJoin(gyms, eq(gyms.id, users.primaryGymId))
    .where(eq(users.id, session.user.id));

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/account" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Account</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Your gym</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick where you usually train to show up on the gym map and find people who train there too.
        </p>
      </div>
      <GymPickerClient current={current ?? null} />
    </div>
  );
}
