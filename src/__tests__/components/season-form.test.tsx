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
  today: "2026-11-14",
  running: null,
  scheduled: null,
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

describe("a dimmed Create season says what is missing", () => {
  const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

  it("asks for a name, then an end, then a cycle", () => {
    render(<SeasonForm {...create} enduranceEnabled={false} />);
    const button = screen.getByRole("button", { name: "Create season" });
    expect(reasonOf(button)).toBe("Give the season a name.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spring" } });
    expect(reasonOf(button)).toBe("Pick an end day.");
    fireEvent.click(screen.getByRole("button", { name: "Change end" }));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-01" } });
    expect(button.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Use cycles I already have/));
    expect(reasonOf(button)).toBe("Pick at least one cycle.");
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
    expect(within(planned).getAllByRole("listitem").map((li) => li.textContent!.replace(/\u00a0/g, " "))).toEqual([
      "General · 7 wk · 16 Nov – 3 Jan",
      "Base · 15 wk · 4 Jan – 18 Apr",
      "Build · 15 wk 4 days · 19 Apr – 5 Aug",
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

describe("New season while another block holds the start (fix round 4)", () => {
  // Upper / Lower (id 3) runs from 2 Nov; Build of another season is scheduled for 14 Dec.
  const busy = {
    ...create,
    running: { id: 3, name: "Upper / Lower hypertrophy", startDate: "2026-11-02", durationWeeks: 6, durationDays: null, seasonId: null },
    scheduled: { id: 5, name: "Build", day: "2026-12-14", season: { id: 9, name: "Jevnaker Half 2027" } },
  };
  const ends = "This ends Upper / Lower hypertrophy at week 2 of 6.";
  const drops = "Jevnaker Half 2027 pauses. Its next phase no longer starts Mon 14 Dec. You can resume it from the season.";
  const title = "Start this season Mon 16 Nov?";

  function fillPlan() {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Oslo Tri 2027" } });
    fireEvent.change(screen.getByLabelText("Race name"), { target: { value: "Oslo 70.3" } });
    fireEvent.change(screen.getByLabelText("Race date"), { target: { value: "2027-08-29" } });
    fireEvent.click(within(triathlonCard()).getByRole("radio"));
  }

  it("a triathlon plan says what it ends and drops, and is made only after the confirm", async () => {
    render(<SeasonForm {...busy} />);
    fillPlan();
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    const sheet = await screen.findByRole("region", { name: title });
    const text = sheet.textContent!.replace(/\u00a0/g, " ");
    expect(text).toContain(ends);
    expect(text).toContain(drops);
    expect(mocks.generateTriathlonPlan).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole("button", { name: "Create season" }));
    await waitFor(() => expect(mocks.generateTriathlonPlan).toHaveBeenCalledWith(expect.objectContaining({ name: "Oslo Tri 2027", takeStart: true })));
  });

  it("Cancel in the confirm makes nothing", async () => {
    render(<SeasonForm {...busy} />);
    fillPlan();
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    const sheet = await screen.findByRole("region", { name: title });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: title })).toBeNull());
    expect(mocks.generateTriathlonPlan).not.toHaveBeenCalled();
  });

  it("cycles I already have ask first too", async () => {
    render(<SeasonForm {...busy} enduranceEnabled={false} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spring" } });
    fireEvent.click(screen.getByRole("button", { name: "Change end" }));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-01" } });
    fireEvent.click(screen.getByLabelText(/Use cycles I already have/));
    fireEvent.click(within(screen.getByRole("list", { name: "Your cycles" })).getByLabelText(/Strength peak/));
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    const sheet = await screen.findByRole("region", { name: title });
    expect(sheet.textContent!.replace(/\u00a0/g, " ")).toContain(ends);
    fireEvent.click(within(sheet).getByRole("button", { name: "Create season" }));
    await waitFor(() => expect(mocks.createSeasonAction).toHaveBeenCalledWith(expect.objectContaining({ cycleIds: [2], takeStart: true })));
  });

  it("asks nothing when the running cycle joins, or the season has no phases yet", async () => {
    render(<SeasonForm {...busy} enduranceEnabled={false} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spring" } });
    fireEvent.click(screen.getByRole("button", { name: "Change end" }));
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    await waitFor(() => expect(mocks.createSeasonAction).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText(/Use cycles I already have/));
    fireEvent.click(within(screen.getByRole("list", { name: "Your cycles" })).getByLabelText(/Upper \/ Lower/));
    fireEvent.click(screen.getByRole("button", { name: "Create season" }));
    await waitFor(() => expect(mocks.createSeasonAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: title })).toBeNull();
  });
});
