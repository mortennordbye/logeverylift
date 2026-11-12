"use client";

import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type DeletedPlan = { id: number; name: string; deletedAt: string; revisionId: number | null };

/**
 * Deleted programs or cycles, restorable for 90 days (docs/plans/revisions.md,
 * 2.9 and section 9). Hidden when there are none.
 */
export function RecentlyDeleted({ kind, items }: { kind: "program" | "cycle"; items: DeletedPlan[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function restore(item: DeletedPlan) {
    if (item.revisionId == null) return;
    setBusy(item.id);
    setError(null);
    const result = await callAction(restorePlanRevision({ revisionId: item.revisionId }));
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="pt-6" data-testid={`recently-deleted-${kind}s`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between min-h-[44px] text-sm font-medium text-muted-foreground active:opacity-60"
        aria-expanded={open}
      >
        Recently deleted ({items.length})
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Deleted {kind}s can be restored for 90 days. Then they are deleted for good.
          </p>
          {error && <p className="text-sm text-destructive mb-2">{error}</p>}
          <div className="rounded-xl bg-card divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2 min-h-[44px]">
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Deleted {new Date(item.deletedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <button
                  onClick={() => restore(item)}
                  disabled={busy !== null || item.revisionId == null}
                  className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary disabled:opacity-50 active:opacity-60"
                >
                  {busy === item.id ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
