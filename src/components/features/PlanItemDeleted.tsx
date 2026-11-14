"use client";

import { HOME_UI } from "@/components/features/home/fonts";
import { PRIMARY_BUTTON } from "@/components/features/season-ui";
import { BackLink } from "@/components/ui/BackLink";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import type { DeletedItem } from "@/lib/plan-deleted";
import { callAction } from "@/lib/utils/stale-bundle";
import { keepDates } from "@/lib/utils/keep-dates";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * What a cycle or season page shows after the user deleted its item
 * (src/lib/plan-deleted.ts): the Plan header with Back, the item's name and
 * Restore, the same restore as Recently deleted. A restore shows the item
 * again on this page.
 */
export function PlanItemDeleted({ item }: { item: DeletedItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (item.revisionId == null) return;
    setBusy(true);
    setError(null);
    const result = await callAction(restorePlanRevision({ revisionId: item.revisionId }));
    if (!result.success) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`} data-testid="plan-item-deleted">
      <header className="flex items-center px-4 pt-4 shrink-0">
        <BackLink fallback={{ href: "/cycles", label: "Plan" }} />
      </header>
      <div className="flex flex-col gap-4 px-4 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold break-words">{item.name} was deleted.</h1>
          <p className="text-[15px] text-muted-foreground">{keepDates(`You can restore this ${item.what} for 90 days.`)}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-[#ff6b5a]">
            {error}
          </p>
        )}
        {item.revisionId != null && (
          <button type="button" onClick={restore} disabled={busy} className={PRIMARY_BUTTON}>
            {busy ? "Restoring…" : "Restore"}
          </button>
        )}
        <Link href="/cycles/deleted" className="flex min-h-11 items-center justify-center text-base font-medium text-primary active:opacity-70">
          Recently deleted
        </Link>
      </div>
    </div>
  );
}
