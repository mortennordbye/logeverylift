"use client";

import { createSeasonAction, deleteSeasonAction, updateSeasonAction } from "@/lib/actions/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Initial = { id: number; name: string; goal: string | null; startDate: string; endDate: string; nextGoal: string | null };

const LABEL = "text-sm font-medium text-muted-foreground uppercase tracking-wider";
const INPUT = "rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary";

/** Create or edit a season (docs/plans/seasons.md, 2.10). Delete sits at the bottom of the edit form. */
export function SeasonForm({ initial, defaultStart }: { initial?: Initial; defaultStart?: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? defaultStart ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [nextGoal, setNextGoal] = useState(initial?.nextGoal ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid = name.trim() && startDate && endDate && endDate >= startDate;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError("");
    const fields = { name: name.trim(), goal: goal.trim() || null, startDate, endDate, nextGoal: nextGoal.trim() || null };
    if (initial) {
      const result = await callAction(updateSeasonAction({ seasonId: initial.id, ...fields }));
      setLoading(false);
      if (!result.success) return setError(result.error);
      router.replace(`/seasons/${initial.id}`);
    } else {
      const result = await callAction(createSeasonAction(fields));
      setLoading(false);
      if (!result.success) return setError(result.error);
      router.replace(`/seasons/${result.data.id}`);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    setLoading(true);
    const result = await callAction(deleteSeasonAction({ seasonId: initial.id }));
    setLoading(false);
    if (!result.success) return setError(result.error);
    router.replace("/cycles");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="season-name" className={LABEL}>Name</label>
        <input id="season-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Half distance 2027" className={INPUT} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="season-goal" className={LABEL}>
          Goal <span className="normal-case font-normal">(optional)</span>
        </label>
        <textarea id="season-goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={500} rows={2} placeholder="e.g. Finish my first half, or bench 120 kg" className={`${INPUT} text-sm resize-none`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <label htmlFor="season-start" className={LABEL}>Start</label>
          <input id="season-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <label htmlFor="season-end" className={LABEL}>End</label>
          <input id="season-end" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={INPUT} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="season-next" className={LABEL}>
          Next goal <span className="normal-case font-normal">(optional)</span>
        </label>
        <input id="season-next" value={nextGoal} onChange={(e) => setNextGoal(e.target.value)} maxLength={500} placeholder="e.g. Full distance in 2028" className={INPUT} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading || !valid}
        className="rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform"
      >
        {loading ? "Saving…" : initial ? "Save" : "Create season"}
      </button>

      {initial &&
        (confirmDelete ? (
          <div className="rounded-xl bg-destructive/10 p-4 flex flex-col gap-3">
            <p className="text-sm">Delete this season? Its cycles stay. You can restore it from Recently deleted for 90 days.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 rounded-xl bg-muted min-h-[44px] text-sm font-medium active:opacity-70">
                Cancel
              </button>
              <button type="button" onClick={handleDelete} disabled={loading} className="flex-1 rounded-xl bg-destructive text-white min-h-[44px] text-sm font-semibold active:opacity-80">
                Delete season
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-destructive text-sm font-medium min-h-[44px] active:opacity-70">
            Delete season
          </button>
        ))}
      <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
    </form>
  );
}
