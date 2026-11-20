"use client";

/**
 * The run exercise of an endurance user in a workout
 * (docs/plans/run-logger.md, section 5 "Run exercise, ready", step 2): the
 * run as a plan, not a set list. Mode row with Change (a sheet, before the
 * start only), the surface choice outdoors (R14), the planned zone chart and
 * numbers, one row per step with the belt on a treadmill, and "Start run"
 * pinned at the bottom.
 *
 * Start run starts the server run and opens run mode (`?ride=1`). "Log by
 * hand" opens today's set list (`?hand=1`). The bike parts do the rest: the
 * chart, the zone bar, the step alerts row and the wake lock.
 */

import { RideProfileChart, RideZoneBar } from "@/components/features/bike/RideProfileChart";
import { StepAlertsRow, useStepAlerts } from "@/components/features/bike/StepAlerts";
import { armRide, disarmRide } from "@/components/features/bike/useRide";
import { BackLink } from "@/components/ui/BackLink";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import type { RideMode, RunSurface } from "@/db/schema/rides";
import { startRide } from "@/lib/actions/rides";
import type { RunExerciseData } from "@/lib/run-exercise-view";
import { rideLengthText } from "@/lib/utils/bike-ride-view";
import { loadText } from "@/lib/utils/format";
import { RUN_MODE_NAME, runAnchorText } from "@/lib/utils/run-view";
import { callAction } from "@/lib/utils/stale-bundle";
import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const SURFACE_NAME: Record<RunSurface, string> = { road: "Road", trail: "Trail or snow" };

export function RunExercise({
  programId,
  programExerciseId,
  exerciseName,
  data,
  pushPublicKey,
}: {
  programId: number;
  programExerciseId: number;
  exerciseName: string;
  data: RunExerciseData;
  /** The server's VAPID public key; null when push is off on the server. */
  pushPublicKey: string | null;
}) {
  const [mode, setMode] = useState<RideMode>(data.defaultMode);
  const [surface, setSurface] = useState<RunSurface>("road");
  const [sheet, setSheet] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alerts = useStepAlerts(pushPublicKey);
  const session = useWorkoutSession();
  const router = useRouter();
  const pathname = usePathname();
  const treadmill = mode === "indoor";
  const view = treadmill ? data.treadmill : data[surface];
  const n = view.numbers;
  const running = data.liveRun || data.otherLive !== null;
  const thresholds = { run_threshold_pace: data.thresholdPace ?? undefined, lthr_run: data.lthr ?? undefined };

  const sub = [rideLengthText(n), n.load.load > 0 ? loadText(n.load) : null, runAnchorText(thresholds, mode)].filter(Boolean).join(" · ");

  async function start() {
    if (starting) return;
    // The workout layout makes the session; read it at the tap, not in the
    // render, so the server HTML and the first client render agree.
    if (session?.sessionId == null) {
      setError("The workout is still starting. Try again in a moment.");
      return;
    }
    setStarting(true);
    setError(null);
    // Inside the tap: sound and the screen wake lock need a user gesture (iOS).
    armRide();
    const res = await callAction(
      startRide({ sessionId: session.sessionId, programExerciseId, mode, ...(!treadmill && { surface }), clientId: crypto.randomUUID() }),
    );
    if (res.success) router.replace(`${pathname}?ride=1`);
    else {
      disarmRide();
      setError(res.error);
    }
    setStarting(false);
  }

  const stats = [
    n.km !== null && { value: n.km.toFixed(1), label: "km est." },
    n.load.load > 0 && { value: `${Math.round(n.load.load)}`, label: "load" },
    n.mainZone !== null && { value: `${n.zoneMinutes[n.mainZone - 1]} min`, label: `in Z${n.mainZone}` },
  ].filter((s): s is { value: string; label: string } => !!s);
  // Heart rate zones need a run LTHR (section 5, empty states).
  const zones = data.lthr ? n.zoneMinutes.map((m, i) => ({ zone: i + 1, m })).filter((z) => z.m > 0) : [];
  // Belts on a treadmill and paces outdoors read the threshold pace.
  const noPace = data.thresholdPace === null && (treadmill || data.paceSteps);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="run-exercise">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
        <Link href={`/programs/${programId}/exercises/${programExerciseId}`} className="text-primary text-sm font-medium min-h-11 inline-flex items-center" data-testid="edit-steps">
          Edit
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{exerciseName}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums" data-testid="run-summary">
            {sub}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted pl-4 pr-2 min-h-12">
          <span className="text-sm font-semibold" data-testid="run-mode">
            {RUN_MODE_NAME[mode]}
          </span>
          {/* The mode is fixed when the run starts (R3). */}
          {!running && (
            <button type="button" onClick={() => setSheet(true)} className="min-h-11 px-3 text-sm text-primary active:opacity-70">
              Change
            </button>
          )}
        </div>

        {/* Before the start only: a running run keeps the surface it started with. */}
        {!treadmill && !running && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Surface" data-testid="run-surface">
            {(["road", "trail"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={surface === s}
                onClick={() => setSurface(s)}
                className={`min-h-11 rounded-lg text-sm font-semibold active:opacity-70 ${surface === s ? "bg-background text-foreground" : "text-muted-foreground"}`}
              >
                {SURFACE_NAME[s]}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-2xl bg-muted px-3 pt-3 pb-2.5">
          <RideProfileChart chart={view.chart} label={`Planned run profile, ${view.rows.map((r) => `${r.title} ${r.chip ?? ""} ${r.time}`).join(", ")}`} />
          {stats.length > 0 && (
            <div className="mt-2 grid gap-1 border-t border-border pt-2 text-center" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }} data-testid="run-stats">
              {stats.map((s) => (
                <div key={s.label}>
                  <p className="text-sm font-bold tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          <RideZoneBar zones={zones} label="Planned time in heart rate zones" testId="run-zones" />
        </div>

        {noPace && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm" data-testid="no-threshold-pace">
            <span className="text-muted-foreground">{treadmill ? "Set your threshold pace to see belt speeds" : "Set your threshold pace to see paces"}</span>
            <Link href="/more/account/training-numbers" className="min-h-11 px-3 inline-flex items-center font-semibold text-primary whitespace-nowrap active:opacity-70">
              Set pace
            </Link>
          </div>
        )}

        <ol className="rounded-2xl bg-muted divide-y divide-border" data-testid="run-steps">
          {view.rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[24px_1fr_auto] items-center gap-2.5 px-3 py-2.5" data-testid="run-step">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-background/60 text-[11px] text-muted-foreground tabular-nums">{r.n}</span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${r.easy ? "text-muted-foreground" : ""}`}>{r.title}</p>
                {r.detail && (
                  <p className="text-xs text-muted-foreground" data-testid="run-step-detail">
                    {r.detail}
                  </p>
                )}
                {r.note && <p className="text-xs italic text-muted-foreground">{r.note}</p>}
              </div>
              <div className="text-right tabular-nums">
                <p className="text-sm font-semibold whitespace-nowrap">{r.time}</p>
                {r.chip && <p className="text-xs text-muted-foreground whitespace-nowrap">{r.chip}</p>}
              </div>
            </li>
          ))}
        </ol>

        {/* Outdoors, before the start only (4.6): the phone in a pocket gets no alerts while push is off. */}
        {!treadmill && !running && (
          <StepAlertsRow state={alerts.state} busy={alerts.busy} error={alerts.error} onTurnOn={alerts.turnOn} hint="Keep the screen on for beeps, or follow your watch" />
        )}
      </div>

      <div data-pinned-bar className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-1 border-t border-border bg-background">
        {error && (
          <p role="alert" className="text-sm text-center text-muted-foreground">
            {error}
          </p>
        )}
        {running ? (
          <>
            <p className="text-sm text-center text-muted-foreground" data-testid="run-running">
              {data.liveRun ? "Run running" : data.otherLive!.sport === "run" ? "Another run is running" : "A ride is running"}
            </p>
            <Link
              href={data.liveRun ? `${pathname}?ride=1` : data.otherLive!.href}
              onClick={() => armRide()}
              className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80"
            >
              Resume
            </Link>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={start}
              disabled={starting}
              className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              Start run
            </button>
            {/* Hidden while a run runs (4.3). */}
            <Link href={`${pathname}?hand=1`} className="min-h-11 inline-flex items-center justify-center text-sm font-medium text-primary active:opacity-70">
              Log by hand
            </Link>
          </>
        )}
      </div>

      <BottomSheet open={sheet} onClose={() => setSheet(false)}>
        <div className="rounded-t-2xl bg-background px-4 pt-4 pb-8 flex flex-col gap-2" data-testid="run-mode-sheet">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold">Where do you run</p>
            <button type="button" onClick={() => setSheet(false)} className="min-h-11 px-2 text-sm text-primary active:opacity-70">
              Cancel
            </button>
          </div>
          {(["indoor", "outdoor"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setSheet(false);
              }}
              className="flex items-center justify-between rounded-xl bg-muted px-4 min-h-12 text-sm font-semibold active:opacity-70"
            >
              {RUN_MODE_NAME[m]}
              {mode === m && <Check className="h-4 w-4 text-primary" aria-hidden />}
            </button>
          ))}
          <p className="text-xs text-muted-foreground">The mode is fixed when the run starts.</p>
        </div>
      </BottomSheet>
    </div>
  );
}
