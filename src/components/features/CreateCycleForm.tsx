"use client";

/**
 * The new cycle setup (docs/design/plan-redesign J2_CycleSetup,
 * J2_RotationOrder, J4_WeekBuilder).
 *
 * Step 1 (`CreateCycleForm`): name, schedule type, length, start and what
 * happens at the end. Next makes the cycle as a draft (or saves the draft on a
 * second visit) and opens step 2. The schedule type is fixed once the draft
 * exists: its sessions are built for it.
 *
 * Step 2 (`CycleSetupSessions`): the sessions, saved as they are added. Create
 * cycle starts the draft today, or schedules it for the chosen day. Cancel
 * discards the draft this setup made.
 */

import { CycleScheduleBuilder, type PickerProgram } from "@/components/features/CycleScheduleBuilder";
import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { ButtonReason, Chip, ChipGroup, ErrorLine, FormHeader, LABEL, PinnedBar, StepProgress, WeeksField } from "@/components/features/season-ui";
import { TakeStartSheet } from "@/components/features/TakeStartSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useBack, useReturnTo } from "@/components/ui/BackLink";
import { useSubmitLock } from "@/components/features/use-submit-lock";
import { createTrainingCycle, deleteTrainingCycle, startTrainingCycle, updateTrainingCycle } from "@/lib/actions/training-cycles";
import { addDays, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";
import { END_ACTIONS, MAIN_LENGTHS, SCHEDULE_MODES, choiceFor, startDayFor, type EndAction, type ScheduleType, type StartChoice, type StartDays } from "@/lib/utils/cycle-setup";
import { dropsScheduledLine, endsRunningLine, runningOn, type RunningCycle, type ScheduledDraft } from "@/lib/utils/cycle-start";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { MAX_CYCLE_WEEKS, MIN_CYCLE_WEEKS } from "@/lib/validators/training-cycles";
import type { TrainingCycle, TrainingCycleWithSlots } from "@/types/workout";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** A setup URL: step 2 of `cycleId`, or step 1 of it with `step1`. */
export function setupHref(cycleId: number, start: string, step1 = false): string {
  return `/cycles/new?cycle=${cycleId}&start=${start}${step1 ? "&step=1" : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared parts
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY =
  "h-[52px] w-full rounded-2xl bg-brand text-primary-foreground text-base font-semibold active:opacity-80 disabled:opacity-50";

// ─────────────────────────────────────────────────────────────────────────────
// Step 1
// ─────────────────────────────────────────────────────────────────────────────

export function CreateCycleForm({
  days,
  draft,
  start,
  running,
  scheduled,
}: {
  days: StartDays;
  /** The running cycle: a start before it ends ends it (activateInSession, startDueScheduledCycle). */
  running?: RunningCycle | null;
  /** The draft scheduled to start later: this start drops it (scheduleCycle, activateInSession). */
  scheduled?: ScheduledDraft | null;
  /** The draft made by an earlier Next, when the user came back from step 2. */
  draft?: TrainingCycle;
  /** The start day chosen before, with `draft`. */
  start?: string;
}) {
  const router = useRouter();
  const cancel = useBack({ href: "/cycles", label: "Plan" });
  const [name, setName] = useState(draft?.name ?? "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>((draft?.scheduleType as ScheduleType) ?? "day_of_week");
  const [durationWeeks, setDurationWeeks] = useState(draft?.durationWeeks ?? 8);
  const [moreLengths, setMoreLengths] = useState(!MAIN_LENGTHS.includes(draft?.durationWeeks ?? 8));
  // The Custom field keeps what was typed, so it can be empty while the user types.
  const [customWeeks, setCustomWeeks] = useState(String(draft?.durationWeeks ?? 10));
  const weeks = moreLengths ? Number(customWeeks) : durationWeeks;
  const weeksOk = Number.isInteger(weeks) && weeks >= MIN_CYCLE_WEEKS && weeks <= MAX_CYCLE_WEEKS;
  const [choice, setChoice] = useState<StartChoice | null>(() => {
    // Every start drops a draft scheduled now (only one is scheduled at a
    // time, scheduleCycle), so with one scheduled no start is chosen, and no
    // chip is pressed, until the user picks one (round 10). While a cycle
    // runs, a new one starts after it unless the user picks Today.
    if (!start && scheduled && scheduled.id !== draft?.id) return null;
    const c = start ? choiceFor(start, days) : days.afterCurrent ? "after" : "today";
    return c === "after" && !days.afterCurrent ? "today" : c;
  });
  const [picked, setPicked] = useState(start && choiceFor(start, days) === "date" ? start : "");
  const [endAction, setEndAction] = useState<EndAction>((draft?.endAction as EndAction) ?? "none");
  const [endMessage, setEndMessage] = useState(draft?.endMessage ?? "");
  // Busy from the first tap until the next page is on screen (useSubmitLock).
  const { busy: loading, lock, unlock } = useSubmitLock();
  const [error, setError] = useState("");

  const startDay = choice ? startDayFor(choice, days, picked) : null;
  const endsLine = startDay ? endsRunningLine(draft?.id ?? 0, runningOn(running, startDay)) : null;
  const dropsLine = startDay ? dropsScheduledLine(draft?.id ?? null, scheduled) : null;
  // Why Build the week is off, first missing thing first.
  const reason = !name.trim() ? "Give the cycle a name." : !weeksOk ? `Pick a length from ${MIN_CYCLE_WEEKS} to ${MAX_CYCLE_WEEKS} weeks.` : !startDay ? "Pick a start day." : null;
  const tomorrow = toDateStr(addDays(parseDateStr(days.today), 1));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !startDay || !weeksOk || !lock()) return;
    setError("");

    const fields = { name: name.trim(), durationWeeks: weeks, endAction };
    const result = draft
      ? await callAction(updateTrainingCycle({ id: draft.id, ...fields, endMessage: endMessage.trim() || null }))
      : await callAction(createTrainingCycle({ ...fields, scheduleType, endMessage: endMessage.trim() || undefined }));

    if (result.success) {
      router.replace(setupHref(result.data.id, startDay));
    } else {
      unlock();
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" style={{ paddingBottom: "calc(140px + var(--kb-height, 0px))" }}>
      <FormHeader
        title="New cycle"
        left={
          <button type="button" onClick={cancel.go} className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70">
            Cancel
          </button>
        }
      />

      <div className="flex flex-col gap-[22px] px-4 pt-3">
        <StepProgress step={1} of={2} />

        <label className="flex flex-col gap-2">
          <span className={LABEL}>Name</span>
          <input
            autoFocus={!draft}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cycle name"
            className="h-12 px-3.5 rounded-xl border border-[rgba(244,244,245,0.12)] bg-widget text-base outline-none focus:ring-2 ring-brand placeholder:text-muted-foreground"
          />
        </label>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className={`mb-2 ${LABEL}`}>How do you train?</legend>
          {SCHEDULE_MODES.map((m) => {
            const on = scheduleType === m.value;
            return (
              <label
                key={m.value}
                className={`flex items-start gap-3 p-3.5 rounded-[14px] bg-widget border ${on ? "border-brand" : "border-[rgba(244,244,245,0.12)]"} ${
                  draft ? "opacity-60" : "active:opacity-80"
                }`}
              >
                <input
                  type="radio"
                  name="scheduleType"
                  value={m.value}
                  checked={on}
                  disabled={!!draft}
                  onChange={() => setScheduleType(m.value)}
                  className="sr-only peer"
                />
                <span
                  aria-hidden
                  className={`mt-px h-[22px] w-[22px] shrink-0 rounded-full border-2 flex items-center justify-center peer-focus-visible:ring-2 ring-brand ${
                    on ? "border-brand" : "border-[#707076]"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-brand" : ""}`} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{m.title}</span>
                  <span className="text-[13px] text-muted-foreground">{m.sub}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <ChipGroup label="Length">
          {MAIN_LENGTHS.map((w) => (
            <Chip
              key={w}
              pressed={!moreLengths && durationWeeks === w}
              onClick={() => {
                setMoreLengths(false);
                setDurationWeeks(w);
              }}
            >
              {w} weeks
            </Chip>
          ))}
          <Chip pressed={moreLengths} onClick={() => setMoreLengths(true)}>Custom</Chip>
        </ChipGroup>
        {moreLengths && <WeeksField value={customWeeks} onChange={setCustomWeeks} ok={weeksOk} min={MIN_CYCLE_WEEKS} max={MAX_CYCLE_WEEKS} />}

        <ChipGroup label="Start">
          <Chip pressed={choice === "today"} onClick={() => setChoice("today")}>Today</Chip>
          <Chip pressed={choice === "monday"} onClick={() => setChoice("monday")}>{`Next Monday · ${shortDay(days.nextMonday).slice(4)}`}</Chip>
          <Chip pressed={choice === "date"} onClick={() => setChoice("date")}>Pick a date</Chip>
          {days.afterCurrent && <Chip pressed={choice === "after"} onClick={() => setChoice("after")}>After current cycle</Chip>}
        </ChipGroup>
        {choice === "date" && (
          <label className="flex flex-col gap-2 -mt-2">
            <span className={LABEL}>Start day</span>
            <input
              type="date"
              value={picked}
              min={tomorrow}
              max={days.latest}
              onChange={(e) => setPicked(e.target.value)}
              className="h-12 px-3.5 rounded-xl border border-[rgba(244,244,245,0.12)] bg-widget text-base outline-none focus:ring-2 ring-brand"
            />
          </label>
        )}
        {(choice === "after" || choice === "date") && startDay && (
          <p className="-mt-2 text-[13px] text-muted-foreground">Starts {shortDay(startDay)}</p>
        )}
        {endsLine && <p className="-mt-2 text-[13px] text-muted-foreground">{endsLine}</p>}
        {dropsLine && <p className="-mt-2 text-[13px] text-muted-foreground">{dropsLine}</p>}

        <ChipGroup label="When it ends">
          {END_ACTIONS.map((a) => (
            <Chip key={a.value} pressed={endAction === a.value} onClick={() => setEndAction(a.value)}>{a.label}</Chip>
          ))}
        </ChipGroup>

        <label className="flex flex-col gap-2">
          <span className={LABEL}>Note to future self (optional)</span>
          <textarea
            value={endMessage}
            maxLength={500}
            onChange={(e) => setEndMessage(e.target.value)}
            placeholder="Test your 1RM"
            rows={2}
            className="px-3.5 py-3 rounded-xl border border-[rgba(244,244,245,0.12)] bg-widget text-base outline-none focus:ring-2 ring-brand resize-none placeholder:text-muted-foreground"
          />
        </label>

        <ErrorLine error={error} />
      </div>

      <PinnedBar>
        <button type="submit" disabled={loading || reason != null} aria-describedby={reason ? "build-reason" : undefined} className={PRIMARY}>
          {scheduleType === "rotation" ? "Put the sessions in order" : "Build the week"}
        </button>
        <ButtonReason id="build-reason" reason={reason} />
      </PinnedBar>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2
// ─────────────────────────────────────────────────────────────────────────────

export function CycleSetupSessions({
  cycle,
  programs,
  start,
  endurance,
  running,
  scheduled,
}: {
  cycle: TrainingCycleWithSlots;
  programs: PickerProgram[];
  /** The first day: today starts the cycle, a later day schedules it. */
  start: string;
  endurance: boolean;
  /** The running cycle and the scheduled draft: what Create ends and drops, asked first (spec, decisions). */
  running?: RunningCycle | null;
  scheduled?: ScheduledDraft | null;
}) {
  const returnTo = useReturnTo();
  // Busy from the first tap until the next page is on screen (useSubmitLock).
  const { busy: loading, lock, unlock } = useSubmitLock();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const startLines = [endsRunningLine(cycle.id, runningOn(running, start)), dropsScheduledLine(cycle.id, scheduled)].filter((l): l is string => l != null);
  const [discarding, setDiscarding] = useState(false);
  const { busy: discardBusy, lock: lockDiscard, unlock: unlockDiscard } = useSubmitLock();
  const [discardError, setDiscardError] = useState("");
  // A rest day alone is no cycle: at least one session must be in it.
  const hasSession = cycle.slots.some((s) => s.programId != null || s.workoutId != null);

  async function discard() {
    if (!lockDiscard()) return;
    setDiscardError("");
    const result = await callAction(deleteTrainingCycle(cycle.id));
    if (result.success) {
      returnTo("/cycles");
    } else {
      unlockDiscard();
      setDiscardError(result.error);
    }
  }

  async function create() {
    if (!lock()) return;
    setError("");
    const result = await callAction(startTrainingCycle(cycle.id, start));
    if (result.success) {
      returnTo(`/cycles/${cycle.id}`);
    } else {
      unlock();
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col" style={{ paddingBottom: "140px" }}>
      <FormHeader
        title="New cycle"
        sub={cycle.name}
        left={
          <button
            type="button"
            onClick={() => {
              setDiscardError("");
              setDiscarding(true);
            }}
            className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70"
          >
            Cancel
          </button>
        }
        right={
          <Link replace href={setupHref(cycle.id, start, true)} className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70">
            Back
          </Link>
        }
      />
      <div className="flex flex-col gap-[18px] px-4 pt-3">
        <StepProgress step={2} of={2} />
        <h2 className="text-[22px] font-semibold">{cycle.scheduleType === "rotation" ? "Rotation order" : "Build the week"}</h2>
        <CycleScheduleBuilder cycle={cycle} programs={programs} endurance={endurance} />
        <ErrorLine error={confirming ? null : error} />
      </div>
      <PinnedBar>
        <button
          type="button"
          onClick={() => {
            if (startLines.length === 0) return void create();
            setError("");
            setConfirming(true);
          }}
          disabled={loading || !hasSession} aria-describedby={hasSession ? undefined : "create-reason"} className={PRIMARY}>
          Create cycle
        </button>
        <ButtonReason id="create-reason" reason={hasSession ? null : "Add a session first."} />
      </PinnedBar>
      <TakeStartSheet
        open={confirming}
        title={`Start ${cycle.name} ${shortDay(start)}?`}
        lines={startLines}
        action="Create cycle"
        busy={loading}
        error={error || null}
        onConfirm={create}
        onClose={() => {
          setError("");
          setConfirming(false);
        }}
      />
      <BottomSheet open={discarding} onClose={() => setDiscarding(false)}>
        {discarding && (
          <PlanSheetPanel
            label="Discard this cycle?"
            title="Discard this cycle?"
            sub={<p className="text-sm text-muted-foreground">{cycle.name} and the sessions you added are deleted.</p>}
          >
            <ErrorLine error={discardError} />
            <button
              type="button"
              onClick={discard}
              disabled={discardBusy}
              className="h-[52px] w-full rounded-2xl bg-[#c23a2e] text-white text-base font-semibold active:opacity-80 disabled:opacity-50"
            >
              {discardBusy ? "Discarding…" : "Discard cycle"}
            </button>
            <button
              type="button"
              onClick={() => setDiscarding(false)}
              className={SHEET_CANCEL}
            >
              Keep building
            </button>
          </PlanSheetPanel>
        )}
      </BottomSheet>
    </div>
  );
}
