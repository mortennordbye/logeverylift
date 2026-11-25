// @vitest-environment jsdom
import { AddPhaseCancel, AddPhaseFinish, AddPhaseForm } from "@/components/features/AddPhaseForm";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The fixed 2026 dates here read without a year only while the clock is in
// 2026 (yearSuffix in src/lib/utils/date-label.ts). Pinned at load, before any
// fixture below is built.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
afterAll(() => vi.useRealTimers());

/** Add a phase (J4_AddPhase, J4_WeekBuilder): step 1 goes on to the season's own step 2, which returns to the season. */

const actions = vi.hoisted(() => ({ addPhaseAction: vi.fn() }));
vi.mock("@/lib/actions/seasons", () => actions);
const cycles = vi.hoisted(() => ({ deleteTrainingCycle: vi.fn() }));
vi.mock("@/lib/actions/training-cycles", () => cycles);
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
  today: "2026-11-14",
  running: null,
  scheduled: null,
  raceDate: "2027-08-29" as string | null,
  seasonEnd: "2027-08-29",
};

beforeEach(() => {
  actions.addPhaseAction.mockReset();
  actions.addPhaseAction.mockResolvedValue({ success: true, data: { cycleId: 42, raceMoved: false } });
  cycles.deleteTrainingCycle.mockReset();
  cycles.deleteTrainingCycle.mockResolvedValue({ success: true, data: undefined });
  nav.replace.mockReset();
  nav.returnTo.mockReset();
});

describe("Add a phase", () => {
  it("a dimmed Cycle I already have says why, and the source cards stack (J4-09)", () => {
    render(<AddPhaseForm {...props} />);
    const radio = screen.getByRole("radio", { name: /Cycle I already have/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText("No cycle can be added. Only a draft or the running cycle outside a season can be a phase.")).toBeTruthy();
    expect(radio.closest("fieldset")!.className).toContain("flex-col");
  });

  it("the Name placeholder is neutral, not a phase name the season may have (round 8)", () => {
    render(<AddPhaseForm {...props} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).placeholder).toBe("Phase name");
  });

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

  it("warns when the new phase starts after race day (J4-09)", () => {
    render(<AddPhaseForm {...props} startsOn="2027-08-30" raceDate="2027-08-29" seasonEnd="2027-08-29" />);
    expect(screen.getByText("This phase starts after race day on 29 Aug 2027.")).toBeTruthy();
  });

  it("warns when the length runs past the season end, and not when it fits", () => {
    const { unmount } = render(<AddPhaseForm {...props} startsOn="2027-04-05" raceDate={null} seasonEnd="2027-04-20" />);
    expect(screen.getByText("This phase runs 12 days past the season end on 20 Apr 2027.")).toBeTruthy();
    unmount();
    render(<AddPhaseForm {...props} />);
    expect(screen.queryByText(/This phase/)).toBeNull();
  });

  it("step 2 finishes with Add phase, back on the season", () => {
    render(<AddPhaseFinish seasonId={7} hasSession />);
    fireEvent.click(screen.getByRole("button", { name: "Add phase" }));
    expect(nav.returnTo).toHaveBeenCalledWith("/seasons/7");
  });

  it("step 2 Add phase stays off with the New cycle reason until the week has a session (round 9)", () => {
    render(<AddPhaseFinish seasonId={7} hasSession={false} />);
    const button = screen.getByRole("button", { name: "Add phase" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Add a session first.");
    fireEvent.click(button);
    expect(nav.returnTo).not.toHaveBeenCalled();
  });
});

describe("a dimmed button says what is missing", () => {
  const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

  it("asks for a name, then a length", () => {
    render(<AddPhaseForm {...props} />);
    const button = screen.getByRole("button", { name: "Build the week" });
    expect(reasonOf(button)).toBe("Give the phase a name.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Swim, intervals, bricks" } });
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "" } });
    expect(reasonOf(button)).toBe("Type a length.");
  });
});

describe("Add a phase, fix round 4", () => {
  // The season's first phase, due Mon 16 Nov, while Base of another season runs and its Build waits for 14 Dec.
  const first = {
    ...props,
    position: 1,
    afterName: null,
    startsOn: "2026-11-16",
    running: { id: 3, name: "Base", startDate: "2026-11-02", durationWeeks: 6, durationDays: null, seasonId: 9 },
    scheduled: { id: 5, name: "Build", day: "2026-12-14", season: { id: 9, name: "Winter run base" } },
  };
  const title = "Start this season Mon 16 Nov?";

  it("a season's first phase says what it ends and drops, and is made only after the confirm", async () => {
    render(<AddPhaseForm {...first} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General" } });
    fireEvent.click(screen.getByRole("button", { name: "Build the week" }));
    const sheet = await screen.findByRole("region", { name: title });
    const text = sheet.textContent!.replace(/\u00a0/g, " ");
    expect(text).toContain("This ends Base at week 2 of 6.");
    expect(text).toContain("Winter run base pauses. Its next phase no longer starts Mon 14 Dec. You can resume it from the season.");
    expect(actions.addPhaseAction).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole("button", { name: "Build the week" }));
    await waitFor(() => expect(actions.addPhaseAction).toHaveBeenCalledWith(expect.objectContaining({ name: "General", takeStart: true })));
  });

  it("a later phase asks nothing", async () => {
    render(<AddPhaseForm {...first} position={2} afterName="General" />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Base" } });
    fireEvent.click(screen.getByRole("button", { name: "Build the week" }));
    await waitFor(() => expect(actions.addPhaseAction).toHaveBeenCalled());
    expect(actions.addPhaseAction.mock.calls[0][0]).not.toHaveProperty("takeStart");
    expect(screen.queryByRole("region", { name: title })).toBeNull();
  });

  it("Weeks to Days converts the number, and Days to Weeks only when it is whole weeks", () => {
    // jsdom has no scrollIntoView; the length note scrolls itself into view, as in the phase sheet.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<AddPhaseForm {...props} />);
    const length = screen.getByLabelText("Length") as HTMLInputElement;
    const unit = (name: string) => screen.getByRole("button", { name });
    fireEvent.change(length, { target: { value: "15" } });
    fireEvent.click(unit("Days"));
    expect(length.value).toBe("105");
    fireEvent.click(unit("Weeks"));
    expect(length.value).toBe("15");
    fireEvent.click(unit("Days"));
    fireEvent.change(length, { target: { value: "10" } });
    fireEvent.click(unit("Weeks"));
    // The unit shown is the unit saved: Weeks, with the days rounded (round 8).
    expect(length.value).toBe("1");
    expect(unit("Weeks").getAttribute("aria-pressed")).toBe("true");
    const note = screen.getByText("10 days is not a whole number of weeks, so it is now 1 week.");
    expect(scroll.mock.contexts).toContain(note);
  });

  it("step 2 Cancel offers to remove the phase this flow made", async () => {
    render(<AddPhaseCancel seasonId={7} cycleId={42} name="Recovery block" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const sheet = screen.getByRole("region", { name: "Remove this phase?" });
    expect(sheet.textContent).toContain("Recovery block and the sessions you added are deleted.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove phase" }));
    await waitFor(() => expect(cycles.deleteTrainingCycle).toHaveBeenCalledWith(42));
    expect(nav.returnTo).toHaveBeenCalledWith("/seasons/7");
  });

  it("step 2 Cancel can keep building", () => {
    render(<AddPhaseCancel seasonId={7} cycleId={42} name="Recovery block" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep building" }));
    expect(cycles.deleteTrainingCycle).not.toHaveBeenCalled();
  });
});

describe("one selected style on the form (round 8)", () => {
  it("draws the chosen length unit with the same accent tint as the chosen phase type", () => {
    render(<AddPhaseForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    const unit = screen.getByRole("button", { name: "Weeks" });
    const type = screen.getByRole("button", { name: "Build" });
    expect(unit.getAttribute("aria-pressed")).toBe("true");
    const tint = "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)]";
    expect(type.className).toContain(tint);
    expect(unit.className).toContain(tint);
    expect(unit.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
  });
});
