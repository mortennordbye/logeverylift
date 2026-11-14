// @vitest-environment jsdom
import { EditCycleForm } from "@/components/features/EditCycleForm";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Edit details screen in the Plan look (docs/design/plan-redesign/spec.md,
 * J2_CycleSetup): the setup form's words, a back link to the cycle, and no
 * colon or em dash in what the user reads.
 */

vi.mock("@/lib/actions/training-cycles", () => ({
  updateTrainingCycle: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

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
  it("is titled Edit cycle, with a back link to the cycle", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edit cycle");
    const back = screen.getByTestId("back-link");
    expect(back.getAttribute("href")).toBe("/cycles/3");
    expect(back.getAttribute("aria-label")).toBe("Back to Upper / Lower");
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

  it("shows the schedule type read-only, in the setup form's words", () => {
    const { rerender } = render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    const same = screen.getByRole("radio", { name: /Same days each week/ }) as HTMLInputElement;
    expect(same.checked).toBe(true);
    expect(same.disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Rotation/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("The schedule type can't be changed after the cycle is made.")).toBeTruthy();
    rerender(<EditCycleForm cycle={{ ...cycle, scheduleType: "rotation" }} enduranceEnabled={false} today="2026-11-14" />);
    expect((screen.getByRole("radio", { name: /Rotation/ }) as HTMLInputElement).checked).toBe(true);
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
});
