// @vitest-environment jsdom
import { SeasonDetailClient } from "@/components/features/SeasonDetailClient";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** A failed save in a season's sheet shows its error in the sheet, not behind it. */

vi.mock("@/lib/actions/seasons", () => {
  const fail = vi.fn(async () => ({ success: false, error: "A season holds at most 12 phases." }));
  return {
    addPhaseAction: fail,
    addRaceAction: fail,
    clearReplanAction: fail,
    fitTaperAction: fail,
    movePhaseAction: fail,
    removePhaseAction: fail,
    removeRaceAction: fail,
    resumeSeasonAction: fail,
    setPhaseAction: fail,
    updateRaceAction: fail,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const props = {
  seasonId: 1,
  enduranceEnabled: true,
  replan: null,
  races: [],
  phases: [],
  taperFit: { status: "none" } as never,
  next: null,
  gapBefore: 0,
  overrunAfter: 0,
  candidates: [],
};

describe("season sheet errors", () => {
  it("shows a failed phase save inside the open sheet", async () => {
    render(<SeasonDetailClient {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add phase" }));
    const sheet = screen.getByRole("heading", { name: "Add phase" }).parentElement!;
    fireEvent.change(within(sheet).getByPlaceholderText("e.g. Base"), { target: { value: "Base" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add phase" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("at most 12 phases"));
  });

  it("shows a failed race save inside the open sheet", async () => {
    render(<SeasonDetailClient {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add race" }));
    const sheet = screen.getByRole("heading", { name: "New race" }).parentElement!;
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Haugesund" } });
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2027-08-22" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    await waitFor(() => expect(within(sheet).getByRole("alert")).toBeTruthy());
  });
});
