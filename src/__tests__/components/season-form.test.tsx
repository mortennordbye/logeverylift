// @vitest-environment jsdom
import { SeasonForm } from "@/components/features/SeasonForm";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * New season (J4_SeasonSetup): the race and the triathlon plan only with the
 * endurance switch, the end on race day, and where the phases come from.
 */

const mocks = vi.hoisted(() => ({
  createSeasonAction: vi.fn(async () => ({ success: true as const, data: { id: 11 } })),
  generateTriathlonPlan: vi.fn(async () => ({ success: true as const, data: { seasonId: 12 } })),
  replace: vi.fn(),
}));
vi.mock("@/lib/actions/seasons", () => ({
  createSeasonAction: mocks.createSeasonAction,
  updateSeasonAction: vi.fn(),
  deleteSeasonAction: vi.fn(),
}));
vi.mock("@/lib/actions/triathlon-plan", () => ({ generateTriathlonPlan: mocks.generateTriathlonPlan }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: vi.fn(), back: vi.fn() }) }));

const create = {
  defaultStart: "2026-11-16",
  enduranceEnabled: true,
  interviewDone: true,
  candidates: [
    { id: 3, name: "Upper / Lower hypertrophy", status: "active" },
    { id: 2, name: "Strength peak", status: "draft" },
  ],
};

const triathlonCard = () => screen.getByText("Make a triathlon plan").closest("label")!;

beforeEach(() => {
  mocks.createSeasonAction.mockClear();
  mocks.generateTriathlonPlan.mockClear();
  mocks.replace.mockClear();
});

describe("New season for a gym user", () => {
  it("shows no race and no triathlon plan, and makes a goal season with no race", async () => {
    render(<SeasonForm {...create} enduranceEnabled={false} />);
    expect(screen.queryByText("Race (optional)")).toBeNull();
    expect(screen.queryByText("Make a triathlon plan")).toBeNull();
    expect(screen.getByText("Mon 16 Nov 2026")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bench 120 kg" } });
    const createButton = screen.getByRole("button", { name: "Create season" }) as HTMLButtonElement;
    // No end yet.
    expect(createButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Change end" }));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-06-01" } });
    fireEvent.click(createButton);
    await waitFor(() =>
      expect(mocks.createSeasonAction).toHaveBeenCalledWith({ name: "Bench 120 kg", goal: null, startDate: "2026-11-16", endDate: "2027-06-01" }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/seasons/11");
  });

  it("adds the picked cycles as phases in the order they were picked", async () => {
    render(<SeasonForm {...create} enduranceEnabled={false} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spring" } });
    fireEvent.click(screen.getByRole("button", { name: "Change end" }));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-01" } });
    fireEvent.click(screen.getByLabelText(/Use cycles I already have/));
    const list = screen.getByRole("list", { name: "Your cycles" });
    fireEvent.click(within(list).getByLabelText(/Strength peak/));
    fireEvent.click(within(list).getByLabelText(/Upper \/ Lower/));
    expect(within(list).getByText("Phase 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    await waitFor(() => expect(mocks.createSeasonAction).toHaveBeenCalledWith(expect.objectContaining({ cycleIds: [2, 3] })));
  });
});

describe("New season with the endurance switch", () => {
  function fillRace(date = "2027-08-29") {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jevnaker Half 2027" } });
    fireEvent.change(screen.getByLabelText("Race name"), { target: { value: "Jevnaker Halv Full Distanse" } });
    fireEvent.change(screen.getByLabelText("Race date"), { target: { value: date } });
  }

  it("ends on the A race day, and sends the race with the season", async () => {
    render(<SeasonForm {...create} />);
    fillRace();
    expect(screen.getByText("29 Aug 2027 · race day")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    await waitFor(() =>
      expect(mocks.createSeasonAction).toHaveBeenCalledWith({
        name: "Jevnaker Half 2027",
        goal: null,
        startDate: "2026-11-16",
        endDate: "2027-08-29",
        race: { name: "Jevnaker Halv Full Distanse", raceDate: "2027-08-29", discipline: "triathlon", distance: "half", distanceMeters: null, priority: "A" },
      }),
    );
  });

  it("makes a triathlon plan once a triathlon A race is given, and shows its phases", async () => {
    render(<SeasonForm {...create} />);
    const radio = within(triathlonCard()).getByRole("radio") as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(triathlonCard().textContent).toContain("Add a triathlon A race above first.");

    fillRace();
    fireEvent.click(radio);
    const planned = screen.getByRole("list", { name: "Planned phases" });
    expect(within(planned).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "General · 7 wk · 16 Nov – 3 Jan",
      "Base · 15 wk · 4 Jan – 18 Apr",
      "Build · 109 days · 19 Apr – 5 Aug",
      "Peak · 2 wk · 6 – 19 Aug",
      "Taper · 10 days · 20 – 29 Aug",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    await waitFor(() =>
      expect(mocks.generateTriathlonPlan).toHaveBeenCalledWith({
        name: "Jevnaker Half 2027",
        goal: null,
        startDate: "2026-11-16",
        race: { name: "Jevnaker Halv Full Distanse", raceDate: "2027-08-29", distance: "half" },
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/seasons/12");
  });

  it("says why there is no plan for a race too close", () => {
    render(<SeasonForm {...create} initialSource="triathlon" />);
    fillRace("2026-12-10");
    expect(triathlonCard().textContent).toContain("A plan needs at least 6 weeks before the race.");
    expect((screen.getByRole("button", { name: "Create season" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends a user without the intake interview to it first", () => {
    render(<SeasonForm {...create} interviewDone={false} />);
    expect(screen.getByRole("link", { name: /Make a triathlon plan/ }).getAttribute("href")).toBe("/more/athlete/interview?next=/seasons/new");
  });
});
