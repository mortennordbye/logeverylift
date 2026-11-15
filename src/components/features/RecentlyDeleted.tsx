"use client";

import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** `deletedOn` is formatted on the server in the user's zone. */
export type DeletedPlan = { id: number; name: string; deletedOn: string; revisionId: number | null };

/**
 * Deleted programs or cycles, restorable for 90 days (docs/plans/revisions.md,
 * 2.9 and section 9). Hidden when there are none.
 */
export function RecentlyDeleted({ kind, items }: { kind: "program" | "cycle" | "season"; items: DeletedPlan[] }) {
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
                    Deleted {item.deletedOn}
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

/** One row of the Recently deleted screen: `sub` says what it was and when it was deleted. */
export type DeletedRow = { key: string; name: string; sub: string; revisionId: number | null };

/**
 * The Plan tab's Recently deleted screen (J7_RecentlyDeleted): deleted
 * cycles, phases and seasons, newest first, each with Restore.
 */
export function RecentlyDeletedList({ items }: { items: DeletedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(item: DeletedRow) {
    if (item.revisionId == null) return;
    setBusy(item.key);
    setError(null);
    const result = await callAction(restorePlanRevision({ revisionId: item.revisionId }));
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="mx-1 text-[15px] text-muted-foreground">Nothing was deleted in the last 90 days.</p>;
  }
  return (
    <>
      {error && <p className="mx-1 text-sm text-[#ff6b5a]" role="alert">{error}</p>}
      <div className="flex flex-col overflow-hidden rounded-[20px] bg-widget" data-testid="recently-deleted-list">
        {items.map((item) => (
          <div key={item.key} className="flex min-h-[60px] items-center justify-between gap-3 border-b border-hairline py-2.5 pr-2 pl-4 last:border-b-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-medium">{item.name}</span>
              <span className="text-[13px] text-muted-foreground">{item.sub}</span>
            </div>
            <button
              type="button"
              onClick={() => restore(item)}
              disabled={busy !== null || item.revisionId == null}
              aria-label={`Restore ${item.name}`}
              className="min-h-[44px] shrink-0 px-3 text-[15px] font-semibold text-brand active:opacity-60 disabled:opacity-50"
            >
              {busy === item.key ? "Restoring…" : "Restore"}
            </button>
          </div>
        ))}
      </div>
      <p className="mx-1 text-[13px] text-muted-foreground">Items are kept for 90 days.</p>
    </>
  );
}
