/**
 * Made-up data for the widgets' static previews in the gallery and in edit
 * mode, as in the locked design's "Add a widget" sheet
 * (docs/design/home-redesign/home-locked.html). The same for every user:
 * never the user's data, and nothing here reads the database.
 */

import type { EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";
import type { HomeCore } from "@/lib/home/core";
import type { WeightSummary } from "@/lib/home/widget-data";
import type { FriendWorkout } from "./widgets/friends-activity/load";
import type { GarminReadinessData } from "./widgets/garmin-readiness/load";
import type { RaceCountdownData } from "./widgets/race-countdown/load";
import type { RecentPr } from "./widgets/recent-prs/load";
import type { StreakData } from "./widgets/streak/load";
import type { TodayData } from "./widgets/today/View";
import type { TrainingLoadData } from "./widgets/training-load/load";
import type { WeeklySetsData } from "./widgets/weekly-sets/load";

const CYCLE = { name: "Hypertrophy Block", currentWeek: 4, durationWeeks: 8, progressPct: 37.5, endFormatted: "Dec 4" };

export const SAMPLE_TODAY: TodayData = {
  cycle: CYCLE,
  todayProgram: { id: 0, name: "Upper Body A" },
  todaySessions: [],
  severalToday: false,
  completedToday: false,
  todayAutoSession: null,
  isRestDay: false,
  rotationOverdueDays: 0,
  insight: undefined,
  plan: {
    exerciseCount: 6,
    setCount: 24,
    minutes: 55,
    exercises: [
      { name: "Bench Press", sets: "4 × 6–8 · 80 kg" },
      { name: "Barbell Row", sets: "4 × 8 · 70 kg" },
      { name: "Overhead Press", sets: "3 × 8 · 47.5 kg" },
    ],
    more: ["Pull-up", "Lateral Raise", "Triceps Pushdown"],
  },
};

export const SAMPLE_CYCLE = CYCLE;

/** A week from Monday 9 to Sunday 15 November, today Friday, two days trained. */
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
export const SAMPLE_WEEK_CORE = {
  info: null,
  weekDates: WEEK,
  todayStr: WEEK[4],
  completedDates: new Set([WEEK[0], WEEK[1]]),
  weekPlanned: [],
  stats: { totalWorkouts: 0, totalReps: 0, totalSets: 0, thisWeekWorkouts: 2 },
} as unknown as HomeCore;

export const SAMPLE_WORKOUTS_THIS_WEEK = 2;

export const SAMPLE_ENDURANCE: EnduranceTodayRow[] = [
  { id: 0, name: "Tempo run", sport: "run", summary: "3 x 10 min at threshold", amount: "50 min · 10 km", done: false },
];

export const SAMPLE_PRS: RecentPr[] = [
  { id: 1, exercise: "Bench Press", value: "82.5 kg", kind: "Heaviest set", date: "11 Nov" },
  { id: 2, exercise: "Romanian Deadlift", value: "120 kg", kind: "Heaviest set", date: "9 Nov" },
  { id: 3, exercise: "Overhead Press", value: "50 kg", kind: "Heaviest set", date: "5 Nov" },
  { id: 4, exercise: "Pull-up", value: "8 reps", kind: "Most reps", date: "3 Nov" },
  { id: 5, exercise: "Back Squat", value: "110 kg", kind: "Heaviest set", date: "30 Oct" },
  { id: 6, exercise: "Barbell Row", value: "75 kg", kind: "Heaviest set", date: "28 Oct" },
];

export const SAMPLE_FRIENDS: FriendWorkout[] = [
  { name: "Ola N", image: null, date: "2026-11-13", programName: "Upper Body", setCount: 12, sessionId: 1 },
  { name: "Ingrid S", image: null, date: "2026-11-13", programName: "Legs", setCount: 18, sessionId: 2 },
  { name: "Jonas B", image: null, date: "2026-11-12", programName: "Push", setCount: 14, sessionId: 3 },
  { name: "Sara L", image: null, date: "2026-11-12", programName: "Full Body", setCount: 16, sessionId: 4 },
  { name: "Erik H", image: null, date: "2026-11-11", programName: "Pull", setCount: 15, sessionId: 5 },
  { name: "Maja K", image: null, date: "2026-11-10", programName: "Lower Body", setCount: 13, sessionId: 6 },
];

export const SAMPLE_READINESS: GarminReadinessData = {
  connected: true,
  readiness: {
    score: 68,
    band: "as_planned",
    signals: 5,
    capped: false,
    contributors: [
      { key: "hrv", score: 72, detail: "58 ms" },
      { key: "restingHr", score: 60, detail: "49 bpm" },
      { key: "sleep", score: 81, detail: "7h 42m" },
    ],
  } as Extract<GarminReadinessData, { connected: true }>["readiness"],
};

export const SAMPLE_STREAK: StreakData = { weeks: 9, perWeek: [3, 4, 4, 3, 4, 5, 4, 2] };

const WEIGHTS = [83.1, 83.0, 83.2, 82.9, 83.0, 82.8, 82.9, 83.0, 82.7, 82.8, 82.9, 82.6, 82.7, 82.8, 82.6, 82.5, 82.7, 82.6, 82.4, 82.6, 82.5, 82.6, 82.4, 82.3, 82.5, 82.4, 82.3, 82.5, 82.4, 82.4];
export const SAMPLE_WEIGHT: WeightSummary = { latestKg: 82.4, changeKg: -0.7, lowKg: 82.3, highKg: 83.2, series: WEIGHTS, oldDate: null };

const LOADS = [62, 0, 48, 70, 0, 55, 0, 66, 0, 52, 74, 0, 58, 0, 71, 0, 60, 80, 0, 64, 0, 0, 68, 0, 72, 59, 0, 0];
/** Fatigue as a 7-day exponential average of the loads, from 40. */
const FATIGUE = LOADS.reduce<number[]>((out, l) => [...out, (out.at(-1) ?? 40) + (l - (out.at(-1) ?? 40)) / 7], []);
export const SAMPLE_LOAD: TrainingLoadData = { loads: LOADS, fatigue: FATIGUE, form: 6, formLabel: "Fresh", weekLoad: 199, ramp: "normal" };

export const SAMPLE_SETS: WeeklySetsData = {
  total: 38,
  muscles: [
    { name: "chest", sets: 10, target: 10 },
    { name: "back", sets: 12, target: 10 },
    { name: "legs", sets: 6, target: 10 },
    { name: "arms", sets: 8, target: 10 },
  ],
};

export const SAMPLE_RACE: RaceCountdownData = { name: "Oslo Half", dateLabel: "6 Dec", days: 23, seasonId: 0 };
