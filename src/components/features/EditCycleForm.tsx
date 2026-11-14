"use client";

import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import { parseDateStr, wouldEndActiveCycle } from "@/lib/utils/cycle-position";
import { callAction } from "@/lib/utils/stale-bundle";
import { CYCLE_DURATION_WEEKS } from "@/lib/validators/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const DURATION_OPTIONS = CYCLE_DURATION_WEEKS;

const END_ACTION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "deload", label: "Deload week" },
  { value: "new_cycle", label: "Start new cycle" },
  { value: "rest", label: "Rest period" },
] as const;

type EndAction = "none" | "deload" | "new_cycle" | "rest";

type Props = {
  cycle: TrainingCycle;
  /** The endurance add-on (src/lib/endurance.ts); gates the race field. */
  enduranceEnabled: boolean;
  /** The live season the cycle is a phase of; null for none or a deleted one (it then acts as a cycle with no season). */
  liveSeasonId?: number | null;
  /** Today in the user's time zone, `YYYY-MM-DD`. */
  today: string;
};

export function EditCycleForm({ cycle, enduranceEnabled, liveSeasonId = null, today }: Props) {
  const router = useRouter();
  const [name, setName] = useState(cycle.name);
  const [durationWeeks, setDurationWeeks] = useState(cycle.durationWeeks);
  const [endAction, setEndAction] = useState<EndAction>(
    (cycle.endAction as EndAction) ?? "none",
  );
  const [endMessage, setEndMessage] = useState(cycle.endMessage ?? "");
  const [raceDate, setRaceDate] = useState(cycle.raceDate ?? "");
  const [raceDistance, setRaceDistance] = useState<"full" | "half" | null>(cycle.raceDistance ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scheduleLabel =
    cycle.scheduleType === "day_of_week" ? "Day of week" : "Rotation";
  // A cycle in a season stores no race (D8).
  const inSeason = liveSeasonId != null;

  // Warn if the selected duration would immediately end an active cycle
  const durationWarning = useMemo(() => {
    if (!wouldEndActiveCycle(cycle, durationWeeks, parseDateStr(today))) return null;
    return "This duration is shorter than time already elapsed — the cycle would end immediately.";
  }, [cycle, durationWeeks, today]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || durationWarning) return;
    setLoading(true);
    setError("");

    const result = await callAction(updateTrainingCycle({
      id: cycle.id,
      name: name.trim(),
      // Only a changed length: an unchanged one would drop a length in days (T8).
      durationWeeks: durationWeeks !== cycle.durationWeeks ? durationWeeks : undefined,
      endAction,
      endMessage: endMessage.trim() || null,
      raceDate: raceDate || null,
      raceDistance: raceDate ? raceDistance : null,
    }));

    setLoading(false);
    if (result.success) {
      router.replace(`/cycles/${cycle.id}`);
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Name */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Spring Strength Block"
          className="rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
        />
      </div>

      {/* Duration: a phase of a season sets its length on the season page. */}
      {inSeason ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Duration</span>
          <p className="text-sm text-muted-foreground">
            {cycle.durationDays != null ? `${cycle.durationDays} days` : `${cycle.durationWeeks} weeks`}. This cycle is a phase of a season: change its length and phase type on the{" "}
            <Link href={`/seasons/${liveSeasonId}`} className="text-primary font-medium">season page</Link>.
          </p>
        </div>
      ) : (
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Duration
        </label>
        <div className="flex gap-2 flex-wrap">
          {DURATION_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDurationWeeks(w)}
              className={`
                px-4 py-2 rounded-full text-sm font-semibold border-2 transition-colors
                ${durationWeeks === w
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"}
              `}
            >
              {w}w
            </button>
          ))}
        </div>
        {durationWarning && (
          <p className="text-sm text-destructive">{durationWarning}</p>
        )}
      </div>
      )}

      {/* Race: what the Garmin race views count down to. Part of the endurance
          add-on; a cycle that already has a race keeps showing it, so no stored
          value is hidden from its owner. */}
      {inSeason && (
        <div id="race" className="flex flex-col gap-2 scroll-mt-4">
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Race</span>
          <p className="text-sm text-muted-foreground" data-testid="season-race-note">
            Races are set on the season.
          </p>
        </div>
      )}
      {!inSeason && (enduranceEnabled || cycle.raceDate) && (
      <div id="race" className="flex flex-col gap-2 scroll-mt-4">
        <label htmlFor="race-date" className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Race <span className="normal-case font-normal">(optional)</span>
        </label>
        <input
          id="race-date"
          type="date"
          value={raceDate}
          onChange={(e) => setRaceDate(e.target.value)}
          className="rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary min-h-[44px]"
        />
        <div className="flex gap-2" role="group" aria-label="Race distance">
          {([["full", "Ironman"], ["half", "70.3"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={raceDistance === value}
              disabled={!raceDate}
              onClick={() => setRaceDistance(raceDistance === value ? null : value)}
              className={`
                px-4 min-h-[44px] rounded-full text-sm font-semibold border-2 transition-colors disabled:opacity-40
                ${raceDistance === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}
              `}
            >
              {label}
            </button>
          ))}
          {raceDate && (
            <button type="button" onClick={() => { setRaceDate(""); setRaceDistance(null); }} className="ml-auto px-3 min-h-[44px] text-sm text-muted-foreground active:opacity-60">
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          The Garmin page counts down to this date and checks your training against the race distance.
        </p>
      </div>
      )}

      {/* Schedule type — read-only after creation */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Schedule type
        </label>
        <div className="flex rounded-xl overflow-hidden border border-border opacity-60">
          <div
            className={`
              flex-1 py-3 text-sm font-semibold text-center transition-colors
              ${cycle.scheduleType === "day_of_week" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
            `}
          >
            Day of week
          </div>
          <div
            className={`
              flex-1 py-3 text-sm font-semibold text-center transition-colors
              ${cycle.scheduleType === "rotation" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
            `}
          >
            Rotation
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {cycle.scheduleType === "day_of_week"
            ? "Each weekday has a workout. Missed days don't carry over — Monday's leg day stays on Monday."
            : "Follow a sequence in order. Missed workouts repeat until done; rest days auto-advance with the calendar."}
        </p>
        <p className="text-xs text-muted-foreground">
          {scheduleLabel} — schedule type can&apos;t be changed after creation
        </p>
      </div>

      {/* End action */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          When cycle ends
        </label>
        <div className="flex flex-col rounded-xl overflow-hidden border border-border divide-y divide-border">
          {END_ACTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEndAction(opt.value)}
              className={`
                flex items-center justify-between px-4 py-3 text-sm transition-colors
                ${endAction === opt.value ? "bg-primary/10 text-primary font-semibold" : "text-foreground"}
              `}
            >
              {opt.label}
              {endAction === opt.value && (
                <span className="w-2 h-2 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* End message */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Note to future self{" "}
          <span className="normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={endMessage}
          onChange={(e) => setEndMessage(e.target.value)}
          placeholder="e.g. Time to test your 1RM!"
          rows={3}
          className="rounded-xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 ring-primary resize-none"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim() || !!durationWarning}
        className="rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform"
      >
        {loading ? "Saving…" : "Save Changes"}
      </button>
      <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
    </form>
  );
}
