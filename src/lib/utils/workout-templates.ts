/**
 * The blocks "Add" offers in the workout editor (docs/plans/bike-sessions.md,
 * 5.3), and the FTP test (7.3). Plain data: a template inserts normal steps
 * the user can change. Each one passes parseWorkout as a bike workout.
 */

import type { WorkoutNode, WorkoutStep } from "@/lib/utils/workout-steps";

export type WorkoutTemplate = { id: string; name: string; nodes: readonly WorkoutNode[] };

const MIN = 60;
const easy = (minutes: number): WorkoutStep => ({ type: "recovery", end: { type: "time", seconds: minutes * MIN }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 } });
const work = (minutes: number, low: number, high: number, note?: string): WorkoutStep => ({
  type: "work",
  end: { type: "time", seconds: minutes * MIN },
  target: { metric: "power", anchor: "ftp", low, high },
  cadence: { low: 85, high: 95 },
  ...(note && { note }),
});

/** The id of the FTP test template: the hub links "Plan an FTP test" to it. */
export const FTP_TEST_TEMPLATE_ID = "ftp-test";
/** The id of the FTP test's 20 min all-out step, whose average power gives the FTP (95 %). */
export const FTP_TEST_STEP_ID = "ftp20";

export const WORKOUT_TEMPLATES: readonly WorkoutTemplate[] = [
  {
    id: "warmup-15",
    name: "Warm-up 15 min",
    nodes: [{ type: "warmup", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 60, high: 72 }, note: "Build up in the last 5 min" }],
  },
  { id: "tempo-2x15", name: "Tempo 2 x 15 min", nodes: [{ type: "repeat", count: 2, steps: [work(15, 75, 80, "Talk in short sentences"), easy(5)] }] },
  { id: "sweet-spot-3x12", name: "Sweet spot 3 x 12 min", nodes: [{ type: "repeat", count: 3, steps: [work(12, 88, 93), easy(3)] }] },
  { id: "threshold-2x20", name: "Threshold 2 x 20 min", nodes: [{ type: "repeat", count: 2, steps: [work(20, 95, 100), easy(5)] }] },
  { id: "vo2-5x4", name: "VO2 5 x 4 min", nodes: [{ type: "repeat", count: 5, steps: [work(4, 106, 120), easy(4)] }] },
  {
    id: "over-unders-3x3",
    name: "Over-unders 3 x (2 + 1) min",
    nodes: [{ type: "repeat", count: 3, steps: [work(2, 95, 97, "Under"), work(1, 105, 110, "Over")] }],
  },
  {
    id: "fuel-cue",
    name: "Fuel cue",
    nodes: [{ type: "steady", end: { type: "time", seconds: 20 * MIN }, target: { metric: "power", anchor: "ftp", low: 61, high: 72 }, note: "Eat 15-20 g carbs now" }],
  },
  { id: "cooldown-10", name: "Cool-down 10 min", nodes: [{ type: "cooldown", end: { type: "time", seconds: 10 * MIN }, target: { metric: "power", anchor: "ftp", high: 60 } }] },
  {
    id: FTP_TEST_TEMPLATE_ID,
    name: "FTP test",
    nodes: [
      { type: "warmup", end: { type: "time", seconds: 14 * MIN }, target: { metric: "power", anchor: "ftp", low: 55, high: 70 } },
      {
        type: "repeat",
        count: 2,
        steps: [
          { type: "work", end: { type: "time", seconds: 1 * MIN }, target: { metric: "power", anchor: "ftp", low: 70, high: 80 }, cadence: { low: 100, high: 110 }, note: "High cadence, easy power" },
          easy(2),
        ],
      },
      easy(5),
      { type: "work", end: { type: "time", seconds: 5 * MIN }, target: { metric: "power", anchor: "ftp", low: 100, high: 110 }, note: "Hard, but even" },
      easy(10),
      {
        id: FTP_TEST_STEP_ID,
        type: "steady",
        end: { type: "time", seconds: 20 * MIN },
        target: { metric: "power", anchor: "ftp", low: 95 },
        note: "All out for 20 min. Hold an even power.",
      },
      { type: "cooldown", end: { type: "time", seconds: 10 * MIN }, target: { metric: "power", anchor: "ftp", high: 60 } },
    ],
  },
];

export function templateById(id: string): WorkoutTemplate | null {
  return WORKOUT_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** The FTP test as a whole bike workout, before parseWorkout. */
export function ftpTestWorkout() {
  return {
    v: 1 as const,
    sport: "bike" as const,
    name: "FTP test",
    description: "Take 95 % of the average power of the 20 min step as your FTP.",
    steps: [...templateById(FTP_TEST_TEMPLATE_ID)!.nodes],
  };
}

/**
 * Where "Plan an FTP test" goes: the new-workout editor with the FTP test
 * filled in. With a cycle and a day, Save also plans it on that day.
 */
export function ftpTestHref(plan?: { cycleId: number; date: string }): string {
  const q = new URLSearchParams({ template: FTP_TEST_TEMPLATE_ID });
  if (plan) {
    q.set("cycle", String(plan.cycleId));
    q.set("date", plan.date);
  }
  return `/more/workouts/new?${q.toString()}`;
}
