// @vitest-environment jsdom
import { AddPhaseFinish, AddPhaseForm } from "@/components/features/AddPhaseForm";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Add a phase (J4_AddPhase, J4_WeekBuilder): step 1 goes on to the season's own step 2, which returns to the season. */

const actions = vi.hoisted(() => ({ addPhaseAction: vi.fn() }));
vi.mock("@/lib/actions/seasons", () => actions);
const nav = vi.hoisted(() => ({ replace: vi.fn(), returnTo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: nav.replace, refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("@/components/ui/BackLink", () => ({
  useBack: () => ({ label: "Season", onClick: vi.fn(), go: vi.fn() }),
  useReturnTo: () => nav.returnTo,
}));

const props = {
  seasonId: 7,
  seasonName: "Jevnaker Half 2027",
  position: 3,
  afterName: "Longer ride and run",
  startsOn: "2027-04-05",
  enduranceEnabled: true,
  taperDays: 10,
  candidates: [],
};

beforeEach(() => {
  actions.addPhaseAction.mockReset();
  actions.addPhaseAction.mockResolvedValue({ success: true, data: { cycleId: 42, raceMoved: false } });
  nav.replace.mockReset();
  nav.returnTo.mockReset();
});

describe("Add a phase", () => {
  it("step 1 goes on to the season's step 2 for the new phase", async () => {
    render(<AddPhaseForm {...props} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Swim, intervals, bricks" } });
    fireEvent.click(screen.getByRole("button", { name: "Build the week" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/seasons/7/phases/42/week"));
  });

  it("keeps the length field from taking the whole row, so Weeks and Days stay visible", () => {
    render(<AddPhaseForm {...props} />);
    expect(screen.getByLabelText("Length").className.split(" ")).not.toContain("w-full");
  });

  it("step 2 finishes with Add phase, back on the season", () => {
    render(<AddPhaseFinish seasonId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Add phase" }));
    expect(nav.returnTo).toHaveBeenCalledWith("/seasons/7");
  });
});
