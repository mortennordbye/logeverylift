import { HOME_UI } from "@/components/features/home/fonts";
import Link from "next/link";

/** What a cycle or season page shows after the user deleted its item (src/lib/plan-deleted.ts). */
export function PlanItemDeleted({ what }: { what: "cycle" | "season" }) {
  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col gap-2 px-4 pt-4`}>
      <p className="text-base text-foreground/75">This {what} was deleted.</p>
      <Link href="/cycles" className="flex min-h-11 items-center text-base text-primary active:opacity-70">
        Back to Plan
      </Link>
      <Link href="/cycles/deleted" className="flex min-h-11 items-center text-base text-primary active:opacity-70">
        Recently deleted
      </Link>
    </div>
  );
}
