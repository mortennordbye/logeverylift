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
import { PlanSheetPanel } from "@/components/features/PlanSheetPanel";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useBack, useReturnTo } from "@/components/ui/BackLink";
import { createTrainingCycle, deleteTrainingCycle, startTrainingCycle, updateTrainingCycle } from "@/lib/actions/training-cycles";
import { addDays, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";
import { choiceFor, startDayFor, type StartChoice, type StartDays } from "@/lib/utils/cycle-setup";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { MAX_CYCLE_WEEKS, MIN_CYCLE_WEEKS } from "@/lib/validators/training-cycles";
import type { TrainingCycle, TrainingCycleWithSlots } from "@/types/workout";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type ScheduleType = "day_of_week" | "rotation";
type EndAction = "none" | "deload" | "new_cycle" | "rest";

const MAIN_LENGTHS = [4, 6, 8, 12];

const MODES: { value: ScheduleType; title: string; sub: string }[] = [
  { value: "day_of_week", title: "Same days each week", sub: "Monday upper, Thursday lower" },
  { value: "rotation", title: "Rotation", sub: "The next session follows the last one. No fixed days." },
];

const END_ACTIONS: { value: EndAction; label: string }[] = [
  { value: "none", label: "Just stop" },
  { value: "deload", label: "Deload week" },
  { value: "new_cycle", label: "Start a new cycle" },
  { value: "rest", label: "Rest period" },
];

const SECTION = "text-xs font-semibold tracking-[1px] uppercase text-muted-foreground";
const TINT = "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)]";

/** A setup URL: step 2 of `cycleId`, or step 1 of it with `step1`. */
export function setupHref(cycleId: number, start: string, step1 = false): string {
  return `/cycles/new?cycle=${cycleId}&start=${start}${step1 ? "&step=1" : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared parts
// ─────────────────────────────────────────────────────────────────────────────

function SetupHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pt-4 shrink-0">
      <div className="justify-self-start">{left}</div>
      <h1 className="text-base font-semibold">New cycle</h1>
      <div className="justify-self-end">{right}</div>
    </header>
  );
}

function StepProgress({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={SECTION}>Step {step} of 2</span>
      <div
        className="grid grid-cols-2 gap-1 h-1"
        role="progressbar"
        aria-label={`Step ${step} of 2`}
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={step}
      >
        <div className="rounded-sm bg-brand" />
        <div className={`rounded-sm ${step === 2 ? "bg-brand" : "bg-[#707076]"}`} />
      </div>
    </div>
  );
}

/** The pinned bottom bar with one primary button. It covers the tab bar. */
function PinnedBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 bg-[#111113] border-t border-hairline px-4 pt-4"
      style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom, 0px))" }}
    >
      {children}
    </div>
  );
}

const PRIMARY =
  "h-[52px] w-full rounded-2xl bg-brand text-primary-foreground text-base font-semibold active:opacity-80 disabled:opacity-50";

function Chip({ label, on, onClick, disabled }: { label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`h-11 px-3.5 rounded-full border text-sm font-medium active:opacity-70 disabled:opacity-40 ${
        on ? `border-brand ${TINT} text-foreground` : "border-[rgba(244,244,245,0.12)] text-[#c4c4c9]"
      }`}
    >
      {label}
    </button>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
      <legend className={`mb-2 ${SECTION}`}>{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1
// ─────────────────────────────────────────────────────────────────────────────

export function CreateCycleForm({
  days,
  draft,
  start,
}: {
  days: StartDays;
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
  const [choice, setChoice] = useState<StartChoice>(() => {
    const c = start ? choiceFor(start, days) : "today";
    return c === "after" && !days.afterCurrent ? "today" : c;
  });
  const [picked, setPicked] = useState(start && choiceFor(start, days) === "date" ? start : "");
  const [endAction, setEndAction] = useState<EndAction>((draft?.endAction as EndAction) ?? "none");
  const [endMessage, setEndMessage] = useState(draft?.endMessage ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startDay = startDayFor(choice, days, picked);
  const tomorrow = toDateStr(addDays(parseDateStr(days.today), 1));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !startDay || !weeksOk) return;
    setLoading(true);
    setError("");

    const fields = { name: name.trim(), durationWeeks: weeks, endAction };
    const result = draft
      ? await callAction(updateTrainingCycle({ id: draft.id, ...fields, endMessage: endMessage.trim() || null }))
      : await callAction(createTrainingCycle({ ...fields, scheduleType, endMessage: endMessage.trim() || undefined }));

    if (result.success) {
      router.replace(setupHref(result.data.id, startDay));
    } else {
      setLoading(false);
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" style={{ paddingBottom: "calc(140px + var(--kb-height, 0px))" }}>
      <SetupHeader
        left={
          <button type="button" onClick={cancel.go} className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70">
            Cancel
          </button>
        }
      />

      <div className="flex flex-col gap-[22px] px-4 pt-3">
        <StepProgress step={1} />

        <label className="flex flex-col gap-2">
          <span className={SECTION}>Name</span>
          <input
            autoFocus={!draft}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="Upper / Lower hypertrophy"
            className="h-12 px-3.5 rounded-xl border border-[rgba(244,244,245,0.12)] bg-widget text-base outline-none focus:ring-2 ring-brand placeholder:text-muted-foreground"
          />
        </label>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className={`mb-2 ${SECTION}`}>How do you train?</legend>
          {MODES.map((m) => {
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
              label={`${w} weeks`}
              on={!moreLengths && durationWeeks === w}
              onClick={() => {
                setMoreLengths(false);
                setDurationWeeks(w);
              }}
            />
          ))}
          <Chip label="Custom" on={moreLengths} onClick={() => setMoreLengths(true)} />
        </ChipGroup>
        {moreLengths && (
          <label className="flex flex-col gap-2 -mt-2">
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
                className="h-12 w-24 px-3.5 rounded-xl border border-[rgba(244,244,245,0.12)] bg-widget text-base outline-none focus:ring-2 ring-brand aria-[invalid=true]:border-[#ff6b5a]"
              />
              <span className="text-base text-[#c4c4c9]">weeks</span>
            </span>
          </label>
        )}

        <ChipGroup label="Start">
          <Chip label="Today" on={choice === "today"} onClick={() => setChoice("today")} />
          <Chip label={`Next Monday · ${shortDay(days.nextMonday).slice(4)}`} on={choice === "monday"} onClick={() => setChoice("monday")} />
          <Chip label="Pick a date" on={choice === "date"} onClick={() => setChoice("date")} />
          {days.afterCurrent && <Chip label="After current cycle" on={choice === "after"} onClick={() => setChoice("after")} />}
        </ChipGroup>
        {choice === "date" && (
          <label className="flex flex-col gap-2 -mt-2">
            <span className="text-[13px] text-muted-foreground">Start day</span>
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
        {choice === "after" && days.afterCurrent && (
          <p className="-mt-2 text-[13px] text-muted-foreground">Starts {shortDay(days.afterCurrent)}</p>
        )}

        <ChipGroup label="When it ends">
          {END_ACTIONS.map((a) => (
            <Chip key={a.value} label={a.label} on={endAction === a.value} onClick={() => setEndAction(a.value)} />
          ))}
        </ChipGroup>

        <label className="flex flex-col gap-2">
          <span className={SECTION}>Note to future self (optional)</span>
          <textarea
            value={endMessage}
            maxLength={500}
            onChange={(e) => setEndMessage(e.target.value)}
            placeholder="Test your 1RM"
            rows={2}
            className="px-3.5 py-3 rounded-xl border border-[rgba(244,244,245,0.12)] bg-widget text-base outline-none focus:ring-2 ring-brand resize-none placeholder:text-muted-foreground"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-[#ff6b5a]">
            {error}
          </p>
        )}
      </div>

      <PinnedBar>
        <button type="submit" disabled={loading || !name.trim() || !startDay || !weeksOk} className={PRIMARY}>
          {scheduleType === "rotation" ? "Put the sessions in order" : "Build the week"}
        </button>
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
}: {
  cycle: TrainingCycleWithSlots;
  programs: PickerProgram[];
  /** The first day: today starts the cycle, a later day schedules it. */
  start: string;
  endurance: boolean;
}) {
  const returnTo = useReturnTo();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState("");

  async function discard() {
    setDiscardBusy(true);
    setDiscardError("");
    const result = await callAction(deleteTrainingCycle(cycle.id));
    if (result.success) {
      returnTo("/cycles");
    } else {
      setDiscardBusy(false);
      setDiscardError(result.error);
    }
  }

  async function create() {
    setLoading(true);
    setError("");
    const result = await callAction(startTrainingCycle(cycle.id, start));
    if (result.success) {
      returnTo(`/cycles/${cycle.id}`);
    } else {
      setLoading(false);
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col" style={{ paddingBottom: "140px" }}>
      <SetupHeader
        left={
          <Link replace href={setupHref(cycle.id, start, true)} className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70">
            ‹ Back
          </Link>
        }
        right={
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
      />
      <div className="flex flex-col gap-[18px] px-4 pt-3">
        <StepProgress step={2} />
        <h2 className="text-[22px] font-semibold">{cycle.scheduleType === "rotation" ? "Rotation order" : "Build the week"}</h2>
        <CycleScheduleBuilder cycle={cycle} programs={programs} endurance={endurance} />
        {error && (
          <p role="alert" className="text-sm text-[#ff6b5a]">
            {error}
          </p>
        )}
      </div>
      <PinnedBar>
        <button type="button" onClick={create} disabled={loading} className={PRIMARY}>
          Create cycle
        </button>
      </PinnedBar>
      <BottomSheet open={discarding} onClose={() => setDiscarding(false)}>
        {discarding && (
          <PlanSheetPanel label="Discard this cycle?">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">Discard this cycle?</h2>
              <p className="text-sm text-muted-foreground">{cycle.name} and the sessions you added are deleted.</p>
            </div>
            {discardError && (
              <p role="alert" className="text-sm text-[#ff6b5a]">
                {discardError}
              </p>
            )}
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
              className="min-h-11 text-[15px] font-medium text-muted-foreground active:opacity-70"
            >
              Keep building
            </button>
          </PlanSheetPanel>
        )}
      </BottomSheet>
    </div>
  );
}
