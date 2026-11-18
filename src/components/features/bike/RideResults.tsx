"use client";

/**
 * The ride results table (docs/plans/bike-ride-logger.md, section 5 "Ride
 * results", D13): one row per step after the ride, with the time the clock
 * saved and Avg W and Avg HR to type if the rider wants to. "More numbers"
 * adds max HR and cadence indoors, or max HR, distance, speed and climbing
 * outdoors. Effort once per ride. Done saves through the set logging path
 * (offline queue included), each typed field marked typed; "Later" leaves it.
 *
 * "Log by hand" (`hand`) is the same table with no ride: each step takes a
 * time, which starts at the plan's.
 */

import { BackLink } from "@/components/ui/BackLink";
import { useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import type { RideMode } from "@/db/schema/rides";
import {
  badField,
  fieldLabel,
  fieldText,
  handUnlogs,
  moreNumbersText,
  parseStepTime,
  resultFields,
  resultPayloads,
  rideEffort,
  riddenText,
  type ResultEdits,
  type ResultField,
  type ResultStep,
} from "@/lib/utils/ride-results";
import { rideClock } from "@/lib/utils/ride-screen";
import type { Units } from "@/lib/utils/units";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const FIELD = "h-11 min-w-0 rounded-lg bg-background px-2 text-base tabular-nums aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-foreground";
const INPUT = `${FIELD} w-full text-right`;

export function RideResults({
  programId,
  exerciseId,
  steps,
  mode,
  setNumbers,
  sessionId: serverSessionId,
  sessionStart = null,
  hand,
  garminWaiting,
  laterHref,
  units,
}: {
  programId: number;
  exerciseId: number;
  steps: ResultStep[];
  mode: RideMode;
  setNumbers: Record<number, number>;
  /** The ride's workout session; by hand, the open workout the table read (else the phone's). */
  sessionId: number | null;
  /** By hand: when that workout started, to point the phone's active workout at it. */
  sessionStart?: string | null;
  hand: boolean;
  garminWaiting: boolean;
  /** Where "Later" goes. */
  laterHref: string;
  units: Units;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const workoutSession = useWorkoutSession();
  const { logWithRetry, unlogWithRetry } = useWorkoutSetWriter();
  const fields = resultFields(mode);
  const [edits, setEdits] = useState<ResultEdits>({});
  const [more, setMore] = useState(false);
  const [effort, setEffort] = useState<number | null>(rideEffort(steps));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = (s: ResultStep, f: ResultField | "time"): string => {
    const e = edits[s.programSetId]?.[f];
    if (e !== undefined) return e;
    if (f === "time") {
      const t = s.log?.durationSeconds ?? s.plannedSeconds;
      return t ? rideClock(t) : "";
    }
    return fieldText(f, s.log?.[f] ?? null, units);
  };
  const edit = (id: number, f: ResultField | "time", text: string) => setEdits((all) => ({ ...all, [id]: { ...all[id], [f]: text } }));
  /** A step that can take numbers: ridden, or by hand any step. */
  const open = (s: ResultStep) => hand || (!!s.log && s.log.status !== "skipped" && (s.log.durationSeconds ?? 0) > 0);
  const bad = steps.some((s) => {
    const e = edits[s.programSetId] ?? {};
    return [...fields.main, ...fields.more].some((f) => badField(f, e[f], units)) || (e.time !== undefined && parseStepTime(e.time, s.plannedSeconds) === undefined);
  });

  async function done() {
    if (saving || bad) return;
    // The session the table read; by hand with none open on the server, the phone's.
    const sessionId = serverSessionId ?? (hand ? workoutSession?.sessionId : null) ?? null;
    if (sessionId == null) {
      setError("The workout is still starting. Try again in a moment.");
      return;
    }
    setSaving(true);
    setError(null);
    // By hand the phone follows the workout the rows go to.
    if (hand && serverSessionId != null && sessionStart && workoutSession && workoutSession.sessionId !== serverSessionId) {
      workoutSession.setActiveWorkout(programId, sessionStart, serverSessionId);
    }
    const payloads = resultPayloads(steps, edits, effort, { sessionId, exerciseId, setNumbers, units }, hand);
    // In order, one at a time: a failed write goes to the offline queue and is sent later.
    if (hand) for (const id of handUnlogs(steps, edits)) await unlogWithRetry({ sessionId, exerciseId, setNumber: setNumbers[id] ?? 1, programSetId: id });
    for (const p of payloads) await logWithRetry(p);
    // Replace: Back from the workout does not come back to the filled table.
    if (hand) router.replace(`/programs/${programId}/workout`);
    else {
      router.replace(pathname);
      router.refresh();
    }
  }

  const cell = (s: ResultStep, f: ResultField, label: string) => {
    const text = value(s, f);
    const invalid = badField(f, edits[s.programSetId]?.[f], units);
    return (
      <input
        inputMode={f === "distanceMeters" || f === "avgSpeed" ? "decimal" : "numeric"}
        value={text}
        placeholder="–"
        disabled={!open(s)}
        onChange={(e) => edit(s.programSetId, f, e.target.value)}
        aria-label={`${label} step ${s.n}`}
        aria-invalid={invalid}
        className={`${INPUT} disabled:bg-transparent disabled:placeholder:text-muted-foreground/50`}
        data-testid={`result-${f}-${s.n}`}
      />
    );
  };

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="ride-results">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
        {!hand && (
          <Link href={laterHref} className="text-primary text-sm font-medium min-h-11 px-1 inline-flex items-center active:opacity-70" data-testid="results-later">
            Later
          </Link>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ride results</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hand ? "Type the time of each step you rode. Numbers are optional." : "Times are saved. Numbers are optional."}
          </p>
        </div>

        {garminWaiting && (
          <div className="flex items-center rounded-xl bg-muted px-4 min-h-12 text-sm text-muted-foreground" data-testid="garmin-waiting">
            Waiting for your Garmin ride. It fills the numbers.
          </div>
        )}

        <div className="rounded-2xl bg-muted" data-testid="results-table">
          <div className="grid grid-cols-[minmax(0,1fr)_68px_68px] gap-2 px-3 pt-2.5 pb-1 text-xs text-muted-foreground" aria-hidden>
            <span>Step</span>
            {fields.main.map((f) => (
              <span key={f} className="text-right">
                {fieldLabel(f, units)}
              </span>
            ))}
          </div>
          <ol className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.key} className="px-3 py-2" data-testid="result-row">
                <div className="grid grid-cols-[minmax(0,1fr)_68px_68px] items-center gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{s.title}</p>
                    {hand ? (
                      <input
                        inputMode="numeric"
                        value={value(s, "time")}
                        placeholder="Minutes"
                        onChange={(e) => edit(s.programSetId, "time", e.target.value)}
                        aria-label={`Time step ${s.n}`}
                        aria-invalid={edits[s.programSetId]?.time !== undefined && parseStepTime(edits[s.programSetId]!.time!, s.plannedSeconds) === undefined}
                        className={`${FIELD} mt-1 w-20`}
                        data-testid={`result-time-${s.n}`}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground tabular-nums" data-testid={`result-time-${s.n}`}>
                        {riddenText(s.log)}
                      </p>
                    )}
                  </div>
                  {fields.main.map((f) => (
                    <div key={f}>{cell(s, f, fieldLabel(f, units))}</div>
                  ))}
                </div>
                {more && open(s) && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {fields.more.map((f) => (
                      <label key={f} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {fieldLabel(f, units)}
                        {cell(s, f, fieldLabel(f, units))}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="min-h-11 self-start text-sm font-medium text-primary active:opacity-70"
          data-testid="more-numbers"
        >
          {more ? "Fewer numbers" : moreNumbersText(mode)}
        </button>

        <div>
          <p className="mb-2 text-sm font-semibold">How hard was the ride</p>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Effort of the ride">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={effort === n}
                onClick={() => setEffort(effort === n ? null : n)}
                className={`min-h-11 rounded-xl text-base font-semibold active:opacity-70 ${effort === n ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">1 is very easy, 10 is all out.</p>
        </div>
      </div>

      <div data-pinned-bar className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-1 border-t border-border bg-background">
        {(error || bad) && (
          <p role="alert" className="text-sm text-center text-muted-foreground">
            {error ?? "Check the marked numbers."}
          </p>
        )}
        <button
          type="button"
          onClick={() => void done()}
          disabled={saving || bad}
          className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
          data-testid="results-done"
        >
          {saving ? "Saving" : "Done"}
        </button>
      </div>
    </div>
  );
}
