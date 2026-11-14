"use client";

/**
 * "Did you do it?" (docs/plans/workouts-and-compliance.md, 6.5 and 7): the
 * Yes and Missed answers to a past endurance session, the sheet that logs a
 * "Yes", and the band label the calendar shows. The home card and the
 * calendar day sheet share them. Endurance features only (D18).
 */

import type { AnswerSession } from "@/components/features/answer-session";
import { IllnessSheet, type IllnessDraft } from "@/components/features/IllnessSheet";
import { PlanSheetPanel, SectionLabel } from "@/components/features/PlanSheetPanel";
import { ButtonReason, LABEL } from "@/components/features/season-ui";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useUnits } from "@/contexts/user-settings-context";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { confirmPlannedDone } from "@/lib/actions/workouts-compliance";
import { normalizeDecimal } from "@/lib/utils/format";
import type { ComplianceBand, SessionState } from "@/lib/utils/session-compliance";
import { callAction } from "@/lib/utils/stale-bundle";
import { fieldToMeters, fieldUnit, type FieldUnit } from "@/lib/utils/units";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The distance unit in words, for a screen reader. */
const UNIT_WORD: Record<FieldUnit, string> = { m: "metres", km: "kilometres", yd: "yards", mi: "miles" };

/**
 * A typed time as seconds: whole minutes ("45") or hours and minutes
 * ("1:30", or "1.30" and "1,30" from the number keypad, which has no colon).
 * Null when it is not one of those, or under a minute.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  let minutes: number | null = null;
  const hm = /^(\d{1,2})[:.,](\d{2})$/.exec(t);
  if (/^\d{1,4}$/.test(t)) minutes = Number(t);
  else if (hm && Number(hm[2]) < 60) minutes = Number(hm[1]) * 60 + Number(hm[2]);
  if (minutes == null || minutes < 1 || minutes > 24 * 60) return null;
  return minutes * 60;
}

const BAND: Record<ComplianceBand, { dot: string; text: string }> = {
  green: { dot: "bg-emerald-500", text: "On plan" },
  yellow: { dot: "bg-yellow-400", text: "Near plan" },
  orange: { dot: "bg-orange-500", text: "Far from plan" },
  red: { dot: "bg-red-500", text: "Missed" },
  done: { dot: "bg-primary", text: "Done" },
  illness: { dot: "bg-violet-500", text: "Sick" },
};

const STATE_TEXT: Partial<Record<SessionState, string>> = {
  unconfirmed: "Not answered",
  planned: "Planned",
  skipped: "Skipped",
  sick: "Sick",
};

/** A session's band as a dot with a text label, so the colour is never the only sign. */
export function BandLabel({ band, state }: { band: ComplianceBand | null; state: SessionState }) {
  const b = band ? BAND[band] : null;
  const text = b?.text ?? STATE_TEXT[state] ?? null;
  if (!text) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="session-band">
      <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${b ? b.dot : "border border-muted-foreground"}`} />
      {text}
    </span>
  );
}

/**
 * Yes and Missed for one session. Yes opens the sheet through `onYes`;
 * Missed stores the answer here. A failed answer shows its error and leaves
 * the row as it was.
 */
export function AnswerButtons({ session, onYes, onAnswered }: { session: AnswerSession; onYes: (s: AnswerSession) => void; onAnswered: (id: number) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function missed() {
    if (pending) return;
    setPending(true);
    setError(null);
    const r = await callAction(updatePlannedSession({ op: "miss", id: session.id }));
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onAnswered(session.id);
    router.refresh();
  }

  const button = "min-h-[44px] rounded-xl px-4 text-sm font-semibold active:opacity-70 disabled:opacity-50";
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => onYes(session)} aria-label={`Yes, I did ${session.name}`} className={`${button} bg-primary text-primary-foreground`}>
          Yes
        </button>
        <button type="button" disabled={pending} onClick={missed} aria-label={`I missed ${session.name}`} className={`${button} bg-muted`}>
          Missed
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The "Yes" sheet and, from its "I was sick", the sick-period sheet with the
 * session's day as the first day. `session` null keeps both closed.
 */
export function AnswerSheets({
  session,
  today,
  onClose,
  onAnswered,
}: {
  session: AnswerSession | null;
  today: string;
  onClose: () => void;
  onAnswered: (id: number) => void;
}) {
  const router = useRouter();
  const [sick, setSick] = useState<IllnessDraft | null>(null);
  const [sickFor, setSickFor] = useState<number | null>(null);

  return (
    <>
      <ConfirmDoneSheet
        session={sick ? null : session}
        onClose={onClose}
        onSaved={(id) => {
          onAnswered(id);
          onClose();
          router.refresh();
        }}
        onSick={(s) => {
          setSickFor(s.id);
          setSick({ startedOn: s.date, endedOn: null, severity: null, notes: null });
        }}
      />
      <IllnessSheet
        draft={sick}
        today={today}
        onClose={() => {
          setSick(null);
          onClose();
        }}
        onSaved={() => {
          if (sickFor != null) onAnswered(sickFor);
          setSick(null);
          onClose();
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * The "Yes, I did it" form: time, distance, effort and notes, checked, and
 * saved as a logged session for the planned one. The fields clear when the
 * session changes. Shared by the home sheet and the cycle detail sheet.
 */
function useConfirmDone(session: AnswerSession | null, onSaved: (id: number) => void) {
  const units = useUnits();
  const [time, setTime] = useState("");
  const [distance, setDistance] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(session);
  if (session !== last) {
    setLast(session);
    if (session && session.id !== last?.id) {
      setTime("");
      setDistance("");
      setRpe(null);
      setNotes("");
      setError(null);
    }
  }

  const unit = fieldUnit(session?.sport === "swim" ? "m" : "km", units);
  const seconds = parseDuration(time);
  const distanceValue = distance.trim() ? Number(normalizeDecimal(distance.trim())) : null;
  const distanceBad = distanceValue != null && (!Number.isFinite(distanceValue) || distanceValue < 0);
  // Why Save is off.
  const reason = seconds == null ? (time.trim() === "" ? "Type a time." : "Fix the time.") : distanceBad ? "Fix the distance." : null;

  async function save() {
    if (!session || seconds == null || distanceBad) return;
    setSaving(true);
    setError(null);
    const r = await callAction(
      confirmPlannedDone({
        plannedSessionId: session.id,
        durationSeconds: seconds,
        distanceMeters: distanceValue != null && distanceValue > 0 ? fieldToMeters(distanceValue, unit) : null,
        rpe,
        notes: notes.trim() ? notes.trim() : null,
      }),
    );
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved(session.id);
  }

  return { time, setTime, distance, setDistance, rpe, setRpe, notes, setNotes, saving, setSaving, error, setError, unit, seconds, distanceBad, reason, save };
}

function ConfirmDoneSheet({
  session,
  onClose,
  onSaved,
  onSick,
}: {
  session: AnswerSession | null;
  onClose: () => void;
  onSaved: (id: number) => void;
  onSick: (s: AnswerSession) => void;
}) {
  const { time, setTime, distance, setDistance, rpe, setRpe, notes, setNotes, saving, error, unit, seconds, distanceBad, reason, save } = useConfirmDone(session, onSaved);

  const field = "mt-1 w-full min-h-[44px] rounded-xl bg-muted px-4 text-base outline-none focus:ring-2 ring-primary";
  return (
    <BottomSheet open={session !== null} onClose={onClose} blur>
      {session && (
        <div className="bg-background rounded-t-2xl max-h-[85dvh] flex flex-col" data-testid="confirm-done-sheet">
          <div className="px-4 pt-5 space-y-4 overflow-y-auto">
            <div>
              <h2 className="text-lg font-semibold">{session.name}</h2>
              {session.summary && <p className="text-sm text-muted-foreground">{session.summary}</p>}
            </div>
            <label className="block">
              <span className="text-xs text-muted-foreground">Time in minutes, or hours and minutes</span>
              <input value={time} onChange={(e) => setTime(e.target.value)} inputMode="decimal" placeholder="45" aria-label="Time" className={field} />
            </label>
            {time.trim() !== "" && seconds == null && <p className="text-xs text-destructive">Type minutes, such as 45, or hours and minutes, such as 1.30.</p>}
            <label className="block">
              <span className="text-xs text-muted-foreground">Distance in {unit} (optional)</span>
              <input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" aria-label="Distance" className={field} />
            </label>
            {distanceBad && <p className="text-xs text-destructive">{DISTANCE_BAD}</p>}
            <div role="radiogroup" aria-label="How hard (RPE)">
              <p className="text-xs text-muted-foreground mb-1">How hard, 1 to 10 (optional)</p>
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rpe === n}
                    aria-label={`RPE ${n}`}
                    onClick={() => setRpe(rpe === n ? null : n)}
                    className={`min-h-[44px] rounded-xl text-sm font-medium active:opacity-70 ${rpe === n ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              aria-label="Notes"
              placeholder="Notes (optional)"
              className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
            />
            <button type="button" onClick={() => onSick(session)} className="w-full min-h-[44px] rounded-xl bg-muted text-sm font-medium active:opacity-70">
              I was sick
            </button>
          </div>
          <div className="px-4 pt-3 pb-8 space-y-2 shrink-0">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || reason != null}
              aria-describedby={reason ? "done-reason" : undefined}
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              Save
            </button>
            <ButtonReason id="done-reason" reason={reason} />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/** Why Save is off for a distance below 0 or one that is not a number. */
const DISTANCE_BAD = "Type a distance of 0 or more.";

const SPORT_WORD: Record<NonNullable<AnswerSession["sport"]>, string> = { swim: "swim", bike: "ride", run: "run" };

/**
 * "Did you do it?" for one past session, from its row on the cycle detail
 * (docs/design/plan-redesign/J5_DidYouDoIt.dc.html). "Yes, I did it" logs it
 * with the same form and action as the home sheet; "Missed" stores the miss.
 * `session` null keeps it closed.
 */
export function DidYouDoItSheet({ session, dayLabel, onClose }: { session: AnswerSession | null; dayLabel: string; onClose: () => void }) {
  const router = useRouter();
  // Nothing is chosen until the user answers.
  const [answer, setAnswer] = useState<"yes" | "missed" | null>(null);
  const form = useConfirmDone(session, () => {
    onClose();
    router.refresh();
  });
  const { time, setTime, distance, setDistance, rpe, setRpe, notes, setNotes, saving, setSaving, error, setError, unit, seconds, distanceBad } = form;
  const reason = answer === null ? "Pick Yes or Missed." : answer === "yes" ? form.reason : null;

  async function save() {
    if (!session || answer === null) return;
    if (answer === "yes") return form.save();
    setSaving(true);
    setError(null);
    const r = await callAction(updatePlannedSession({ op: "miss", id: session.id }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onClose();
    router.refresh();
  }

  const choice = (on: boolean) =>
    `h-12 rounded-[14px] text-[15px] font-semibold active:opacity-70 ring-1 ring-inset ${on ? "ring-brand bg-[color-mix(in_oklab,var(--brand)_18%,transparent)]" : "ring-foreground/15"}`;
  const field = "h-12 w-full rounded-xl bg-widget-2 px-3 text-base text-foreground outline-none focus:ring-2 ring-brand";
  const label = "flex flex-col gap-1.5";
  return (
    <BottomSheet open={session !== null} onClose={onClose}>
      {session && (
        <PlanSheetPanel
          label="Unconfirmed session"
          testId="did-you-do-it-sheet"
          kicker={<SectionLabel>{dayLabel}</SectionLabel>}
          title={session.summary ? `${session.name} · ${session.summary}` : session.name}
          sub={<p className="text-sm text-foreground/80">No {session.sport ? SPORT_WORD[session.sport] : "workout"} found for this day. Did you do it?</p>}
        >
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={answer === "yes"} onClick={() => setAnswer("yes")} className={choice(answer === "yes")}>
              Yes, I did it
            </button>
            <button type="button" aria-pressed={answer === "missed"} onClick={() => setAnswer("missed")} className={choice(answer === "missed")}>
              Missed
            </button>
          </div>
          {answer === "yes" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className={label}>
                  <span className={LABEL}>Time</span>
                  <input value={time} onChange={(e) => setTime(e.target.value)} inputMode="decimal" placeholder="1.05" className={field} />
                </label>
                {/* As short as the Time label, so both fields line up at 320 px; the unit sits in the field. */}
                <label className={label}>
                  <span className={LABEL}>Distance</span>
                  <span className="relative">
                    <input
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      inputMode="decimal"
                      aria-label={`Distance in ${UNIT_WORD[unit]}`}
                      className={`${field} pr-12`}
                    />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base text-muted-foreground">
                      {unit}
                    </span>
                  </span>
                </label>
              </div>
              {time.trim() !== "" && seconds == null && <p className="text-xs text-destructive">Type minutes, such as 45, or hours and minutes, such as 1.30.</p>}
              {distanceBad && <p className="text-xs text-destructive">{DISTANCE_BAD}</p>}
              <fieldset className="flex flex-col gap-1.5">
                <legend className={`mb-1.5 ${LABEL}`}>Effort, 1 (easy) to 10 (max)</legend>
                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={rpe === n}
                      aria-label={`Effort ${n}`}
                      onClick={() => setRpe(rpe === n ? null : n)}
                      className={`h-11 rounded-xl text-[15px] font-semibold active:opacity-70 ${rpe === n ? "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)] ring-1 ring-inset ring-brand" : "bg-widget-2"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className={label}>
                <span className={LABEL}>Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="How did it feel?"
                  className="w-full rounded-xl bg-widget-2 px-3 py-2.5 text-base text-foreground outline-none focus:ring-2 ring-brand resize-none"
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col">
            <button
              type="button"
              onClick={save}
              disabled={saving || reason != null}
              aria-describedby={reason ? "answer-reason" : undefined}
              className="h-[52px] rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              Save
            </button>
            <ButtonReason id="answer-reason" reason={reason} />
          </div>
        </PlanSheetPanel>
      )}
    </BottomSheet>
  );
}
