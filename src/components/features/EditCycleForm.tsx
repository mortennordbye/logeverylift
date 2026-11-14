"use client";

/**
 * Edit details of a cycle, in the Plan look of the new cycle setup
 * (docs/design/plan-redesign J2_CycleSetup): name, length, race, what happens
 * at the end and a note. The schedule type shows but cannot change: the
 * sessions are built for it.
 */

import { ButtonReason, Chip, ChipGroup, ErrorLine, FIELD, FormHeader, LABEL, PRIMARY_BUTTON, PinnedBar, RadioCard } from "@/components/features/season-ui";
import { useBack, useReturnTo } from "@/components/ui/BackLink";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import { parseDateStr, wouldEndActiveCycle } from "@/lib/utils/cycle-position";
import { END_ACTIONS, MAIN_LENGTHS, SCHEDULE_MODES, type EndAction } from "@/lib/utils/cycle-setup";
import { callAction } from "@/lib/utils/stale-bundle";
import { MAX_CYCLE_WEEKS, MIN_CYCLE_WEEKS } from "@/lib/validators/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import Link from "next/link";
import { useMemo, useState } from "react";

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
  const returnTo = useReturnTo();
  const back = useBack({ href: `/cycles/${cycle.id}`, label: cycle.name });
  const [name, setName] = useState(cycle.name);
  const [durationWeeks, setDurationWeeks] = useState(cycle.durationWeeks);
  const [custom, setCustom] = useState(!MAIN_LENGTHS.includes(cycle.durationWeeks));
  // The Custom field keeps what was typed, so it can be empty while the user types.
  const [customWeeks, setCustomWeeks] = useState(String(cycle.durationWeeks));
  const weeks = custom ? Number(customWeeks) : durationWeeks;
  const weeksOk = Number.isInteger(weeks) && weeks >= MIN_CYCLE_WEEKS && weeks <= MAX_CYCLE_WEEKS;
  const [endAction, setEndAction] = useState<EndAction>((cycle.endAction as EndAction) ?? "none");
  const [endMessage, setEndMessage] = useState(cycle.endMessage ?? "");
  const [raceDate, setRaceDate] = useState(cycle.raceDate ?? "");
  const [raceDistance, setRaceDistance] = useState<"full" | "half" | null>(cycle.raceDistance ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // A cycle in a season stores no race (D8).
  const inSeason = liveSeasonId != null;

  // Warn if the selected duration would immediately end an active cycle
  const durationWarning = useMemo(() => {
    if (!weeksOk || !wouldEndActiveCycle(cycle, weeks, parseDateStr(today))) return null;
    return "This length is shorter than the time already done, so the cycle would end at once.";
  }, [cycle, weeks, weeksOk, today]);

  // Why Save is off, first missing thing first.
  const reason = !name.trim()
    ? "Give the cycle a name."
    : !weeksOk
      ? `Pick a length from ${MIN_CYCLE_WEEKS} to ${MAX_CYCLE_WEEKS} weeks.`
      : durationWarning
        ? "Pick a longer length."
        : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || durationWarning || !weeksOk) return;
    setLoading(true);
    setError("");

    const result = await callAction(updateTrainingCycle({
      id: cycle.id,
      name: name.trim(),
      // Only a changed length: an unchanged one would drop a length in days (T8).
      durationWeeks: weeks !== cycle.durationWeeks ? weeks : undefined,
      endAction,
      endMessage: endMessage.trim() || null,
      raceDate: raceDate || null,
      raceDistance: raceDate ? raceDistance : null,
    }));

    if (result.success) {
      returnTo(`/cycles/${cycle.id}`);
    } else {
      setLoading(false);
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" style={{ paddingBottom: "calc(140px + var(--kb-height, 0px))" }}>
      {/* The form header of New cycle and Add a phase: Cancel, the title centred. */}
      <FormHeader
        title="Edit cycle"
        left={
          <button type="button" onClick={back.go} className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70">
            Cancel
          </button>
        }
      />

      <div className="flex flex-col gap-[22px] px-4 pt-3">
        <div className="flex flex-col gap-2">
          <label htmlFor="cycle-name" className={LABEL}>
            Name
          </label>
          <input
            id="cycle-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="Upper / Lower hypertrophy"
            className={`${FIELD} placeholder:text-muted-foreground`}
          />
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`mb-2 ${LABEL}`}>How do you train?</legend>
          {SCHEDULE_MODES.map((m) => (
            <RadioCard
              key={m.value}
              name="scheduleType"
              checked={cycle.scheduleType === m.value}
              onChange={() => {}}
              disabled
              title={m.title}
              sub={m.sub}
            />
          ))}
          <p className="mx-1 text-[13px] text-muted-foreground">The schedule type can&apos;t be changed after the cycle is made.</p>
        </fieldset>

        {/* A phase of a season sets its length on the season page. */}
        {inSeason ? (
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Length</span>
            <p className="text-[13px] text-muted-foreground">
              {cycle.durationDays != null ? `${cycle.durationDays} days` : `${cycle.durationWeeks} weeks`}. This cycle is a phase of a
              season. Change its length and phase type on the{" "}
              <Link href={`/seasons/${liveSeasonId}`} className="inline-flex min-h-11 items-center font-medium text-primary active:opacity-70">
                season page
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <ChipGroup label="Length">
              {MAIN_LENGTHS.map((w) => (
                <Chip
                  key={w}
                  pressed={!custom && durationWeeks === w}
                  onClick={() => {
                    setCustom(false);
                    setDurationWeeks(w);
                  }}
                >
                  {w} weeks
                </Chip>
              ))}
              <Chip pressed={custom} onClick={() => setCustom(true)}>
                Custom
              </Chip>
            </ChipGroup>
            {custom && (
              <label className="-mt-2 flex flex-col gap-2">
                <span className="text-[13px] text-muted-foreground">
                  {MIN_CYCLE_WEEKS} to {MAX_CYCLE_WEEKS} weeks
                </span>
                <span className="flex items-center gap-3">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_CYCLE_WEEKS}
                    max={MAX_CYCLE_WEEKS}
                    step={1}
                    value={customWeeks}
                    onChange={(e) => setCustomWeeks(e.target.value)}
                    aria-label="Length in weeks"
                    aria-invalid={!weeksOk}
                    aria-describedby={weeksOk ? undefined : "length-error"}
                    className={`${FIELD} !w-24 aria-[invalid=true]:border-[#ff6b5a]`}
                  />
                  <span className="text-base text-muted-foreground">weeks</span>
                </span>
                {!weeksOk && (
                  <span id="length-error" className="text-[13px] text-[#ff6b5a]">
                    Pick {MIN_CYCLE_WEEKS} to {MAX_CYCLE_WEEKS} weeks.
                  </span>
                )}
              </label>
            )}
            {durationWarning && <p className="-mt-2 text-[13px] text-[#ff6b5a]">{durationWarning}</p>}
          </>
        )}

        {/* Race: what the Garmin race views count down to. Part of the endurance
            add-on; a cycle that already has a race keeps showing it, so no stored
            value is hidden from its owner. */}
        {inSeason && (
          <div id="race" className="flex scroll-mt-4 flex-col gap-2">
            <span className={LABEL}>Race</span>
            <p className="text-[13px] text-muted-foreground" data-testid="season-race-note">
              Races are set on the season.
            </p>
          </div>
        )}
        {!inSeason && (enduranceEnabled || cycle.raceDate) && (
          <div id="race" className="flex scroll-mt-4 flex-col gap-2">
            <label htmlFor="race-date" className={LABEL}>
              Race (optional)
            </label>
            <input id="race-date" type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} className={FIELD} />
            {raceDate && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Race distance">
                {([["full", "Ironman"], ["half", "70.3"]] as const).map(([value, label]) => (
                  <Chip key={value} pressed={raceDistance === value} onClick={() => setRaceDistance(raceDistance === value ? null : value)}>
                    {label}
                  </Chip>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setRaceDate("");
                    setRaceDistance(null);
                  }}
                  className="ml-auto min-h-11 px-3 text-sm text-muted-foreground active:opacity-60"
                >
                  Clear
                </button>
              </div>
            )}
            <p className="text-[13px] text-muted-foreground">
              The Garmin page counts down to this date and checks your training against the race distance.
            </p>
          </div>
        )}

        <ChipGroup label="When it ends">
          {END_ACTIONS.map((a) => (
            <Chip key={a.value} pressed={endAction === a.value} onClick={() => setEndAction(a.value)}>
              {a.label}
            </Chip>
          ))}
        </ChipGroup>

        <div className="flex flex-col gap-2">
          <label htmlFor="cycle-note" className={LABEL}>
            Note to future self (optional)
          </label>
          <textarea
            id="cycle-note"
            value={endMessage}
            maxLength={500}
            onChange={(e) => setEndMessage(e.target.value)}
            placeholder="Test your 1RM"
            rows={2}
            className={`${FIELD} resize-none py-3 placeholder:text-muted-foreground`}
          />
        </div>

        <ErrorLine error={error} />
      </div>

      <PinnedBar>
        <button type="submit" disabled={loading || reason != null} aria-describedby={reason ? "save-reason" : undefined} className={PRIMARY_BUTTON}>
          {loading ? "Saving…" : "Save"}
        </button>
        <ButtonReason id="save-reason" reason={reason} />
      </PinnedBar>
    </form>
  );
}
