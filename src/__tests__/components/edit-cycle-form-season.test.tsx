// @vitest-environment jsdom
import { EditCycleForm } from "@/components/features/EditCycleForm";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The cycle form for a phase of a season (docs/plans/seasons.md, 2.10): no race
 * field (the season holds the race, D8), the length set on the season page,
 * and a save that leaves a length in days alone (T8).
 */

vi.mock("@/lib/actions/training-cycles", () => ({
  updateTrainingCycle: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const base = {
  id: 1,
  userId: "u1",
  name: "Taper",
  durationWeeks: 2,
  durationDays: 10,
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
  seasonId: 7,
  phaseOrder: 2,
  phaseType: "taper",
} as unknown as TrainingCycle;

describe("a cycle that is a phase of a season", () => {
  it("shows no race field, even with the endurance switch on, and points to the season", () => {
    render(<EditCycleForm cycle={base} enduranceEnabled liveSeasonId={7} />);
    expect(screen.queryByLabelText("Race (optional)")).toBeNull();
    expect(screen.getByTestId("season-race-note").textContent).toContain("Races are set on the season");
    expect(screen.getByRole("link", { name: "season page" }).getAttribute("href")).toBe("/seasons/7");
    expect(screen.queryByRole("button", { name: "8w" })).toBeNull();
  });

  it("acts as a cycle with no season once its season is deleted: the race field is back", () => {
    render(<EditCycleForm cycle={{ ...base, raceDate: "2027-08-22" }} enduranceEnabled liveSeasonId={null} />);
    expect((screen.getByLabelText("Race (optional)") as HTMLInputElement).value).toBe("2027-08-22");
    expect(screen.queryByTestId("season-race-note")).toBeNull();
  });

  it("saves the name without a length, so 10 days stay 10 days", async () => {
    render(<EditCycleForm cycle={base} enduranceEnabled liveSeasonId={7} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Spring Strength Block"), { target: { value: "Race taper" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(updateTrainingCycle).toHaveBeenCalled());
    const sent = vi.mocked(updateTrainingCycle).mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 1, name: "Race taper", durationWeeks: undefined, raceDate: null, raceDistance: null });
  });
});
