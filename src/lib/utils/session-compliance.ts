/**
 * Planned vs done (docs/plans/workouts-and-compliance.md, section 6;
 * decisions D11, D19, D20). Pure rules with no database access: the compliance
 * ratio and band of one session, the consistency number over weeks, the day
 * to suggest for a missed key session, and the return rule after a sick
 * period. Dates are `YYYY-MM-DD` in the user's zone; weeks run Monday to
 * Sunday.
 *
 * Source: docs/research/endurance-training-reference.md.
 */

import { addDaysStr, daysBetweenStr } from "@/lib/utils/seasons";

// ── Compliance per session (6.8) ────────────────────────────────────────────

export type Amount = { durationSeconds?: number | null; distanceMeters?: number | null };

/**
 * Done over planned, by duration, else by distance. The research puts TSS
 * first, then duration, then distance; planned TSS waits for package D1.
 * Null when no measure is on both sides.
 */
export function complianceRatio(planned: Amount, done: Amount): { ratio: number; by: "duration" | "distance" } | null {
  const pos = (n: number | null | undefined): n is number => n != null && n > 0;
  if (pos(planned.durationSeconds) && done.durationSeconds != null) {
    return { ratio: done.durationSeconds / planned.durationSeconds, by: "duration" };
  }
  if (pos(planned.distanceMeters) && done.distanceMeters != null) {
    return { ratio: done.distanceMeters / planned.distanceMeters, by: "distance" };
  }
  return null;
}

export type ComplianceBand = "green" | "yellow" | "orange" | "red" | "done" | "illness";

/**
 * TrainingPeaks' colours, the de facto standard (research, "Every workout
 * format reduces to the same tree"; coach convention): green within ±20% of
 * plan, yellow 50-79% or 121-150%, orange more than 50% off, red missed. The
 * ratio is rounded to whole percent first, so 0.795 reads as 80%.
 */
export function complianceBand(
  state: "done" | "missed" | "illness" | "skipped" | "planned",
  ratio: number | null,
): ComplianceBand | null {
  if (state === "missed") return "red";
  if (state === "illness") return "illness";
  if (state !== "done") return null;
  if (ratio === null) return "done";
  const pct = Math.round(ratio * 100);
  if (pct >= 80 && pct <= 120) return "green";
  if (pct >= 50 && pct <= 150) return "yellow";
  return "orange";
}

// ── Consistency (6.9) ───────────────────────────────────────────────────────

/** Days since Monday: 0 for Monday, 6 for Sunday. */
function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week holding `day`. */
export function mondayOf(day: string): string {
  return addDaysStr(day, -weekdayIndex(day));
}

/** ISO weekday: 1 = Monday to 7 = Sunday, as `availableDays` and slots use. */
export function isoWeekday(day: string): number {
  return weekdayIndex(day) + 1;
}

export type ConsistencySession = {
  date: string;
  done: boolean;
  /** Status `skipped` (C2). */
  skipped: boolean;
  /** The user's date when the status became skipped or missed; null before C5 stored it. */
  statusOn: string | null;
};

/**
 * Whether a session counts in its week. A session skipped before its day is a
 * plan change and leaves the count. A skip on or after the day, or one with no
 * date stored, is a miss. Today's and future sessions count only when done.
 */
export function countsInWeek(s: ConsistencySession, today: string): boolean {
  if (s.skipped && s.statusOn !== null && s.statusOn < s.date) return false;
  if (s.date >= today && !s.done) return false;
  return true;
}

export const CONSISTENCY_WEEKS = 12;
/** A week is complete at this share of its counted sessions done (decision 10). */
export const COMPLETE_WEEK_SHARE = 0.8;

export type WeekCompliance = { start: string; counted: number; done: number; complete: boolean };

export type Consistency = {
  /** The full weeks before this one, oldest first, including weeks with nothing counted. */
  weeks: WeekCompliance[];
  completeWeeks: number;
  /** Weeks with at least one counted session. */
  countedWeeks: number;
  /** completeWeeks / countedWeeks; null when no week counted. */
  share: number | null;
  thisWeek: { start: string; counted: number; done: number };
};

/**
 * The share of the last full weeks with at least 80% of their counted sessions
 * done. Athletes who completed over 80% of planned training weeks were 7 times
 * more likely to reach their goal (IOC 2022, study); computing it per week from
 * sessions is inference. Missed and illness sessions count as not done: the
 * study counts modified weeks against the athlete.
 */
export function consistency(sessions: ConsistencySession[], today: string, weeks = CONSISTENCY_WEEKS): Consistency {
  const thisMonday = mondayOf(today);
  const starts = Array.from({ length: weeks }, (_, i) => addDaysStr(thisMonday, -7 * (weeks - i)));
  const tally = new Map<string, { counted: number; done: number }>([...starts, thisMonday].map((s) => [s, { counted: 0, done: 0 }]));
  for (const s of sessions) {
    const t = tally.get(mondayOf(s.date));
    if (!t || !countsInWeek(s, today)) continue;
    t.counted++;
    if (s.done) t.done++;
  }
  const out = starts.map((start) => {
    const t = tally.get(start)!;
    return { start, ...t, complete: t.counted > 0 && t.done / t.counted >= COMPLETE_WEEK_SHARE };
  });
  const countedWeeks = out.filter((w) => w.counted > 0).length;
  const completeWeeks = out.filter((w) => w.complete).length;
  return {
    weeks: out,
    completeWeeks,
    countedWeeks,
    share: countedWeeks ? completeWeeks / countedWeeks : null,
    thisWeek: { start: thisMonday, ...tally.get(thisMonday)! },
  };
}

// ── Sick periods (6.7) ──────────────────────────────────────────────────────

export type IllnessSeverity = "mild" | "moderate" | "severe";
export type IllnessPeriod = { id: number; startedOn: string; endedOn: string | null; severity: IllnessSeverity | null };

/** Whether `day` is inside a sick period. An open period runs on from its first day. */
export function inIllness(day: string, periods: Pick<IllnessPeriod, "startedOn" | "endedOn">[]): boolean {
  return periods.some((p) => day >= p.startedOn && (p.endedOn === null || day <= p.endedOn));
}

/** Plain meaning of each IOC 2022 severity grade. */
export const SEVERITY_TEXT: Record<IllnessSeverity, string> = {
  mild: "Nose and throat only, no fever.",
  moderate: "Cough or short of breath.",
  severe: "Fever over 38 °C, chills, aches, chest pain or a racing heart.",
};

/** The return rule, each line with its evidence label (research, "Illness follows the IOC severity grades"). */
export const RETURN_RULE: { text: string; evidence: string }[] = [
  {
    text: "Before moderate or hard training, do a 10-20 minute test at 60-70% of normal intensity.",
    evidence: "Consensus (IOC 2022)",
  },
  {
    text: "Stop and see a doctor if fatigue, breathlessness, chest pain, dizziness, palpitations, an unusually high heart rate or not feeling well come during the test or within 24 hours.",
    evidence: "Consensus (IOC 2022)",
  },
  {
    text: "If the test is normal and no symptoms come within 24 hours, train easy for 2-3 days at reduced duration before adding intensity.",
    evidence: "Inference consistent with IOC 2022",
  },
];

export const SEE_DOCTOR_RULE = {
  text: "Severe symptoms, or sick for more than 7 days: see a doctor before training again.",
  evidence: "Consensus (IOC 2022)",
};

export type ReturnInfo = {
  phase: "sick" | "returning";
  periodId: number;
  severity: IllnessSeverity | null;
  /** Days from the last sick day to today; null while still sick. */
  daysSinceEnd: number | null;
  /** Done endurance sessions dated after the last sick day. */
  sessionsSinceEnd: number;
  seeDoctor: boolean;
  rule: { text: string; evidence: string }[];
};

/**
 * Where the athlete is after a sick period. `sick` while a period covers today.
 * `returning` from the day after the last sick day for `days` days, and in the
 * app only until the first done endurance session after it (decision 18: the
 * app shows it for 7 days or until that session; the assistant gets 14 days).
 * Null otherwise. The app shows the rule; it never changes the plan.
 */
export function returnInfo(
  periods: IllnessPeriod[],
  today: string,
  doneEnduranceDates: string[],
  opts: { days?: number; untilFirstSession?: boolean } = {},
): ReturnInfo | null {
  const { days = 7, untilFirstSession = true } = opts;
  const lengthDays = (p: IllnessPeriod) => daysBetweenStr(p.startedOn, p.endedOn ?? today) + 1;
  const base = (p: IllnessPeriod) => ({
    periodId: p.id,
    severity: p.severity,
    seeDoctor: p.severity === "severe" || lengthDays(p) > 7,
  });
  const withDoctor = (seeDoctor: boolean) => (seeDoctor ? [...RETURN_RULE, SEE_DOCTOR_RULE] : RETURN_RULE);

  const current = periods.find((p) => p.startedOn <= today && (p.endedOn === null || p.endedOn >= today));
  if (current) {
    const b = base(current);
    return { phase: "sick", ...b, daysSinceEnd: null, sessionsSinceEnd: 0, rule: withDoctor(b.seeDoctor) };
  }

  const last = periods
    .filter((p): p is IllnessPeriod & { endedOn: string } => p.endedOn !== null && p.endedOn < today)
    .sort((a, b) => (a.endedOn < b.endedOn ? 1 : -1))[0];
  if (!last) return null;
  const daysSinceEnd = daysBetweenStr(last.endedOn, today);
  if (daysSinceEnd > days) return null;
  const sessionsSinceEnd = doneEnduranceDates.filter((d) => d > last.endedOn && d <= today).length;
  if (untilFirstSession && sessionsSinceEnd > 0) return null;
  const b = base(last);
  return { phase: "returning", ...b, daysSinceEnd, sessionsSinceEnd, rule: withDoctor(b.seeDoctor) };
}

// ── A missed key session: suggest a day (6.6) ───────────────────────────────

/**
 * A session that loads a day: planned or done. Leave out skipped, missed and
 * illness sessions, and the missed session itself.
 */
export type DayLoad = { date: string; keyOrHard: boolean };

export type MoveSuggestion = { date: string } | { date: null; reason: string };

/**
 * The earliest day to move a missed key session to (D11, D19): after the
 * missed day, today or later, in the same Monday-to-Sunday week, an available
 * day when the profile lists them, not inside a sick period, with no key or
 * hard session on it or on the day before or after. A day with no session
 * comes before a day with only easy ones. Research ("Missed sessions are
 * skipped, not stacked"): move a key session only to an easy day with no hard
 * session within 24 h either side (coach convention plus inference); with no
 * such day, skip it. Key sessions count as hard for the neighbour check, so a
 * long ride does not land next to a long run.
 */
export function suggestMoveDay(input: {
  missedDate: string;
  today: string;
  load: DayLoad[];
  availableDays?: number[] | null;
  illness?: Pick<IllnessPeriod, "startedOn" | "endedOn">[];
}): MoveSuggestion {
  const { missedDate, today, load, availableDays, illness = [] } = input;
  const sunday = addDaysStr(mondayOf(missedDate), 6);
  const first = addDaysStr(missedDate, 1) > today ? addDaysStr(missedDate, 1) : today;

  const hardOn = (day: string) => load.some((l) => l.date === day && l.keyOrHard);
  const anyOn = (day: string) => load.some((l) => l.date === day);

  const candidates: string[] = [];
  for (let day = first; day <= sunday; day = addDaysStr(day, 1)) {
    if (availableDays && availableDays.length > 0 && !availableDays.includes(isoWeekday(day))) continue;
    if (inIllness(day, illness)) continue;
    if (hardOn(day) || hardOn(addDaysStr(day, -1)) || hardOn(addDaysStr(day, 1))) continue;
    candidates.push(day);
  }
  const best = candidates.find((d) => !anyOn(d)) ?? candidates[0];
  if (best) return { date: best };
  return { date: null, reason: "No free day this week. Skip it and go on." };
}

// ── The state of a session (6.2) ────────────────────────────────────────────

export type Sport = "swim" | "bike" | "run";
export type SessionState = "planned" | "done" | "missed" | "unconfirmed" | "illness" | "sick" | "skipped";
export type MatchedBy = "link" | "pick" | "app" | "garmin";

export type MatchPlanned = { id: number; date: string; position: number; programId: number | null; sport: Sport | null };
export type MatchCompleted = {
  id: number;
  date: string;
  intendedDate: string | null;
  programId: number | null;
  plannedSessionId: number | null;
  /** Disciplines of the workout's sets. */
  disciplines: ReadonlySet<Sport>;
};

/**
 * The C2 matcher (`matchPlanned`) with the endurance rule of 6.2 step 5: a
 * session with a sport is cleared by a link, by a workout of the same program,
 * or by a workout with a set of that discipline, never by any workout of the
 * day. A workout with sets of two disciplines can clear one session of each,
 * so a brick logged as one workout clears both legs. A workout that cleared a
 * session without a sport is used for the day, as in C2.
 */
export function matchEndurance(planned: MatchPlanned[], sessions: MatchCompleted[]): Map<number, { sessionId: number; step: 1 | 2 | 3 }> {
  const out = new Map<number, { sessionId: number; step: 1 | 2 | 3 }>();
  const used = new Set<string>(); // `${sessionId}|${date}`, or with `|${sport}` for a session with a sport
  const onDate = new Map<string, MatchCompleted[]>();
  for (const s of sessions) {
    for (const d of new Set([s.date, s.intendedDate].filter((x): x is string => x != null))) onDate.set(d, [...(onDate.get(d) ?? []), s]);
  }
  const takeKey = (s: MatchCompleted, p: MatchPlanned) => (p.sport ? `${s.id}|${p.date}|${p.sport}` : `${s.id}|${p.date}`);
  const free = (s: MatchCompleted, p: MatchPlanned) => !used.has(`${s.id}|${p.date}`) && !(p.sport && used.has(takeKey(s, p)));
  for (const p of planned) {
    const s = sessions.find((x) => x.plannedSessionId === p.id);
    if (s) {
      out.set(p.id, { sessionId: s.id, step: 1 });
      used.add(takeKey(s, p));
    }
  }
  const byDate = new Map<string, MatchPlanned[]>();
  for (const p of planned) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
  for (const [date, list] of byDate) {
    const ordered = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
    const candidates = (onDate.get(date) ?? []).slice().sort((a, b) => a.id - b.id);
    for (const step of [2, 3] as const) {
      for (const p of ordered) {
        if (out.has(p.id)) continue;
        const s = candidates.find(
          (c) => free(c, p) && (step === 2 ? c.programId != null && c.programId === p.programId : p.sport == null || c.disciplines.has(p.sport)),
        );
        if (s) {
          out.set(p.id, { sessionId: s.id, step });
          used.add(takeKey(s, p));
        }
      }
    }
  }
  return out;
}

export type GarminCandidate = { id: number; date: string; sport: Sport | "strength" | "other"; durationS: number; distanceM: number | null };
export type GarminRow = { id: number; date: string; position: number; sport: Sport; plannedDurationS: number | null; plannedDistanceM: number | null };

/**
 * Pair sessions still not done with Garmin activities (6.4): same sport, same
 * day; with several on a day, the closest planned and done duration (or
 * distance), in order of position. Each activity is used once; `used` holds
 * activities already taken by a pick or by a logged workout.
 */
export function pairGarmin(rows: GarminRow[], activities: GarminCandidate[], used: ReadonlySet<number> = new Set()): Map<number, number> {
  const out = new Map<number, number>();
  const taken = new Set(used);
  const gap = (r: GarminRow, a: GarminCandidate) => {
    if (r.plannedDurationS && a.durationS > 0) return Math.abs(Math.log(a.durationS / r.plannedDurationS));
    if (r.plannedDistanceM && a.distanceM) return Math.abs(Math.log(a.distanceM / r.plannedDistanceM));
    return 0;
  };
  const ordered = [...rows].sort((a, b) => (a.date === b.date ? a.position - b.position || a.id - b.id : a.date < b.date ? -1 : 1));
  for (const r of ordered) {
    const best = activities
      .filter((a) => !taken.has(a.id) && a.date === r.date && a.sport === r.sport)
      .sort((a, b) => gap(r, a) - gap(r, b) || a.id - b.id)[0];
    if (best) {
      out.set(r.id, best.id);
      taken.add(best.id);
    }
  }
  return out;
}

/** "Did you do it?" covers sessions from this many days back (decision 20). */
export const PROMPT_DAYS = 7;

/**
 * One session's state, first match wins (6.2). `endurance` is the switch;
 * with it off, only C2's states come out (done, skipped, missed, planned).
 */
export function sessionState(p: {
  date: string;
  today: string;
  status: "planned" | "skipped" | "missed";
  sport: Sport | null;
  endurance: boolean;
  linked: boolean;
  picked: boolean;
  appMatched: boolean;
  garminMatched: boolean;
  inIllness: boolean;
}): { state: SessionState; matchedBy: MatchedBy | null } {
  if (p.linked) return { state: "done", matchedBy: "link" };
  if (p.endurance && p.picked) return { state: "done", matchedBy: "pick" };
  if (p.status === "skipped") return { state: "skipped", matchedBy: null };
  if (p.endurance && p.status === "missed") return { state: "missed", matchedBy: null };
  if (p.appMatched) return { state: "done", matchedBy: "app" };
  if (p.endurance && p.garminMatched) return { state: "done", matchedBy: "garmin" };
  if (p.endurance && p.inIllness) return { state: p.date < p.today ? "illness" : "sick", matchedBy: null };
  if (p.date < p.today) {
    if (p.endurance && p.sport != null && p.date >= addDaysStr(p.today, -PROMPT_DAYS)) return { state: "unconfirmed", matchedBy: null };
    return { state: "missed", matchedBy: null };
  }
  return { state: "planned", matchedBy: null };
}

/** A bike or run this long or longer, the longest of its sport in its week, reads as key (inference). */
export const KEY_LONG_SECONDS = 90 * 60;

export type PriorityInput = {
  id: number;
  date: string;
  sport: Sport | null;
  hard: boolean;
  plannedDurationS: number | null;
  stored: "key" | "support" | "optional" | null;
};

/**
 * Each session's priority (3.4): the stored one, else key when hard, or when
 * it is the longest bike or run of its week and at least 90 minutes (D11:
 * long ride, long run; the 90 minutes is inference), else support.
 */
export function effectivePriorities(rows: PriorityInput[]): Map<number, "key" | "support" | "optional"> {
  const longest = new Map<string, number>();
  for (const r of rows) {
    if ((r.sport === "bike" || r.sport === "run") && r.plannedDurationS) {
      const k = `${mondayOf(r.date)}|${r.sport}`;
      longest.set(k, Math.max(longest.get(k) ?? 0, r.plannedDurationS));
    }
  }
  return new Map(
    rows.map((r): [number, "key" | "support" | "optional"] => {
      if (r.stored) return [r.id, r.stored];
      if (r.sport == null) return [r.id, "support"];
      const long =
        (r.sport === "bike" || r.sport === "run") &&
        r.plannedDurationS != null &&
        r.plannedDurationS >= KEY_LONG_SECONDS &&
        r.plannedDurationS === longest.get(`${mondayOf(r.date)}|${r.sport}`);
      return [r.id, r.hard || long ? "key" : "support"];
    }),
  );
}
