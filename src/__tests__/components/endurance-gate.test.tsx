// @vitest-environment jsdom
import { EditCycleForm } from "@/components/features/EditCycleForm";
import type { TrainingCycle } from "@/types/workout";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The endurance switch (src/lib/endurance.ts) hides the race field from
 * users who do not have it (decision D18). The Plan list's + menu has no
 * triathlon entry for anyone (components/plan-list.test.tsx).
 */

vi.mock("@/lib/actions/training-cycles", () => ({
  deleteTrainingCycle: vi.fn(),
  deleteManyTrainingCycles: vi.fn(),
  updateTrainingCycle: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const cycle = {
  id: 1,
  userId: "u1",
  name: "Block",
  durationWeeks: 8,
  scheduleType: "day_of_week",
  goal: "build",
  athleteLevel: null,
  lastSyncedWeek: null,
  adaptationPct: 100,
  adaptationNote: null,
  startDate: null,
  raceDate: null,
  raceDistance: null,
  status: "draft",
  endAction: "none",
  endMessage: null,
} as unknown as TrainingCycle;

describe("the endurance switch", () => {
  it("hides the race field when off and the cycle has no race", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.queryByLabelText("Race (optional)")).toBeNull();
  });

  it("shows the race field when on", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled today="2026-11-14" />);
    expect(screen.getByLabelText("Race (optional)")).toBeTruthy();
  });

  it("keeps showing a race the cycle already has, even when off", () => {
    render(<EditCycleForm cycle={{ ...cycle, raceDate: "2027-08-15" }} enduranceEnabled={false} today="2026-11-14" />);
    expect((screen.getByLabelText("Race (optional)") as HTMLInputElement).value).toBe("2027-08-15");
  });
});
