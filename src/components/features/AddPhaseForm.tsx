"use client";

import { useBack, useReturnTo } from "@/components/ui/BackLink";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PlanSheetPanel } from "@/components/features/PlanSheetPanel";
import { ButtonReason, Chip, FIELD, FormHeader, LABEL, PRIMARY_BUTTON, PinnedBar, RadioCard, Segmented, StepProgress } from "@/components/features/season-ui";
import { TakeStartSheet } from "@/components/features/TakeStartSheet";
import { addPhaseAction } from "@/lib/actions/seasons";
import { deleteTrainingCycle } from "@/lib/actions/training-cycles";
import type { ScheduledDraft } from "@/lib/utils/cycle-start";
import type { PhaseType } from "@/lib/utils/periodization";
import { takeStartLines, type RunningBlock } from "@/lib/utils/season-start";
import { PHASE_TYPE_LABELS, addPhaseWarning, shortDay, switchLengthUnit, type LengthUnit } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  seasonId: number;
  seasonName: string;
  /** 1-based place of the new phase: after the last one. */
  position: number;
  /** The phase it follows, if any. */
  afterName: string | null;
  /** The day the new phase starts: the day after the last phase ends, or the season start. */
  startsOn: string;
  enduranceEnabled: boolean;
  /** The A race's default taper length in days, if the season has an A race. */
  taperDays: number | null;
  /** Cycles in no season. */
  candidates: { id: number; name: string; status: string }[];
  /** The user's today, YYYY-MM-DD. */
  today: string;
  /** What a season's first phase ends and drops when it takes the scheduled start (takeStartLines). */
  running: RunningBlock | null;
  scheduled: ScheduledDraft | null;
  /** The A race day, if the season has an A race, and the season's last day: a phase past them gets a warning. */
  raceDate: string | null;
  seasonEnd: string;
};

const PHASE_TYPES = Object.keys(PHASE_TYPE_LABELS) as PhaseType[];
const STATUS_WORD: Record<string, string> = { active: "Running now", draft: "Not started" };

/**
 * Add a phase (J4_AddPhase). Step 1 of 2: a new cycle with a name, type,
 * length and schedule, then step 2 builds its week on
 * /seasons/[id]/phases/[cycleId]/week. A cycle the user already has joins in
 * one step.
 */
export function AddPhaseForm(p: Props) {
  const router = useRouter();
  const returnTo = useReturnTo();
  const cancel = useBack({ href: `/seasons/${p.seasonId}`, label: "Season" });
  const [source, setSource] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [phaseType, setPhaseType] = useState<PhaseType | null>(null);
  const [length, setLength] = useState("4");
  const [unit, setUnit] = useState<LengthUnit>("weeks");
  const [unitNote, setUnitNote] = useState<string | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [lengthTouched, setLengthTouched] = useState(false);
  const [scheduleType, setScheduleType] = useState<"day_of_week" | "rotation">("day_of_week");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickType(t: PhaseType) {
    const next = phaseType === t ? null : t;
    setPhaseType(next);
    // A taper is as long as the A race asks for, until the user sets a length.
    if (next === "taper" && p.taperDays && !lengthTouched) {
      setUnit("days");
      setLength(String(p.taperDays));
    }
  }

  const n = Number(length);
  // An existing cycle keeps its own length when the field is empty.
  const lengthOk = source === "existing" && length === "" ? true : Number.isInteger(n) && n >= 1 && n <= (unit === "days" ? 364 : 52);
  const valid = (source === "new" ? name.trim() !== "" : cycleId != null) && lengthOk;
  // Why the button is off, in the order of the form.
  const reason = valid
    ? null
    : source === "new" && name.trim() === ""
      ? "Give the phase a name."
      : source === "existing" && cycleId == null
        ? "Pick a cycle."
        : length === ""
          ? "Type a length."
          : unit === "days"
            ? "Pick 1 to 364 days."
            : "Pick 1 to 52 weeks.";
  const warning = addPhaseWarning({
    startsOn: p.startsOn,
    lengthDays: length !== "" && lengthOk ? (unit === "days" ? n : n * 7) : null,
    raceDate: p.raceDate,
    seasonEnd: p.seasonEnd,
  });

  function changeUnit(to: LengthUnit) {
    const next = switchLengthUnit(length, unit, to);
    setLength(next.length);
    setUnit(next.unit);
    setUnitNote(next.note);
  }

  // The season's first phase takes the one scheduled start on the season's
  // start day: the user confirms what that ends and drops first.
  const startLines =
    p.position === 1 && p.startsOn > p.today
      ? takeStartLines({
          seasonId: p.seasonId,
          day: p.startsOn,
          running: p.running,
          scheduled: p.scheduled,
          joining: source === "existing" && cycleId != null ? [cycleId] : [],
        })
      : [];
  const action = source === "new" ? "Build the week" : "Add phase";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    if (startLines.length > 0) {
      setError(null);
      setConfirmStart(true);
      return;
    }
    await save(false);
  }

  async function save(takeStart: boolean) {
    setBusy(true);
    setError(null);
    const len = length === "" ? {} : unit === "days" ? { durationDays: n } : { durationWeeks: n };
    const type = p.enduranceEnabled && phaseType ? { phaseType } : {};
    const take = takeStart ? { takeStart: true } : {};
    const input =
      source === "new"
        ? { seasonId: p.seasonId, name: name.trim(), scheduleType, ...type, ...len, ...take }
        : { seasonId: p.seasonId, cycleId: cycleId!, ...type, ...len, ...take };
    const result = await callAction(addPhaseAction(input));
    setBusy(false);
    if (!result.success) return setError(result.error);
    // Step 2: the week of the new cycle. Replaces this form, so Back goes to the season.
    if (source === "new") router.replace(`/seasons/${p.seasonId}/phases/${result.data.cycleId}/week`);
    else returnTo(`/seasons/${p.seasonId}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col pb-40">
      <FormHeader
        title="Add a phase"
        left={
          <button type="button" onClick={cancel.go} className="min-h-11 px-2 text-base text-primary active:opacity-70">
            Cancel
          </button>
        }
      />

      <div className="flex flex-col gap-5 px-4 pt-1">
        <div className="flex flex-col gap-2">
          {source === "new" && <StepProgress step={1} of={2} />}
          <span className="text-sm text-foreground/75">
            Phase {p.position} in {p.seasonName}
            {p.afterName ? ` · after ${p.afterName}` : ""}
          </span>
        </div>

        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Phase source</legend>
          <RadioCard name="phase-source" checked={source === "new"} onChange={() => setSource("new")} title="New cycle" />
          <RadioCard
            name="phase-source"
            checked={source === "existing"}
            onChange={() => {
              setSource("existing");
              if (!lengthTouched) setLength("");
            }}
            title="Cycle I already have"
            disabled={p.candidates.length === 0}
          />
        </fieldset>

        {source === "new" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="phase-name" className={LABEL}>
              Name
            </label>
            <input id="phase-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Swim, intervals, bricks" className={FIELD} />
          </div>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className={`${LABEL} mb-2`}>Cycle</legend>
            {p.candidates.map((c) => (
              <RadioCard key={c.id} name="phase-cycle" checked={cycleId === c.id} onChange={() => setCycleId(c.id)} title={c.name} sub={STATUS_WORD[c.status] ?? c.status} />
            ))}
          </fieldset>
        )}

        {p.enduranceEnabled && (
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Phase type</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Phase type">
              {PHASE_TYPES.map((t) => (
                <Chip key={t} pressed={phaseType === t} onClick={() => pickType(t)}>
                  {PHASE_TYPE_LABELS[t]}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className={LABEL}>Length</span>
          <div className="flex gap-2">
            <input
              aria-label="Length"
              inputMode="numeric"
              value={length}
              placeholder={source === "existing" ? "Keep" : undefined}
              onChange={(e) => {
                setLength(e.target.value.replace(/\D/g, ""));
                setLengthTouched(true);
                setUnitNote(null);
              }}
              className={`${FIELD.replace("w-full", "w-[88px] shrink-0")} font-semibold`}
            />
            <Segmented
              label="Length unit"
              value={unit}
              onChange={changeUnit}
              className="flex-1"
              options={[
                { value: "weeks", label: "Weeks" },
                { value: "days", label: "Days" },
              ]}
            />
          </div>
          {unitNote && <span className="text-[13px] text-muted-foreground">{unitNote}</span>}
          <span className="text-[13px] text-muted-foreground">
            Starts {shortDay(p.startsOn).slice(4)}, {p.afterName ? "the day after the phase before ends." : "when the season starts."}
          </span>
          {warning && <span className="text-[13px] font-medium text-[#ff6b5a]">{warning}</span>}
        </div>

        {source === "new" && (
          <fieldset className="flex flex-col gap-2">
            <legend className={`${LABEL} mb-2`}>Schedule</legend>
            <RadioCard
              name="phase-schedule"
              checked={scheduleType === "day_of_week"}
              onChange={() => setScheduleType("day_of_week")}
              title="Same days each week"
              sub="Monday strength, Wednesday run"
            />
            <RadioCard
              name="phase-schedule"
              checked={scheduleType === "rotation"}
              onChange={() => setScheduleType("rotation")}
              title="Rotation"
              sub="The next session follows the last one. No fixed days."
            />
          </fieldset>
        )}

        {error && !confirmStart && (
          <p role="alert" className="text-sm text-[#ff6b5a]">
            {error}
          </p>
        )}
      </div>

      <PinnedBar>
        <button type="submit" disabled={busy || !valid} aria-describedby={reason ? "phase-reason" : undefined} className={PRIMARY_BUTTON}>
          {busy ? "Saving…" : action}
        </button>
        <ButtonReason id="phase-reason" reason={reason} />
      </PinnedBar>

      <TakeStartSheet
        open={confirmStart}
        title={`Start this season ${shortDay(p.startsOn)}?`}
        lines={startLines}
        action={action}
        busy={busy}
        error={error}
        onConfirm={() => save(true)}
        onClose={() => {
          setError(null);
          setConfirmStart(false);
        }}
      />
    </form>
  );
}

/**
 * Step 2's Cancel (J4_WeekBuilder): step 1 made the phase, so leaving here
 * offers to remove it, as Discard does for a new cycle. Keep building stays.
 */
export function AddPhaseCancel({ seasonId, cycleId, name }: { seasonId: number; cycleId: number; name: string }) {
  const returnTo = useReturnTo();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await callAction(deleteTrainingCycle(cycleId));
    if (!result.success) {
      setBusy(false);
      return setError(result.error);
    }
    returnTo(`/seasons/${seasonId}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="flex min-h-11 items-center px-2 text-base text-primary active:opacity-70"
      >
        Cancel
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        {open && (
          <PlanSheetPanel label="Remove this phase?">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">Remove this phase?</h2>
              <p className="text-sm text-muted-foreground">{name} and the sessions you added are deleted.</p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-[#ff6b5a]">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="min-h-[52px] w-full rounded-2xl bg-[#c23a2e] text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              {busy ? "Removing…" : "Remove phase"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 text-[15px] font-medium text-muted-foreground active:opacity-70">
              Keep building
            </button>
          </PlanSheetPanel>
        )}
      </BottomSheet>
    </>
  );
}

/** Step 2's pinned finish (J4_WeekBuilder): the phase is saved, so it only goes back to the season. */
export function AddPhaseFinish({ seasonId }: { seasonId: number }) {
  const returnTo = useReturnTo();
  return (
    <PinnedBar>
      <button type="button" onClick={() => returnTo(`/seasons/${seasonId}`)} className={PRIMARY_BUTTON}>
        Add phase
      </button>
    </PinnedBar>
  );
}
