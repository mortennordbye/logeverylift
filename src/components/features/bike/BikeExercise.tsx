"use client";

/**
 * The bike exercise of an endurance user in a workout
 * (docs/plans/bike-ride-logger.md, section 5 "Bike exercise"): the ride as a
 * plan, not a set list. Mode row with Change, the planned power chart and
 * numbers, one row per step, and "Start ride" pinned at the bottom.
 *
 * Start ride starts the server ride and opens ride mode (`?ride=1`). "Log by
 * hand" opens today's set list (`?hand=1`) until the results table of step 4
 * replaces it. After a ride the bar says "Ride done".
 */

import { RideProfileChart, zoneOpacity } from "@/components/features/bike/RideProfileChart";
import { armRide } from "@/components/features/bike/useRide";
import { BackLink } from "@/components/ui/BackLink";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import type { RideMode } from "@/db/schema/rides";
import { startRide } from "@/lib/actions/rides";
import type { BikeExerciseData } from "@/lib/bike-exercise-view";
import { rideLengthText } from "@/lib/utils/bike-ride-view";
import { loadText } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const MODE_NAME: Record<RideMode, string> = { indoor: "Indoor trainer", outdoor: "Outdoor" };

export function BikeExercise({
  programId,
  programExerciseId,
  exerciseName,
  data,
  onlyExercise = true,
}: {
  programId: number;
  programExerciseId: number;
  exerciseName: string;
  data: BikeExerciseData;
  /** The program holds this exercise only: Done after a ride goes home, else back to the workout. */
  onlyExercise?: boolean;
}) {
  const [mode, setMode] = useState<RideMode>(data.defaultMode);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useWorkoutSession();
  const router = useRouter();
  const pathname = usePathname();
  const view = data[mode];
  const n = view.numbers;
  const indoor = mode === "indoor";

  const sub = [
    rideLengthText(n),
    n.load.load > 0 ? loadText(n.load) : null,
    indoor ? (data.ftp ? `FTP ${Math.round(data.ftp)} W` : null) : data.lthr ? `LTHR ${Math.round(data.lthr)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
    const res = await callAction(startRide({ sessionId: session.sessionId, programExerciseId, mode, clientId: crypto.randomUUID() }));
    if (res.success) router.replace(`${pathname}?ride=1`);
    else setError(res.error);
    setStarting(false);
  }

  // Only the numbers the plan gives: no kJ without an FTP, no IF without power on every step.
  const stats = [
    n.intensityFactor !== null && { value: n.intensityFactor.toFixed(2), label: "IF" },
    n.load.load > 0 && { value: `${Math.round(n.load.load)}`, label: "load" },
    n.kj !== null && { value: `${n.kj}`, label: "kJ" },
    n.mainZone !== null && { value: `${n.zoneMinutes[n.mainZone - 1]} min`, label: `in Z${n.mainZone}` },
  ].filter((s): s is { value: string; label: string } => !!s);
  const zones = n.zoneMinutes.map((m, i) => ({ zone: i + 1, m })).filter((z) => z.m > 0);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="bike-exercise">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
        <Link href={`/programs/${programId}/exercises/${programExerciseId}`} className="text-primary text-sm font-medium min-h-11 inline-flex items-center" data-testid="edit-steps">
          Edit
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{exerciseName}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums" data-testid="ride-summary">
            {sub}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted pl-4 pr-2 min-h-12">
          <span className="text-sm font-semibold" data-testid="ride-mode">
            {MODE_NAME[mode]}
          </span>
          <button
            type="button"
            onClick={() => setMode(indoor ? "outdoor" : "indoor")}
            aria-label={`Change to ${MODE_NAME[indoor ? "outdoor" : "indoor"]}`}
            className="min-h-11 px-3 text-sm text-primary active:opacity-70"
          >
            Change
          </button>
        </div>

        {indoor && (
          <div className="rounded-2xl bg-muted px-3 pt-3 pb-2.5">
            <RideProfileChart chart={view.chart} label={`Planned power profile, ${view.rows.map((r) => `${r.title} ${r.target ?? ""} ${r.time}`).join(", ")}`} />
            <div className="mt-2 grid gap-1 border-t border-border pt-2 text-center" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }} data-testid="ride-stats">
              {stats.map((s) => (
                <div key={s.label}>
                  <p className="text-sm font-bold tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            {zones.length > 0 && (
              <>
                <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Planned time in zones, ${zones.map((z) => `Z${z.zone} ${z.m} min`).join(", ")}`}>
                  {zones.map((z) => (
                    <i key={z.zone} className="bg-brand" style={{ flex: z.m, opacity: zoneOpacity(z.zone) }} />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
                  {zones.map((z, i) => (
                    <span key={z.zone}>
                      Z{z.zone} {z.m}
                      {i === zones.length - 1 ? " min" : ""}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {indoor && data.ftp === null && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm" data-testid="no-ftp">
            <span className="text-muted-foreground">Set your FTP to see watts</span>
            <Link href="/more/account/training-numbers" className="min-h-11 px-3 inline-flex items-center font-semibold text-primary whitespace-nowrap active:opacity-70">
              Set FTP
            </Link>
          </div>
        )}

        <ol className="rounded-2xl bg-muted divide-y divide-border" data-testid="ride-steps">
          {view.rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[24px_1fr_auto] items-center gap-2.5 px-3 py-2.5" data-testid="ride-step">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-background/60 text-[11px] text-muted-foreground tabular-nums">{r.n}</span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${r.easy ? "text-muted-foreground" : ""}`}>{r.title}</p>
                {r.detail && <p className="text-xs text-muted-foreground">{r.detail}</p>}
                {r.note && <p className="text-xs italic text-muted-foreground">{r.note}</p>}
              </div>
              <div className="text-right tabular-nums">
                {r.target && <p className="text-sm font-semibold whitespace-nowrap" data-testid="ride-step-target">{r.target}</p>}
                <p className="text-xs text-muted-foreground whitespace-nowrap">{r.time}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-1 border-t border-border bg-background">
        {error && (
          <p role="alert" className="text-sm text-center text-muted-foreground">
            {error}
          </p>
        )}
        {data.liveRide ? (
          <>
            <p className="text-sm text-center text-muted-foreground">Ride running</p>
            <Link
              href={`${pathname}?ride=1`}
              onClick={() => armRide()}
              className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80"
            >
              Resume
            </Link>
          </>
        ) : data.doneRide ? (
          <>
            <p className="text-sm text-center text-muted-foreground" data-testid="ride-done-line">
              {data.doneRide.endedEarly ? "Ride ended early" : "Ride done"}
            </p>
            {/* A ride that ended while the app was closed: ride mode saves its last steps and finishes the workout. */}
            <Link
              href={onlyExercise && data.doneRide.sessionOpen ? `${pathname}?ride=1` : onlyExercise ? "/" : `/programs/${programId}/workout`}
              className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80"
            >
              {onlyExercise && data.doneRide.sessionOpen ? "Save the ride" : "Done"}
            </Link>
            <Link href={`${pathname}?hand=1`} className="min-h-11 inline-flex items-center justify-center text-sm font-medium text-primary active:opacity-70">
              Log by hand
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
              Start ride
            </button>
            {/* Hidden while a ride runs (4.3). */}
            <Link href={`${pathname}?hand=1`} className="min-h-11 inline-flex items-center justify-center text-sm font-medium text-primary active:opacity-70">
              Log by hand
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
