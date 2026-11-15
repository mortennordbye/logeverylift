import { AfterRide } from "@/components/features/bike/AfterRide";
import { FtpLine } from "@/components/features/bike/FtpLine";
import { ProfileChart } from "@/components/features/bike/ProfileChart";
import { RecordBox } from "@/components/features/bike/RecordBox";
import { StepCards } from "@/components/features/bike/StepCards";
import { YourNumbers } from "@/components/features/bike/YourNumbers";
import { SavedRunLink } from "@/components/features/guided/SavedRunLink";
import { STEP_WORD } from "@/components/features/guided/types";
import { SessionPageActions } from "@/components/features/PlannedSessionActions";
import { getBikeNumbers } from "@/lib/bike-numbers";
import { lastRideAutoLapKm, sessionActionContext } from "@/lib/bike-session";
import { ftpTestHref } from "@/lib/utils/workout-templates";
import { enduranceEnabledFor } from "@/lib/endurance";
import { distanceLabel, plannedSessionView, type PlannedSessionView } from "@/lib/planned-view";
import { thresholdValues } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { bikeAnchors, minutesText, numbersTable, recordLines, resolvedGroups } from "@/lib/utils/bike-view";
import { toDateStr } from "@/lib/utils/cycle-position";
import { profileBlocks } from "@/lib/utils/workout-profile";
import { estimateWorkout } from "@/lib/utils/workout-steps";
import { formatTime } from "@/lib/utils/format";
import { shortDay } from "@/lib/utils/seasons";
import { THRESHOLD_LABEL } from "@/lib/utils/thresholds";
import { requireSession } from "@/lib/utils/session";
import type { ThresholdKind } from "@/db/schema/athlete-profile";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

const BAND_TEXT: Record<string, string> = { green: "On plan", yellow: "Partly", orange: "Far off plan", red: "Missed", done: "Done", illness: "Sick" };

/**
 * One planned session with a structured workout (docs/plans/endurance-app.md,
 * 4.3): its steps in the user's own numbers, totals and planned load, and the
 * way in to the guided player, the pool view and the step results.
 */
export default async function PlannedSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const v = await plannedSessionView(user.id, id);
  if (!v) notFound();
  if (v.workout.sport === "bike") return <BikeSession userId={user.id} id={id} v={v} />;
  const { session, workout, units, estimate } = v;
  const done = session.state === "done";
  const swim = workout.sport === "swim";

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/week", label: "Week" }} />
      </div>
      <div className="px-4 pt-2 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {shortDay(session.date)} · {session.priority}
          {session.band ? ` · ${BAND_TEXT[session.band]}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="planned-name">
          {workout.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {estimate.durationSeconds > 0 ? `${estimate.durationComplete ? "" : "at least "}${formatTime(estimate.durationSeconds)}` : "time open"}
          {estimate.distanceMeters > 0 ? ` · ${estimate.distanceComplete ? "" : "at least "}${distanceLabel(estimate.distanceMeters, workout.sport, units)}` : ""}
          {` · load about ${Math.round(v.plannedLoad.load)}${v.plannedLoad.partial ? " (estimate)" : ""}`}
        </p>
        {v.missingAnchors.length > 0 && (
          <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm">
            Set {v.missingAnchors.map((k) => THRESHOLD_LABEL[k as ThresholdKind] ?? k).join(", ")} to see these targets in your own numbers.{" "}
            <Link href="/more/thresholds" className="text-primary underline">
              Thresholds
            </Link>
          </p>
        )}
      </div>

      <ol className="px-4 flex flex-col gap-1" data-testid="planned-steps">
        {v.rows.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-3 rounded-xl bg-muted px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {STEP_WORD[r.type]}
                {r.round ? ` · ${r.round.index}/${r.round.of}` : ""}
              </p>
              <p className="text-sm">{r.text}</p>
            </div>
            {r.target && <p className="shrink-0 text-sm font-semibold tabular-nums">{r.target.text}</p>}
          </li>
        ))}
      </ol>

      <div className="mt-auto flex flex-col gap-2 px-4 pt-4 pb-6">
        {!done && <SavedRunLink plannedSessionId={id} />}
        {!swim && (
          <Link href={`/planned/${id}/play`} className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground active:opacity-80">
            Start guided
          </Link>
        )}
        {swim && (
          <Link href={`/planned/${id}/pool`} className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground active:opacity-80">
            Pool view
          </Link>
        )}
        <Link href={`/planned/${id}/results`} className="min-h-12 rounded-2xl border border-border px-4 py-3 text-center text-base font-medium active:opacity-70">
          {v.results ? "Step results" : done ? "Add step results" : "Log results by hand"}
        </Link>
      </div>
    </div>
  );
}

const PRIORITY_TEXT = { key: "Key", support: "Support", optional: "Optional" } as const;

function MissingAnchors({ kinds }: { kinds: string[] }) {
  if (kinds.length === 0) return null;
  return (
    <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm">
      Set {kinds.map((k) => THRESHOLD_LABEL[k as ThresholdKind] ?? k).join(", ")} to see these targets in your own numbers.{" "}
      <Link href="/more/thresholds" className="text-primary underline">
        Thresholds
      </Link>
    </p>
  );
}

/** A bike session before the ride (docs/plans/bike-sessions.md, 5.2), and the after view once it is done (5.5). */
async function BikeSession({ userId, id, v }: { userId: string; id: number; v: PlannedSessionView }) {
  const { session, workout, units } = v;
  const done = session.state === "done";
  const [numbers, thresholds, autoLap, ctx, today] = await Promise.all([
    getBikeNumbers(userId),
    thresholdValues(userId),
    lastRideAutoLapKm(userId),
    sessionActionContext(userId, id),
    userToday(userId).then(toDateStr),
  ]);
  const anchors = bikeAnchors(thresholds, numbers);
  const est = estimateWorkout(workout, anchors);
  const tiles = [
    { label: "Total", value: est.durationSeconds > 0 ? minutesText(est.durationSeconds) : "open" },
    { label: "Hard", value: minutesText(est.hardSeconds) },
    { label: "Load", value: `~${Math.round(v.plannedLoad.load)}` },
  ];

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/week", label: "Week" }} />
      </div>
      <div className="px-4 pb-6">
        <p className="flex justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>
            {shortDay(session.date)} · Bike
            {session.band ? ` · ${BAND_TEXT[session.band]}` : ""}
          </span>
          <span>{PRIORITY_TEXT[session.priority]}</span>
        </p>
        <h1 className="home-display mt-2 text-[28px] uppercase leading-[1.05]" data-testid="planned-name">
          {workout.name}
        </h1>

        <div className="my-3 grid grid-cols-3 gap-2" data-testid="planned-totals">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl bg-widget px-3 py-2.5">
              <p className="home-display text-[22px] tabular-nums">{t.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{t.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-[22px] bg-widget p-3">
          <ProfileChart blocks={profileBlocks(workout, anchors, numbers.zones)} ftp={anchors.ftp ?? null} />
        </div>
        <MissingAnchors kinds={v.missingAnchors} />
        <FtpLine numbers={numbers} planFtpTestHref={ftpTestHref()} />

        {workout.description && (
          <section className="mt-3 rounded-[18px] bg-widget px-3.5 py-3 text-sm" aria-label="Coach note" data-testid="coach-note">
            <p className="text-muted-foreground">Coach note</p>
            <p>{workout.description}</p>
          </section>
        )}

        {done && <AfterRide plannedSessionId={id} />}

        <StepCards groups={resolvedGroups(workout, anchors, units, numbers.zones)} />
        <YourNumbers table={numbersTable(anchors, numbers)} />
        {!done && <RecordBox lines={recordLines(workout, autoLap)} />}

        {!done && ctx.lastDay && (
          <div className="-mx-4 mt-3">
            <SessionPageActions
              session={{ id, date: session.date, status: session.status, priority: session.storedPriority, fromLibrary: ctx.fromLibrary, started: session.loggedSessionId != null }}
              today={today}
              lastDay={ctx.lastDay}
            />
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2">
          {!done && <SavedRunLink plannedSessionId={id} />}
          <Link href={`/planned/${id}/play`} className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground active:opacity-80">
            Start guided
          </Link>
          {session.garminActivityId == null && (
            <Link href={`/planned/${id}/results`} className="min-h-12 rounded-2xl border border-border px-4 py-3 text-center text-base font-medium active:opacity-70">
              {v.results ? "Step results" : done ? "Add step results" : "Log results by hand"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
