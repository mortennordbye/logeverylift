// @vitest-environment jsdom
import { EditCycleForm } from "@/components/features/EditCycleForm";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The endurance switch (src/lib/endurance.ts) hides the race field from
 * users who do not have it (decision D18). The Plan list's + menu has no
 * triathlon entry for anyone (components/plan-list.test.tsx).
 */

vi.mock("@/lib/actions/training-cycles", () => ({
  deleteTrainingCycle: vi.fn(),
  deleteManyTrainingCycles: vi.fn(),
  updateTrainingCycle: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

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
  it("hides the race field when off", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.queryByLabelText("Race day (optional)")).toBeNull();
  });

  it("shows the race field when on", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled today="2026-11-14" />);
    expect(screen.getByLabelText("Race day (optional)")).toBeTruthy();
  });

  it("hides a race the cycle already has when off, and Save leaves it stored (round 8)", async () => {
    render(<EditCycleForm cycle={{ ...cycle, raceDate: "2027-08-15", raceDistance: "half" }} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.queryByLabelText("Race day (optional)")).toBeNull();
    expect(screen.queryByText(/Garmin/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTrainingCycle).toHaveBeenCalled());
    const sent = vi.mocked(updateTrainingCycle).mock.calls[0][0] as Record<string, unknown>;
    expect("raceDate" in sent).toBe(false);
    expect("raceDistance" in sent).toBe(false);
  });

  it("says the race day in words, labels the distance chips, and names no Garmin page (round 8)", () => {
    render(<EditCycleForm cycle={{ ...cycle, raceDate: "2027-08-29", raceDistance: "half" }} enduranceEnabled today="2026-11-14" />);
    expect((screen.getByLabelText("Race day (optional)") as HTMLInputElement).value).toBe("2027-08-29");
    expect(screen.getByText("Sun 29 Aug 2027")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Race distance" })).toBeTruthy();
    expect(screen.getByText("Race distance").className).toContain("uppercase");
    expect(screen.queryByText(/Garmin/)).toBeNull();
  });
});
