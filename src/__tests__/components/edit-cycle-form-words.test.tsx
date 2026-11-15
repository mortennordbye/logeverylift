// @vitest-environment jsdom
import { EditCycleForm } from "@/components/features/EditCycleForm";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Edit details screen in the Plan look (docs/design/plan-redesign/spec.md,
 * J2_CycleSetup): the setup form's words and header, Cancel back to the cycle, and no
 * colon or em dash in what the user reads.
 */

vi.mock("@/lib/actions/training-cycles", () => ({
  updateTrainingCycle: vi.fn(async () => ({ success: true, data: {} })),
}));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }) }));

const cycle = {
  id: 3,
  userId: "u1",
  name: "Upper / Lower",
  durationWeeks: 8,
  durationDays: null,
  scheduleType: "day_of_week",
  startDate: null,
  status: "draft",
  endAction: "none",
  endMessage: null,
  raceDate: null,
  raceDistance: null,
  seasonId: null,
} as unknown as TrainingCycle;

afterEach(cleanup);

describe("the Edit details screen", () => {
  it("has the form header of New cycle: Cancel, then Edit details centred, the words of the menu item; Cancel goes back to the cycle", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    const header = screen.getByTestId("form-header");
    // Two equal side columns keep the title in the middle, whatever is on the left.
    expect(header.className).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("Edit details");
    expect(screen.queryByTestId("back-link")).toBeNull();
    fireEvent.click(within(header).getByRole("button", { name: "Cancel" }));
    expect(replace).toHaveBeenCalledWith("/cycles/3");
  });

  it("offers the setup form's end options as chips and saves the one picked", async () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    const group = screen.getByRole("group", { name: "When it ends" });
    const chips = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(chips).toEqual(["Just stop", "Deload week", "Start a new cycle", "Rest period"]);
    expect(screen.getByRole("button", { name: "Just stop" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Rest period" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTrainingCycle).toHaveBeenCalledWith(expect.objectContaining({ id: 3, endAction: "rest" })));
  });

  it("shows the schedule type locked, in the setup form's words: no radio or press look to tap (round 9)", () => {
    const { rerender } = render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const locked = screen.getByTestId("schedule-type");
    expect(locked.tagName).not.toBe("LABEL");
    expect(locked.className).not.toMatch(/active:/);
    expect(locked.textContent).toContain("Same days each week");
    expect(locked.textContent).not.toContain("Rotation");
    expect(screen.getByText("The schedule type can't be changed after the cycle is made.")).toBeTruthy();
    rerender(<EditCycleForm cycle={{ ...cycle, scheduleType: "rotation" }} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.getByTestId("schedule-type").textContent).toContain("Rotation");
  });

  it("the Race day helper names no distance field before a race day is set (round 9)", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled today="2026-11-14" />);
    expect(screen.queryByRole("group", { name: "Race distance" })).toBeNull();
    expect(screen.getByText("The race countdown uses this day.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("the distance");
    cleanup();
    render(<EditCycleForm cycle={{ ...cycle, raceDate: "2027-08-22" }} enduranceEnabled today="2026-11-14" />);
    expect(screen.getByRole("group", { name: "Race distance" })).toBeTruthy();
    expect(screen.getByText("The race countdown uses this day, and your training is checked against the race distance.")).toBeTruthy();
  });

  it("has no colon or em dash in its text, with or without a season", () => {
    const { container, rerender } = render(<EditCycleForm cycle={cycle} enduranceEnabled today="2026-11-14" />);
    expect(container.textContent).not.toMatch(/[:—]/);
    rerender(<EditCycleForm cycle={{ ...cycle, seasonId: 7, durationDays: 10 } as TrainingCycle} enduranceEnabled liveSeasonId={7} today="2026-11-14" />);
    expect(container.textContent).not.toMatch(/[:—]/);
    expect(container.textContent).toContain("10 days. This cycle is a phase of a season. Change its length and phase type on the season page.");
  });

  it("gives the season page link a 44px tap target", () => {
    render(<EditCycleForm cycle={{ ...cycle, seasonId: 7 } as TrainingCycle} enduranceEnabled={false} liveSeasonId={7} today="2026-11-14" />);
    const link = screen.getByRole("link", { name: "season page" });
    expect(link.getAttribute("href")).toBe("/seasons/7");
    expect(link.className).toMatch(/min-h-11/);
  });

  it("a dimmed Save says what is missing", () => {
    const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
    expect(reasonOf(save)).toBe("Give the cycle a name.");
  });
});

describe("two tabs (round 8 B13)", () => {
  it("sends the version it read, so a stale tab cannot undo another tab's save", async () => {
    render(<EditCycleForm cycle={{ ...cycle, version: 4 } as TrainingCycle} enduranceEnabled={false} today="2026-11-14" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTrainingCycle).toHaveBeenCalledWith(expect.objectContaining({ id: 3, expectedVersion: 4 })));
  });

  it("shows the refusal of a stale save", async () => {
    vi.mocked(updateTrainingCycle).mockResolvedValueOnce({ success: false, error: "This cycle changed in another tab. Reload to see it." });
    render(<EditCycleForm cycle={{ ...cycle, version: 4 } as TrainingCycle} enduranceEnabled={false} today="2026-11-14" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This cycle changed in another tab. Reload to see it."));
  });
});
