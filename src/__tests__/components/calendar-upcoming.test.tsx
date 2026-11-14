// @vitest-environment jsdom
import { CycleCalendarClient } from "@/components/features/CycleCalendarClient";
import { setUserSettings } from "@/contexts/user-settings-context";
import type { TrainingCycleWithSlots } from "@/types/workout";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A draft that will start (scheduled, or a later season phase) shows on the
 * calendar on its days, and the legend says when it starts, not "draft".
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/planned-sessions", () => ({ updatePlannedSession: vi.fn() }));
vi.mock("@/components/features/PlannedSessionActions", () => ({ PlannedSessionActions: () => null }));
vi.mock("@/components/features/SessionAnswers", () => ({ AnswerButtons: () => null, AnswerSheets: () => null, BandLabel: () => null }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
  setUserSettings({ timeZone: "UTC", units: { distance: "km", swim: "m" } });
});
afterEach(() => vi.useRealTimers());

const draft = {
  id: 29,
  name: "General",
  status: "draft",
  scheduleType: "day_of_week",
  durationWeeks: 8,
  durationDays: null,
  startDate: "2026-11-16",
  scheduledStartDate: "2026-11-16",
  sessionsGeneratedAt: new Date(),
  slots: [{ id: 1, dayOfWeek: 1, programId: 63, label: "Strength", notes: null, program: { id: 63, name: "Ironman Workout A" } }],
} as unknown as TrainingCycleWithSlots;

describe("calendar: a cycle that has not started", () => {
  it("shows its sessions on its days and when it starts", () => {
    render(<CycleCalendarClient cycles={[draft]} completedDates={[]} programsMap={{}} />);
    expect(screen.getByTestId("day-2026-11-16").textContent).toContain("Streng");
    expect(screen.getByTestId("day-2026-11-23").textContent).toContain("Streng");
    expect(screen.getByTestId("day-2026-11-15").textContent).not.toContain("Streng");
    expect(screen.getByText("· starts Nov 16")).toBeTruthy();
    expect(screen.queryByText("· draft")).toBeNull();
  });
});
