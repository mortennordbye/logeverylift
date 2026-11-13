"use client";

/**
 * "Did you do it?" (docs/plans/workouts-and-compliance.md, 6.5 and 7): the
 * Yes and Missed answers to a past endurance session, the sheet that logs a
 * "Yes", and the band label the calendar shows. The home card and the
 * calendar day sheet share them. Endurance features only (D18).
 */

import type { AnswerSession } from "@/components/features/answer-session";
import { IllnessSheet, type IllnessDraft } from "@/components/features/IllnessSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useUnits } from "@/contexts/user-settings-context";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { confirmPlannedDone } from "@/lib/actions/workouts-compliance";
import { normalizeDecimal } from "@/lib/utils/format";
import type { ComplianceBand, SessionState } from "@/lib/utils/session-compliance";
import { callAction } from "@/lib/utils/stale-bundle";
import { fieldToMeters, fieldUnit } from "@/lib/utils/units";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * A typed time as seconds: whole minutes ("45") or hours and minutes
 * ("1:30"). Null when it is not one of those, or under a minute.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  let minutes: number | null = null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
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
              <span className="text-xs text-muted-foreground">Time (minutes, or h:mm)</span>
              <input value={time} onChange={(e) => setTime(e.target.value)} inputMode="numeric" placeholder="45" aria-label="Time" className={field} />
            </label>
            {time.trim() !== "" && seconds == null && <p className="text-xs text-destructive">Type minutes, such as 45, or h:mm, such as 1:30.</p>}
            <label className="block">
              <span className="text-xs text-muted-foreground">Distance in {unit} (optional)</span>
              <input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" aria-label="Distance" className={field} />
            </label>
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
              disabled={saving || seconds == null || distanceBad}
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
