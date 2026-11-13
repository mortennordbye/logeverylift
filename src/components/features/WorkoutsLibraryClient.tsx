"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { manageWorkout } from "@/lib/actions/workouts-compliance";
import { callAction } from "@/lib/utils/stale-bundle";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type LibraryRow = { id: number; name: string; sport: "swim" | "bike" | "run"; summary: string };

const SPORTS: { sport: LibraryRow["sport"]; title: string }[] = [
  { sport: "swim", title: "Swim" },
  { sport: "bike", title: "Bike" },
  { sport: "run", title: "Run" },
];

/**
 * The workouts library (docs/plans/workouts-and-compliance.md, 7): workouts
 * by sport with their summary. Tap one to duplicate, rename or delete it;
 * deleted ones come back from Recently deleted. No step editor: the
 * assistant creates and edits workouts until package C6 adds one.
 */
export function WorkoutsLibraryClient({ workouts, deleted }: { workouts: LibraryRow[]; deleted: LibraryRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<LibraryRow | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function show(w: LibraryRow | null) {
    setOpen(w);
    setName(w?.name ?? "");
    setRenaming(false);
    setConfirmDelete(false);
    setError(null);
  }

  async function run(op: Parameters<typeof manageWorkout>[0]) {
    if (pending) return;
    setPending(true);
    setError(null);
    const r = await callAction(manageWorkout(op));
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    show(null);
    router.refresh();
  }

  const button = "w-full min-h-[44px] rounded-xl text-sm font-medium active:opacity-70 disabled:opacity-50";

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
      {workouts.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="workouts-empty">
          No workouts yet. Ask your assistant to create workouts.
        </p>
      )}
      {SPORTS.map(({ sport, title }) => {
        const list = workouts.filter((w) => w.sport === sport);
        if (!list.length) return null;
        return (
          <section key={sport} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
            {list.map((w) => (
              <button
                key={w.id}
                onClick={() => show(w)}
                className="w-full flex items-center gap-3 rounded-xl bg-card px-4 py-3 min-h-[44px] text-left active:opacity-60"
                data-testid="library-workout"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{w.name}</span>
                  <span className="block text-xs text-muted-foreground">{w.summary}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </section>
        );
      })}

      {deleted.length > 0 && (
        <details className="space-y-2">
          <summary className="min-h-[44px] flex items-center text-sm font-medium text-muted-foreground">Recently deleted ({deleted.length})</summary>
          {deleted.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-2">
              <div className="min-w-0">
                <p className="text-sm truncate">{w.name}</p>
                <p className="text-xs text-muted-foreground truncate">{w.summary}</p>
              </div>
              <button
                onClick={() => run({ op: "restore", id: w.id })}
                disabled={pending}
                aria-label={`Restore ${w.name}`}
                className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60 disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          ))}
        </details>
      )}
      {error && open === null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <BottomSheet open={open !== null} onClose={() => show(null)} blur>
        {open && (
          <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-3 max-h-[85dvh] overflow-y-auto">
            <div>
              <h2 className="text-lg font-semibold">{open.name}</h2>
              <p className="text-sm text-muted-foreground">{open.summary}</p>
            </div>
            {renaming ? (
              <div className="space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  aria-label="Workout name"
                  className="w-full min-h-[44px] rounded-xl bg-muted px-4 text-base outline-none focus:ring-2 ring-primary"
                />
                <button
                  onClick={() => run({ op: "rename", id: open.id, name: name.trim() })}
                  disabled={pending || !name.trim() || name.trim() === open.name}
                  className={`${button} bg-primary text-primary-foreground font-semibold`}
                >
                  Save name
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => run({ op: "duplicate", id: open.id })} disabled={pending} className={`${button} bg-muted`}>
                  Duplicate
                </button>
                <button onClick={() => setRenaming(true)} disabled={pending} className={`${button} bg-muted`}>
                  Rename
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {confirmDelete ? (
              <button
                onClick={() => run({ op: "delete", id: open.id })}
                disabled={pending}
                className="w-full rounded-xl bg-destructive py-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50 active:opacity-80"
              >
                Delete for sure
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="w-full min-h-[44px] text-sm font-medium text-destructive active:opacity-60">
                Delete workout
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
