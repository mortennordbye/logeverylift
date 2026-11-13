import { answerSession } from "@/components/features/answer-session";
import { enduranceEnabledFor } from "@/lib/endurance";
import { distanceLabel } from "@/lib/planned-view";
import { sessionCompliance, thresholdValues } from "@/lib/session-compliance";
import { appSessionLoads, getTrainingLoad } from "@/lib/training-load";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { formatTime } from "@/lib/utils/format";
import { addDaysStr, shortDay } from "@/lib/utils/seasons";
import { mondayOf } from "@/lib/utils/session-compliance";
import { requireSession } from "@/lib/utils/session";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

const SPORTS = ["swim", "bike", "run"] as const;
const SPORT_NAME = { swim: "Swim", bike: "Bike", run: "Run" } as const;
const STATE_TEXT: Record<string, string> = {
  planned: "planned",
  done: "done",
  missed: "missed",
  unconfirmed: "not answered",
  illness: "sick",
  sick: "sick",
  skipped: "skipped",
};
const BAND_TEXT: Record<string, string> = { green: "on plan", yellow: "partly", orange: "far off plan", red: "missed", done: "done", illness: "sick" };
const RAMP_TEXT = { normal: "normal", fast: "fast", warning: "too fast" } as const;

const time = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);

/**
 * The week view (docs/plans/endurance-app.md, 4.2): Monday to Sunday with each
 * dated session and its state, totals per sport planned against done, and
 * fitness, fatigue and form (D1). Endurance switch only (decision 23).
 */
export default async function WeekPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const today = toDateStr(await userToday(user.id));
  const { w } = await searchParams;
  const monday = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(w) : mondayOf(today);
  const sunday = addDaysStr(monday, 6);
  const [sessions, loads, anchors, { units }, training] = await Promise.all([
    sessionCompliance(user.id, monday, sunday),
    appSessionLoads(user.id, monday, sunday),
    thresholdValues(user.id),
    getUserSettings(user.id),
    getTrainingLoad(user.id, 42),
  ]);

  const totals = Object.fromEntries(SPORTS.map((s) => [s, { plannedS: 0, plannedM: 0, plannedLoad: 0, doneS: 0, doneM: 0, doneLoad: 0, count: 0 }])) as Record<
    (typeof SPORTS)[number],
    { plannedS: number; plannedM: number; plannedLoad: number; doneS: number; doneM: number; doneLoad: number; count: number }
  >;
  let strengthCount = 0;
  for (const s of sessions) {
    if (!s.sport) {
      strengthCount++;
      continue;
    }
    const t = totals[s.sport];
    t.count++;
    if (s.status !== "skipped") {
      t.plannedS += s.planned.durationSeconds ?? 0;
      t.plannedM += s.planned.distanceMeters ?? 0;
      if (s.workout) t.plannedLoad += workoutPlannedLoad(s.workout, anchors).load;
    }
  }
  for (const l of loads) {
    if (l.sport !== "swim" && l.sport !== "bike" && l.sport !== "run") continue;
    totals[l.sport].doneS += l.durationS;
    totals[l.sport].doneLoad += l.load ?? 0;
  }
  for (const s of sessions) if (s.sport && s.done?.distanceMeters) totals[s.sport].doneM += s.done.distanceMeters;
  const strengthLoad = loads.filter((l) => l.sport === "strength").reduce((a, l) => a + (l.load ?? 0), 0);

  const last = training.days.at(-1);
  const ctl = training.days.map((d) => d.tracks.total.ctl);
  const max = Math.max(1, ...ctl);
  const points = ctl.map((v, i) => `${(i / Math.max(1, ctl.length - 1)) * 100},${30 - (v / max) * 28}`).join(" ");
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(monday, i));

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <Link href={`/week?w=${addDaysStr(monday, -7)}`} className="flex items-center text-primary min-h-11 min-w-11 active:opacity-70" aria-label="Previous week">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-bold" data-testid="week-title">
          {shortDay(monday)} to {shortDay(sunday)}
        </h1>
        <Link href={`/week?w=${addDaysStr(monday, 7)}`} className="flex items-center justify-end text-primary min-h-11 min-w-11 active:opacity-70" aria-label="Next week">
          <ChevronRight className="w-5 h-5" />
        </Link>
      </div>

      <section className="mx-4 mb-3 rounded-2xl bg-muted p-4" data-testid="load-card">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Load</p>
          <p className="text-xs text-muted-foreground">{training.source === "garmin" ? "from Garmin and the app" : "from sessions logged in the app"}</p>
        </div>
        {last ? (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold tabular-nums">{Math.round(last.tracks.total.ctl)}</p>
                <p className="text-xs text-muted-foreground">fitness</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{Math.round(last.tracks.total.atl)}</p>
                <p className="text-xs text-muted-foreground">fatigue</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{Math.round(last.tracks.total.tsb)}</p>
                <p className="text-xs text-muted-foreground">form</p>
              </div>
            </div>
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-10 w-full" role="img" aria-label={`Fitness over 6 weeks, now ${Math.round(last.tracks.total.ctl)}`}>
              <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="text-primary" />
            </svg>
            <p className="text-xs text-muted-foreground">
              {training.ramp !== null && training.rampBand ? `Ramp ${training.ramp >= 0 ? "+" : ""}${training.ramp.toFixed(1)} a week (${RAMP_TEXT[training.rampBand]})` : "Ramp: needs a week of data"}
              {last.calibrating ? " · calibrating: the first 6 weeks are rough" : ""}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No load yet. Log a session with RPE, or set a threshold pace or CSS.</p>
        )}
        {training.noLoad.length > 0 && (
          <p className="mt-1 text-xs" data-testid="no-load">
            {training.noLoad.length} {training.noLoad.length === 1 ? "session has" : "sessions have"} no load: add RPE when you log.
          </p>
        )}
        <details className="mt-1">
          <summary className="min-h-11 flex items-center text-xs text-primary">How load is counted</summary>
          <ul className="text-xs text-muted-foreground list-disc pl-4 flex flex-col gap-1">
            <li>100 = one hour at threshold. Fitness is a 42-day average, fatigue a 7-day one, form the difference (coach convention).</li>
            <li>Runs: hours × (speed / threshold speed)² × 100, with a threshold pace (inference).</li>
            <li>Swims: hours × (speed / CSS)³ × 100 (inference).</li>
            <li>Otherwise minutes × RPE × 0.22 (inference). With no RPE a session has no load.</li>
          </ul>
        </details>
      </section>

      <section className="mx-4 mb-3 grid grid-cols-3 gap-2" data-testid="sport-totals">
        {SPORTS.map((s) => {
          const t = totals[s];
          return (
            <div key={s} className="rounded-xl bg-muted p-2 text-center">
              <p className="text-xs font-semibold">{SPORT_NAME[s]}</p>
              <p className="text-sm tabular-nums">
                {time(t.doneS)} / {time(t.plannedS)}
              </p>
              {(t.plannedM > 0 || t.doneM > 0) && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {distanceLabel(t.doneM, s, units)} / {distanceLabel(t.plannedM, s, units)}
                </p>
              )}
              <p className="text-xs text-muted-foreground tabular-nums">
                load {Math.round(t.doneLoad)} / ~{Math.round(t.plannedLoad)}
              </p>
            </div>
          );
        })}
      </section>
      {strengthCount > 0 && (
        <p className="mx-4 mb-3 text-xs text-muted-foreground">
          Strength: {strengthCount} {strengthCount === 1 ? "session" : "sessions"}, load {Math.round(strengthLoad)}
        </p>
      )}

      <ol className="px-4 pb-6 flex flex-col gap-3">
        {days.map((d) => {
          const mine = sessions.filter((s) => s.date === d);
          return (
            <li key={d} data-testid="week-day">
              <p className={`text-xs font-semibold uppercase tracking-wider ${d === today ? "text-primary" : "text-muted-foreground"}`}>{shortDay(d)}</p>
              {mine.length === 0 ? (
                <p className="text-sm text-muted-foreground">Rest</p>
              ) : (
                <ul className="flex flex-col gap-1 mt-1">
                  {mine.map((s) => {
                    const a = answerSession(s);
                    const body = (
                      <>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          {a.summary && <p className="text-xs text-muted-foreground truncate">{a.summary}</p>}
                          {s.done?.durationSeconds ? <p className="text-xs text-muted-foreground">done {formatTime(s.done.durationSeconds)}</p> : null}
                        </div>
                        <p className="shrink-0 text-xs text-right">
                          {s.priority}
                          <br />
                          {s.band ? BAND_TEXT[s.band] : STATE_TEXT[s.state]}
                        </p>
                      </>
                    );
                    return (
                      <li key={s.id}>
                        {s.workout ? (
                          <Link href={`/planned/${s.id}`} className="flex items-start justify-between gap-2 rounded-xl bg-muted px-3 py-2 min-h-11 active:opacity-70" data-testid="week-session">
                            {body}
                          </Link>
                        ) : (
                          <div className="flex items-start justify-between gap-2 rounded-xl bg-muted px-3 py-2" data-testid="week-session">
                            {body}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
