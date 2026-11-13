"use client";

/**
 * The results screen (docs/plans/endurance-app.md, 5.3). After the guided
 * player it opens filled from the run saved on this phone; by hand it opens
 * with every step as planned. RPE first (asked, not required: decision 10),
 * then the session distance, then each step: planned against done, its band,
 * and an optional measured value, RPE and note. A failed save keeps
 * everything on screen and in the saved run.
 */

import { toPlaySteps, STEP_WORD, type PlayerSession } from "@/components/features/guided/types";
import { saveStepResultsAction } from "@/lib/actions/step-results";
import { formatTime } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import { compareStep, resultsAsPlanned, resultsFromRun, type PlannedRow, type StepResult } from "@/lib/utils/step-results";
import { fieldToMeters, fieldUnit, type Units } from "@/lib/utils/units";
import { PLAYER_STORAGE_KEY, restorePlayerState, type PlayerState } from "@/lib/utils/workout-player";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const BAND_TEXT: Record<string, string> = { green: "on plan", yellow: "partly", orange: "far off", red: "not done", done: "done" };
const STATUS_TEXT: Record<StepResult["status"], string> = { done: "Done", partial: "Part", skipped: "Skipped", not_done: "Not done" };
const HIT_TEXT = { in: "in range", below: "below", above: "above" } as const;

export type ResultsExisting = { steps: StepResult[]; sessionRpe: number | null; distanceMeters: number | null };

function rowsFrom(session: PlayerSession): PlannedRow[] {
  return session.steps.map((s) => ({
    key: s.key,
    type: s.type,
    round: s.round,
    text: s.text,
    plannedSeconds: s.seconds,
    plannedMeters: s.plannedMeters,
    target: s.targetText ? { low: s.targetLow, high: s.targetHigh, unit: (s.targetUnit ?? "W") as "W", text: s.targetText, missing: null } : null,
  }));
}

export function StepResultsForm({ session, units, existing, fromPlayer }: { session: PlayerSession; units: Units; existing: ResultsExisting | null; fromPlayer: boolean }) {
  const router = useRouter();
  const rows = useMemo(() => rowsFrom(session), [session]);
  const [run, setRun] = useState<PlayerState | null>(null);
  const [results, setResults] = useState<StepResult[]>(() => existing?.steps ?? resultsAsPlanned(rows));
  const [rpe, setRpe] = useState<number | null>(existing?.sessionRpe ?? null);
  const unit = fieldUnit(session.sport === "swim" ? "m" : "km", units);
  const [distance, setDistance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A finished run saved on this phone fills the form (read after mount: localStorage).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    } catch {
      raw = null;
    }
    const r = restorePlayerState(raw, { plannedSessionId: session.plannedSessionId, workoutHash: session.workoutHash, now: Date.now() });
    if (r.state?.status === "finished") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filling the form from the run saved in localStorage
      setRun(r.state);
      setResults(resultsFromRun(r.state, toPlaySteps(session.steps)));
    }
  }, [session]);

  const update = (key: string, patch: Partial<StepResult>) =>
    setResults((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        for (const k of Object.keys(patch) as (keyof StepResult)[]) if (patch[k] === undefined) delete next[k];
        return next;
      }),
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    const typed = distance.trim() === "" ? null : Number(distance.replace(",", "."));
    const res = await callAction(
      saveStepResultsAction({
        plannedSessionId: session.plannedSessionId,
        steps: results,
        sessionRpe: rpe,
        distanceMeters: typed !== null && Number.isFinite(typed) && typed > 0 ? fieldToMeters(typed, unit) : null,
        source: run ? "player" : "manual",
        clientKey: run?.clientKey ?? null,
        startedAt: run?.startedAt ?? null,
        finishedAt: run?.finishedAt ?? null,
        pausedSeconds: run ? Math.round(run.pausedTotalMs / 1000) : 0,
      }),
    );
    setSaving(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (run) {
      try {
        localStorage.removeItem(PLAYER_STORAGE_KEY);
      } catch {
        // Nothing to clear.
      }
    }
    router.push(`/planned/${session.plannedSessionId}`);
    router.refresh();
  };

  // Retry by itself when the phone comes back online (decision 7).
  useEffect(() => {
    if (!error || !run) return;
    const onOnline = () => void save();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  });

  const byKey = new Map(results.map((r) => [r.key, r]));
  const total = results.reduce((a, r) => a + (r.activeSeconds ?? 0), 0);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto" data-testid="step-results">
      <div className="px-4 pt-2 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">{session.name}</h1>
        <p className="text-sm text-muted-foreground">
          {fromPlayer || run ? "From the guided run" : "As planned; change what was different"} · {formatTime(total)}
        </p>
      </div>

      <div className="px-4 pb-3">
        <p className="text-sm font-semibold mb-2">How hard was it? (RPE)</p>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Session RPE">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rpe === n}
              onClick={() => setRpe(rpe === n ? null : n)}
              className={`min-h-11 rounded-xl text-base font-semibold active:scale-95 transition-all ${rpe === n ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {n}
            </button>
          ))}
        </div>
        {rpe === null && <p className="mt-1 text-xs text-muted-foreground">Without RPE this session may have no load.</p>}
      </div>

      <label className="px-4 pb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Distance ({unit}), optional</span>
        <input
          inputMode="decimal"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          className="w-28 min-h-11 rounded-xl bg-muted px-3 text-right text-base"
          aria-label={`Distance in ${unit}`}
        />
      </label>

      <ol className="px-4 flex flex-col gap-2">
        {rows.map((p) => {
          const r = byKey.get(p.key);
          if (!r) return null;
          const c = compareStep(p, r);
          const valueUnit = p.target && (p.target.unit === "W" || p.target.unit === "bpm" || p.target.unit === "rpm") ? p.target.unit : null;
          return (
            <li key={p.key} className="rounded-xl bg-muted px-3 py-2" data-testid="result-step">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {STEP_WORD[p.type]}
                    {p.round ? ` · ${p.round.index}/${p.round.of}` : ""}
                  </p>
                  <p className="text-sm">{p.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.plannedSeconds !== null ? `planned ${formatTime(p.plannedSeconds)}` : "planned to lap"}
                    {r.activeSeconds !== undefined ? ` · done ${formatTime(r.activeSeconds)}` : ""}
                    {c.band ? ` · ${BAND_TEXT[c.band] ?? c.band}` : ""}
                    {c.hit ? ` · ${HIT_TEXT[c.hit]}` : ""}
                  </p>
                </div>
                <select
                  value={r.status}
                  onChange={(e) => update(p.key, { status: e.target.value as StepResult["status"] })}
                  className="min-h-11 rounded-lg bg-background px-2 text-sm"
                  aria-label={`Status of step ${p.key}`}
                >
                  {(Object.keys(STATUS_TEXT) as StepResult["status"][]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_TEXT[s]}
                    </option>
                  ))}
                </select>
              </div>
              {p.type === "work" && (
                <details className="mt-1">
                  <summary className="min-h-11 flex items-center text-sm text-primary">Add a value or note</summary>
                  <div className="flex flex-col gap-2 pb-1">
                    {valueUnit && (
                      <label className="flex items-center justify-between gap-2 text-sm">
                        Average ({valueUnit})
                        <input
                          inputMode="numeric"
                          defaultValue={r.value ?? ""}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            update(p.key, { value: e.target.value.trim() && Number.isFinite(n) && n >= 0 ? n : undefined });
                          }}
                          className="w-24 min-h-11 rounded-lg bg-background px-2 text-right"
                        />
                      </label>
                    )}
                    <label className="flex items-center justify-between gap-2 text-sm">
                      RPE (1-10)
                      <input
                        inputMode="numeric"
                        defaultValue={r.rpe ?? ""}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          update(p.key, { rpe: Number.isInteger(n) && n >= 1 && n <= 10 ? n : undefined });
                        }}
                        className="w-24 min-h-11 rounded-lg bg-background px-2 text-right"
                      />
                    </label>
                    <input
                      placeholder="Note"
                      maxLength={280}
                      defaultValue={r.notes ?? ""}
                      onBlur={(e) => update(p.key, { notes: e.target.value.trim() || undefined })}
                      className="min-h-11 rounded-lg bg-background px-2 text-sm"
                      aria-label={`Note for step ${p.key}`}
                    />
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-0 mt-auto bg-background px-4 pt-3 pb-6 flex flex-col gap-2">
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="results-error">
            Not saved yet: {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-60 active:opacity-80"
        >
          {saving ? "Saving" : error ? "Retry" : "Save"}
        </button>
      </div>
    </div>
  );
}
