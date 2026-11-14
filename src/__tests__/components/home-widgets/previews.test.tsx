// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The gallery and edit-mode previews render each widget's real view with
 * made-up sample data (src/components/features/home/samples.ts), the same
 * for every user: no loader runs, so no user data and no query.
 */

const loads = vi.hoisted(() => ({
  recentPrs: vi.fn(),
  friendsActivity: vi.fn(),
  garminReadiness: vi.fn(),
  streak: vi.fn(),
  bodyWeight: vi.fn(),
  trainingLoad: vi.fn(),
  weeklySets: vi.fn(),
  raceCountdown: vi.fn(),
}));
vi.mock("@/components/features/home/widgets/recent-prs/load", () => ({ loadRecentPrs: loads.recentPrs }));
vi.mock("@/components/features/home/widgets/friends-activity/load", () => ({ loadFriendsActivity: loads.friendsActivity }));
vi.mock("@/components/features/home/widgets/garmin-readiness/load", () => ({ loadGarminReadiness: loads.garminReadiness }));
vi.mock("@/components/features/home/widgets/streak/load", () => ({ loadStreak: loads.streak }));
vi.mock("@/components/features/home/widgets/body-weight/load", () => ({ loadBodyWeight: loads.bodyWeight }));
vi.mock("@/components/features/home/widgets/training-load/load", () => ({ loadTrainingLoad: loads.trainingLoad }));
vi.mock("@/components/features/home/widgets/weekly-sets/load", () => ({ loadWeeklySets: loads.weeklySets }));
vi.mock("@/components/features/home/widgets/race-countdown/load", () => ({ loadRaceCountdown: loads.raceCountdown }));
vi.mock("@/components/ui/theme-provider", () => ({ useTheme: () => ({ weeklyGoal: 4 }) }));
vi.mock("@/components/features/SkipAutoDayButton", () => ({ SkipAutoDayButton: () => null }));
vi.mock("@/components/features/guided/SavedRunLink", () => ({ SavedRunLink: () => null }));

const { RENDERERS } = await import("@/components/features/home/widgets");
const { WIDGETS } = await import("@/lib/home/widgets");

/** One piece of sample text each preview must show (samples.ts). */
const SAMPLE_TEXT: Record<keyof typeof RENDERERS, RegExp> = {
  title: /LogEveryLift/,
  today: /Upper Body A/,
  cycle: /Hypertrophy Block|of 8/,
  date: /Friday, 13 November/,
  enduranceToday: /Tempo run/,
  week: /This week/,
  weeklyGoal: /Weekly goal/,
  recentPrs: /Bench Press/,
  friendsActivity: /Ola N/,
  garminReadiness: /^68$/,
  streak: /^9$/,
  bodyWeight: /^82\.4$/,
  trainingLoad: /Form · Fresh/,
  weeklySets: /^38$/,
  raceCountdown: /Oslo Half · 6 Dec/,
};

afterEach(cleanup);

describe("previews show sample data, never the user's", () => {
  for (const [id, def] of Object.entries(WIDGETS)) {
    it(id, () => {
      const r = RENDERERS[id as keyof typeof RENDERERS];
      for (const size of def.sizes) {
        const v = render(<>{r.Preview({ size })}</>);
        expect(screen.getAllByText(SAMPLE_TEXT[id as keyof typeof RENDERERS]).length, `${id} ${size}`).toBeGreaterThan(0);
        v.unmount();
      }
      for (const load of Object.values(loads)) expect(load).not.toHaveBeenCalled();
    });
  }
});
