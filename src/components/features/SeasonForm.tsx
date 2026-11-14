"use client";

import { createSeasonAction, deleteSeasonAction, updateSeasonAction } from "@/lib/actions/seasons";
import { generateTriathlonPlan } from "@/lib/actions/triathlon-plan";
import { callAction } from "@/lib/utils/stale-bundle";
import { keepDates } from "@/lib/utils/keep-dates";
import { PHASE_TYPE_LABELS, dayLabel, lengthShort, rangeLabel, shortDay, type RaceDiscipline, type RacePriority, type TriDistance } from "@/lib/utils/seasons";
import { triathlonPhases } from "@/lib/utils/triathlon-phases";
import type { ScheduledDraft } from "@/lib/utils/cycle-start";
import { takeStartLines, type RunningBlock } from "@/lib/utils/season-start";
import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { TakeStartSheet } from "@/components/features/TakeStartSheet";
import { useBack, useLeaveDeleted, useReturnTo } from "@/components/ui/BackLink";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  ButtonReason,
  DESTRUCTIVE_TEXT,
  ErrorLine,
  FIELD,
  FormHeader,
  INNER_FIELD,
  LABEL,
  PRIMARY_BUTTON,
  PinnedBar,
  RaceKindChips,
  RacePriorityRow,
  RadioCard,
  SelectField,
  TriDistanceOptions,
} from "@/components/features/season-ui";
import Link from "next/link";
import { useState } from "react";

type Initial = { id: number; name: string; goal: string | null; startDate: string; endDate: string; nextGoal: string | null };
export type PhaseSource = "later" | "cycles" | "triathlon";
type Candidate = { id: number; name: string; status: string };

type Props =
  | { initial: Initial }
  | {
      initial?: undefined;
      /** The suggested first day: the next Monday, or today on a Monday. */
      defaultStart: string;
      enduranceEnabled: boolean;
      /** The intake interview is done: a triathlon plan starts with it (D10). */
      interviewDone: boolean;
      /** Cycles in no season, newest first. */
      candidates: Candidate[];
      initialSource?: PhaseSource;
      /** The user's today, YYYY-MM-DD. */
      today: string;
      /** What a first phase that takes the scheduled start ends and drops (takeStartLines). */
      running: RunningBlock | null;
      scheduled: ScheduledDraft | null;
    };

const STATUS_WORD: Record<string, string> = { active: "Running now", draft: "Not started" };

/** "Mon 16 Nov 2026". */
const longDay = (d: string) => `${shortDay(d)} ${d.slice(0, 4)}`;

/**
 * New season (J4_SeasonSetup) and Edit season. A new season takes an optional
 * first race (endurance only), ends on the A race day unless the user picks
 * another end, and says where its phases come from: later, cycles the user
 * already has, or a triathlon plan made from the race date.
 */
export function SeasonForm(props: Props) {
  const initial = props.initial;
  const create = props.initial ? null : props;
  const returnTo = useReturnTo();
  const leaveDeleted = useLeaveDeleted();
  const cancel = useBack(initial ? { href: `/seasons/${initial.id}`, label: "Season" } : { href: "/cycles", label: "Plan" });

  const [name, setName] = useState(initial?.name ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [nextGoal, setNextGoal] = useState(initial?.nextGoal ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? create?.defaultStart ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [endPicked, setEndPicked] = useState(!!initial);
  const [editing, setEditing] = useState<"start" | "end" | null>(null);

  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [discipline, setDiscipline] = useState<RaceDiscipline>("triathlon");
  const [distance, setDistance] = useState<TriDistance>("half");
  const [km, setKm] = useState("");
  const [priority, setPriority] = useState<RacePriority>("A");

  const [source, setSource] = useState<PhaseSource>(create?.initialSource ?? "later");
  const [picked, setPicked] = useState<number[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const showRace = !!create?.enduranceEnabled;
  const hasRace = showRace && (raceName.trim() !== "" || raceDate !== "");
  const raceComplete = raceName.trim() !== "" && raceDate !== "";
  // The A race day is the end, until the user picks another one.
  const raceEnd = hasRace && priority === "A" && raceDate ? raceDate : null;
  const end = !endPicked && raceEnd ? raceEnd : endDate;

  // The triathlon plan: a triathlon A race with a distance and a date.
  const triReady = discipline === "triathlon" && priority === "A" && raceComplete;
  const triPhases = triReady && startDate ? triathlonPhases(startDate, { raceDate, discipline, distance, distanceMeters: null }) : null;
  const triSub = !create?.interviewDone
    ? null
    : !triReady
      ? "Add a triathlon A race above first."
      : typeof triPhases === "string"
        ? triPhases
        : "Phases from the start date to race day, made for you.";
  const triBlocked = !create?.interviewDone || !triReady || typeof triPhases === "string";

  const valid =
    name.trim() !== "" &&
    startDate !== "" &&
    (source === "triathlon" ? !triBlocked : end !== "" && end >= startDate) &&
    (!hasRace || raceComplete) &&
    (source !== "cycles" || picked.length > 0);
  // Why the button is off, in the order of the form.
  const reason = valid
    ? null
    : name.trim() === ""
      ? "Give the season a name."
      : startDate === ""
        ? "Pick a start day."
        : hasRace && raceName.trim() === ""
          ? "Give the race a name."
          : hasRace && raceDate === ""
            ? "Pick the race day."
            : source === "triathlon"
              ? !create?.interviewDone
                ? "Answer the athlete questions first."
                : typeof triPhases === "string"
                  ? triPhases
                  : "Add a triathlon A race first."
              : end === ""
                ? "Pick an end day."
                : end < startDate
                  ? "Pick an end day after the start."
                  : "Pick at least one cycle.";

  // Phases made now start the season on its start day, taking the one
  // scheduled start: the user confirms what that ends and drops first.
  const [confirmStart, setConfirmStart] = useState(false);
  const startLines =
    create && source !== "later" && startDate > create.today
      ? takeStartLines({ seasonId: null, day: startDate, running: create.running, scheduled: create.scheduled, joining: source === "cycles" ? picked : [] })
      : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    if (startLines.length > 0) {
      setError("");
      setConfirmStart(true);
      return;
    }
    await save(false);
  }

  async function save(takeStart: boolean) {
    const take = takeStart ? { takeStart: true } : {};
    setLoading(true);
    setError("");
    const fields = { name: name.trim(), goal: goal.trim() || null, startDate };
    if (initial) {
      const result = await callAction(updateSeasonAction({ seasonId: initial.id, ...fields, endDate: end, nextGoal: nextGoal.trim() || null }));
      setLoading(false);
      if (!result.success) return setError(result.error);
      return returnTo(`/seasons/${initial.id}`);
    }
    if (source === "triathlon") {
      const result = await callAction(generateTriathlonPlan({ ...fields, race: { name: raceName.trim(), raceDate, distance }, ...take }));
      setLoading(false);
      if (!result.success) return setError(result.error);
      return returnTo(`/seasons/${result.data.seasonId}`);
    }
    const race = hasRace
      ? {
          name: raceName.trim(),
          raceDate,
          discipline,
          distance: discipline === "triathlon" ? distance : null,
          distanceMeters: discipline !== "triathlon" && km ? Math.round(Number(km) * 1000) : null,
          priority,
        }
      : undefined;
    const result = await callAction(
      createSeasonAction({ ...fields, endDate: end, ...(race ? { race } : {}), ...(source === "cycles" ? { cycleIds: picked } : {}), ...take }),
    );
    setLoading(false);
    if (!result.success) return setError(result.error);
    returnTo(`/seasons/${result.data.id}`);
  }

  async function handleDelete() {
    if (!initial) return;
    setLoading(true);
    const result = await callAction(deleteSeasonAction({ seasonId: initial.id }));
    setLoading(false);
    if (!result.success) return setError(result.error);
    leaveDeleted("/cycles", [`/seasons/${initial.id}`]);
  }

  const togglePick = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <form onSubmit={handleSubmit} className="flex flex-col pb-40">
      <FormHeader
        title={initial ? "Edit season" : "New season"}
        left={
          <button type="button" onClick={cancel.go} className="min-h-11 px-2 text-base text-primary active:opacity-70">
            Cancel
          </button>
        }
      />

      <div className="flex flex-col gap-5 px-4 pt-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="season-name" className={LABEL}>
            Name
          </label>
          <input id="season-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Half distance 2027" className={`${FIELD} font-medium`} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="season-goal" className={LABEL}>
            Goal
          </label>
          <textarea
            id="season-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Bench 120 kg by summer, or finish a half Ironman"
            className={`${FIELD} resize-none py-3 text-[15px]`}
          />
        </div>

        {initial && (
          <div className="flex flex-col gap-2">
            <label htmlFor="season-next" className={LABEL}>
              Next goal
            </label>
            <input id="season-next" value={nextGoal} onChange={(e) => setNextGoal(e.target.value)} maxLength={500} placeholder="Full distance in 2028" className={FIELD} />
          </div>
        )}

        {showRace && (
          <section aria-labelledby="race-label" className="flex flex-col gap-3 rounded-[20px] bg-widget p-4">
            <h2 id="race-label" className={LABEL}>
              Race (optional)
            </h2>
            {/* One column below 360 px: a half-width date field cut the year. */}
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" data-testid="race-fields">
              <input aria-label="Race name" value={raceName} maxLength={100} onChange={(e) => setRaceName(e.target.value)} placeholder="Race name" className={`${INNER_FIELD} min-[360px]:col-span-2`} />
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Date</span>
                <input aria-label="Race date" type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} className={INNER_FIELD} />
              </label>
              {discipline === "triathlon" ? (
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL}>Distance</span>
                  <SelectField value={distance} onChange={(v) => setDistance(v as TriDistance)}>
                    <TriDistanceOptions />
                  </SelectField>
                </label>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL}>Distance · km</span>
                  <input aria-label="Distance in km" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} className={INNER_FIELD} />
                </label>
              )}
            </div>
            <RaceKindChips value={discipline} onChange={setDiscipline} />
            <RacePriorityRow value={priority} onChange={setPriority} />
            {hasRace && !raceComplete && <p className="text-[13px] text-muted-foreground">Give the race a name and a date, or leave both empty.</p>}
          </section>
        )}

        <section className="flex flex-col overflow-hidden rounded-[20px] bg-widget">
          <DateRow
            label="Start"
            value={startDate}
            text={startDate ? longDay(startDate) : "Not set"}
            open={editing === "start"}
            onToggle={() => setEditing(editing === "start" ? null : "start")}
            onChange={setStartDate}
          />
          <div className="h-px bg-hairline" />
          {source === "triathlon" && !initial ? (
            <div className="flex min-h-[52px] items-center justify-between px-4">
              <span className="text-[15px]">End</span>
              <span className="text-[15px] text-foreground/75">{raceDate ? `${dayLabel(raceDate)} · race day` : "Race day"}</span>
            </div>
          ) : (
            <DateRow
              label="End"
              value={end}
              min={startDate || undefined}
              text={end ? `${dayLabel(end)}${end === raceEnd ? " · race day" : ""}` : "Not set"}
              open={editing === "end"}
              onToggle={() => setEditing(editing === "end" ? null : "end")}
              onChange={(v) => {
                setEndDate(v);
                setEndPicked(true);
              }}
            />
          )}
        </section>

        {create && (
          <fieldset className="flex flex-col gap-2">
            <legend className={`${LABEL} mx-1 mb-2`}>Phases</legend>
            <RadioCard name="phase-source" checked={source === "later"} onChange={() => setSource("later")} title="Add phases later" sub="Start with an empty season." />
            <RadioCard
              name="phase-source"
              checked={source === "cycles"}
              onChange={() => setSource("cycles")}
              title="Use cycles I already have"
              sub={create.candidates.length ? "Pick cycles, the active one too." : "You have no cycles outside a season yet."}
              disabled={create.candidates.length === 0}
            />
            {source === "cycles" && (
              <ul aria-label="Your cycles" className="flex flex-col overflow-hidden rounded-2xl bg-widget">
                {create.candidates.map((c) => {
                  const at = picked.indexOf(c.id);
                  return (
                    <li key={c.id} className="border-b border-hairline last:border-0">
                      <label className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:opacity-80">
                        <input type="checkbox" checked={at >= 0} onChange={() => togglePick(c.id)} className="h-5 w-5 accent-[var(--brand)]" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[15px] font-medium">{c.name}</span>
                          <span className="text-[13px] text-muted-foreground">{STATUS_WORD[c.status] ?? c.status}</span>
                        </span>
                        {at >= 0 && <span className="text-xs font-semibold text-primary">Phase {at + 1}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {create.enduranceEnabled &&
              (create.interviewDone ? (
                <RadioCard
                  name="phase-source"
                  checked={source === "triathlon"}
                  onChange={() => setSource("triathlon")}
                  title="Make a triathlon plan"
                  sub={triSub}
                  disabled={!triReady && source !== "triathlon"}
                >
                  {source === "triathlon" && Array.isArray(triPhases) && (
                    <ol aria-label="Planned phases" className="ml-[34px] flex flex-col gap-1 text-[13px] text-foreground/75">
                      {triPhases.map((p) => (
                        <li key={p.phaseType}>
                          {keepDates(`${PHASE_TYPE_LABELS[p.phaseType]} · ${lengthShort(p)} · ${rangeLabel(p.start, p.end)}`)}
                        </li>
                      ))}
                    </ol>
                  )}
                </RadioCard>
              ) : (
                <Link href="/more/athlete/interview?next=/seasons/new" className="flex min-h-11 flex-col gap-0.5 rounded-2xl bg-widget px-4 py-3.5 active:opacity-80">
                  <span className="text-[15px] font-semibold">Make a triathlon plan</span>
                  <span className="text-[13px] text-muted-foreground">Answer the athlete questions first. Then the plan fits your days and level.</span>
                </Link>
              ))}
          </fieldset>
        )}

        {!confirmStart && <ErrorLine error={error} />}

        {initial && (
          <button type="button" onClick={() => setConfirmDelete(true)} className={`min-h-11 text-sm font-medium ${DESTRUCTIVE_TEXT} active:opacity-70`}>
            Delete season
          </button>
        )}
      </div>

      <PinnedBar>
        <button type="submit" disabled={loading || !valid} aria-describedby={reason ? "season-reason" : undefined} className={PRIMARY_BUTTON}>
          {loading ? "Saving…" : initial ? "Save" : "Create season"}
        </button>
        <ButtonReason id="season-reason" reason={reason} />
      </PinnedBar>

      {initial && (
        <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
          <PlanSheetPanel
            label="Delete this season?"
            title="Delete this season?"
            sub={<p className="text-sm text-muted-foreground">{keepDates("Its cycles stay. You can restore it from Recently deleted for 90 days.")}</p>}
          >
            <button type="button" onClick={handleDelete} disabled={loading} className="min-h-[52px] rounded-2xl bg-[#c23a2e] text-base font-semibold text-white active:opacity-80">
              Delete season
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={SHEET_CANCEL}>
              Cancel
            </button>
          </PlanSheetPanel>
        </BottomSheet>
      )}
      {create && (
        <TakeStartSheet
          open={confirmStart}
          title={`Start this season ${shortDay(startDate)}?`}
          lines={startLines}
          action="Create season"
          busy={loading}
          error={error || null}
          onConfirm={() => save(true)}
          onClose={() => {
            setError("");
            setConfirmStart(false);
          }}
        />
      )}
      <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
    </form>
  );
}

/** A date row: the day in words and "Change", which shows the date field. */
function DateRow({
  label,
  value,
  text,
  open,
  min,
  onToggle,
  onChange,
}: {
  label: string;
  value: string;
  text: string;
  open: boolean;
  min?: string;
  onToggle: () => void;
  onChange: (v: string) => void;
}) {
  const id = `season-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col px-4">
      <div className="flex min-h-[52px] items-center justify-between gap-3">
        <span className="text-[15px]">{label}</span>
        <span className="flex items-center gap-2.5">
          <span className="text-[15px] text-foreground/75">{keepDates(text)}</span>
          <button type="button" aria-expanded={open} aria-controls={id} aria-label={`Change ${label.toLowerCase()}`} onClick={onToggle} className="min-h-11 text-sm text-primary active:opacity-70">
            Change
          </button>
        </span>
      </div>
      {open && (
        <input id={id} type="date" aria-label={`${label} date`} value={value} min={min} onChange={(e) => onChange(e.target.value)} className={`${INNER_FIELD} mb-3`} />
      )}
    </div>
  );
}
