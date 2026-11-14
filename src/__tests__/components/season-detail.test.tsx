// @vitest-environment jsdom
import { SeasonDetailClient, phaseAnnouncements, phaseDrop, type SeasonPhaseView } from "@/components/features/SeasonDetailClient";
import type { DragEndEvent } from "@dnd-kit/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Season detail (J4_SeasonDetail): the re-plan banner, drag to reorder the
 * phases, the gym view, and errors inside the open sheet.
 */

const actions = vi.hoisted(() => {
  const ok = () => vi.fn(async () => ({ success: true as const, data: null }));
  return {
    addRaceAction: ok(),
    clearReplanAction: ok(),
    deleteSeasonAction: ok(),
    fitTaperAction: ok(),
    movePhaseAction: ok(),
    removePhaseAction: ok(),
    removeRaceAction: ok(),
    resumeSeasonAction: ok(),
    setPhaseAction: ok(),
    updateRaceAction: ok(),
  };
});
vi.mock("@/lib/actions/seasons", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// The drop handler, captured from DndContext: jsdom has no layout, so a real drag cannot run here.
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((e: DragEndEvent) => void) }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...real,
    DndContext: ({ children, onDragEnd, id, accessibility }: { children: React.ReactNode; onDragEnd: (e: DragEndEvent) => void; id?: string; accessibility?: import("@dnd-kit/core").DndContextProps["accessibility"] }) => {
      dnd.onDragEnd = onDragEnd;
      return (
        <real.DndContext id={id} accessibility={accessibility}>
          {children}
        </real.DndContext>
      );
    },
  };
});

const phase = (id: number, name: string, phaseType: SeasonPhaseView["phaseType"], start: string, end: string, lengthDays: number): SeasonPhaseView => ({
  id,
  name,
  phaseType,
  durationWeeks: Math.ceil(lengthDays / 7),
  durationDays: lengthDays % 7 ? lengthDays : null,
  start,
  end,
  lengthDays,
  state: "planned",
});

const phases = [
  phase(1, "Aerobic base + strength", "general", "2026-11-16", "2027-01-10", 56),
  phase(2, "Longer ride and run", "base", "2027-01-11", "2027-04-04", 84),
  phase(3, "Taper", "taper", "2027-04-05", "2027-04-14", 10),
];

const base = {
  season: { id: 7, name: "Jevnaker Half 2027", goal: "Finish the race", startDate: "2026-11-16", endDate: "2027-04-17", nextGoal: null },
  today: "2026-11-14",
  enduranceEnabled: true,
  replan: null,
  races: [{ id: 4, name: "Jevnaker Halv Full Distanse", raceDate: "2027-04-17", discipline: "triathlon" as const, distance: "half" as const, distanceMeters: null, priority: "A" as const }],
  aRaceId: 4,
  phases,
  taperFit: { status: "fits" as const, taperId: 3 },
  next: { cycleId: 1, name: "Aerobic base + strength", plannedStart: "2026-11-16", scheduled: true },
  gapBefore: 0,
  overrunAfter: 0,
  running: null,
  scheduled: null,
};

const rowNames = () => screen.getAllByTestId("phase-name").map((n) => n.textContent);

beforeEach(() => {
  for (const fn of Object.values(actions)) {
    fn.mockReset();
    fn.mockImplementation(async () => ({ success: true as const, data: null }));
  }
});

describe("the re-plan banner", () => {
  it("is absent when the taper ends on race day and nothing is flagged", () => {
    render(<SeasonDetailClient {...base} />);
    expect(screen.queryByTestId("replan-banner")).toBeNull();
  });

  it("after a race moves: Fit the taper fits it and clears the flag", async () => {
    render(<SeasonDetailClient {...base} replan={{ reason: 'A race "Jevnaker" moved from 2027-04-14 to 2027-04-17' }} taperFit={{ status: "early", taperId: 3, days: 3 }} />);
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).toContain("Race date changed. The taper no longer ends on race day.");
    expect(within(screen.getAllByTestId("phase-row")[2]).getByText("Taper ends 3 days before the race")).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Fit the taper" }));
    await waitFor(() => expect(actions.clearReplanAction).toHaveBeenCalledWith({ seasonId: 7 }));
    expect(actions.fitTaperAction).toHaveBeenCalledWith({ seasonId: 7 });
  });

  it("Keep as it is clears the flag and changes no phase", async () => {
    render(<SeasonDetailClient {...base} replan={{ reason: null }} taperFit={{ status: "early", taperId: 3, days: 3 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep as it is" }));
    await waitFor(() => expect(actions.clearReplanAction).toHaveBeenCalledWith({ seasonId: 7 }));
    expect(actions.fitTaperAction).not.toHaveBeenCalled();
  });

  it("a taper that does not fit with no flag offers only the fit", () => {
    render(<SeasonDetailClient {...base} taperFit={{ status: "late", taperId: 3, days: 2 }} />);
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).toContain("The taper does not end on race day.");
    expect(within(banner).queryByRole("button", { name: "Keep as it is" })).toBeNull();
  });
});

describe("drag to reorder the phases", () => {
  it("moves the row at once and sends its new 1-based position", async () => {
    render(<SeasonDetailClient {...base} />);
    expect(rowNames()).toEqual(["Aerobic base + strength", "Longer ride and run", "Taper"]);
    await act(async () => dnd.onDragEnd!({ active: { id: 3 }, over: { id: 1 } } as unknown as DragEndEvent));
    expect(actions.movePhaseAction).toHaveBeenCalledWith({ seasonId: 7, cycleId: 3, position: 1 });
    expect(rowNames()).toEqual(["Taper", "Aerobic base + strength", "Longer ride and run"]);
  });

  it("puts the row back when the server refuses the move", async () => {
    actions.movePhaseAction.mockImplementation(async () => ({ success: false, error: "A phase that has started cannot move." }) as never);
    render(<SeasonDetailClient {...base} />);
    await act(async () => dnd.onDragEnd!({ active: { id: 1 }, over: { id: 2 } } as unknown as DragEndEvent));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("cannot move"));
    expect(rowNames()).toEqual(["Aerobic base + strength", "Longer ride and run", "Taper"]);
  });

  it("names the drag instructions the same on every render, so the server HTML hydrates", () => {
    // dnd-kit numbers its ids from a module counter when DndContext has no id:
    // the server and the browser count differently ("DndDescribedBy-0" vs "-4").
    const describedBy = () => document.querySelector("[aria-roledescription='sortable']")?.getAttribute("aria-describedby");
    const first = render(<SeasonDetailClient {...base} />);
    const a = describedBy();
    first.unmount();
    render(<SeasonDetailClient {...base} />);
    expect(a).toBeTruthy();
    expect(describedBy()).toBe(a);
  });

  it("phaseDrop gives the order and position, and nothing for a drop in place", () => {
    expect(phaseDrop([1, 2, 3], 1, 3)).toEqual({ order: [2, 3, 1], position: 3 });
    expect(phaseDrop([1, 2, 3], 2, 2)).toBeNull();
  });
});

describe("a gym user's season", () => {
  it("shows no race parts and no phase types with the switch off", () => {
    render(<SeasonDetailClient {...base} enduranceEnabled={false} races={[]} aRaceId={null} />);
    expect(screen.queryByText("Races")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add race" })).toBeNull();
    expect(screen.getByTestId("season-hero").textContent).toContain("Goal by 17 Apr 2027");
    expect(screen.getAllByTestId("phase-row")[0].textContent).not.toContain("General");
    fireEvent.click(within(screen.getAllByTestId("phase-row")[0]).getAllByRole("button")[1]);
    expect(screen.queryByRole("group", { name: "Phase type" })).toBeNull();
  });
});

describe("sheet errors", () => {
  it("shows a failed phase save inside the open sheet", async () => {
    actions.setPhaseAction.mockImplementation(async () => ({ success: false, error: "A phase is 1 to 52 weeks." }) as never);
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[1]).getAllByRole("button")[1]);
    const sheet = screen.getByRole("heading", { name: "Longer ride and run" }).closest("div")!.parentElement!;
    fireEvent.click(within(sheet).getByRole("button", { name: "Save phase" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("1 to 52 weeks"));
    expect(actions.setPhaseAction).toHaveBeenCalledWith({ seasonId: 7, cycleId: 2, phaseType: "base", durationWeeks: 12, durationDays: null });
  });

  it("shows a failed race save inside the open sheet", async () => {
    actions.addRaceAction.mockImplementation(async () => ({ success: false, error: "A season holds at most 20 races." }) as never);
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("heading", { name: "New race" }).parentElement!;
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Haugesund" } });
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2027-08-22" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("at most 20 races"));
  });
});

describe("sheets (fix round 2)", () => {
  it("draws each sheet on the Plan sheet card, not straight over the page", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[1]).getAllByRole("button")[1]);
    expect(screen.getByRole("region", { name: "Longer ride and run" }).className).toContain("bg-widget");
    fireEvent.click(screen.getByRole("button", { name: /Jevnaker Halv Full Distanse/ }));
    expect(screen.getByRole("region", { name: "Edit race" }).className).toContain("bg-widget");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("region", { name: "Season actions" }).className).toContain("bg-widget");
    fireEvent.click(within(screen.getByRole("region", { name: "Season actions" })).getByRole("button", { name: "Delete season" }));
    expect(screen.getByRole("region", { name: "Delete this season?" }).className).toContain("bg-widget");
  });

  it("keeps the length field from taking the whole row, so Weeks and Days stay visible", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[1]).getAllByRole("button")[1]);
    // A full-width class on the field itself squeezes the unit switch to nothing.
    expect(screen.getByLabelText("Length").className.split(" ")).not.toContain("w-full");
  });

  it("asks before it removes a race", async () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /Jevnaker Halv Full Distanse/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove race" }));
    expect(actions.removeRaceAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole("region", { name: "Remove this race?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove race" }));
    await waitFor(() => expect(actions.removeRaceAction).toHaveBeenCalledWith({ seasonId: 7, raceId: 4 }));
  });
});

describe("season detail text (fix round 2)", () => {
  it("shows the goal once when there is no A race", () => {
    render(<SeasonDetailClient {...base} enduranceEnabled={false} races={[]} aRaceId={null} />);
    expect(screen.getAllByText("Finish the race")).toHaveLength(1);
  });

  it("says Paused, not Starts, for a first phase that lost its later start, as the Plan list does (J8-12)", () => {
    render(<SeasonDetailClient {...base} next={{ ...base.next, scheduled: false }} />);
    const first = screen.getAllByTestId("phase-row")[0];
    expect(first.textContent).not.toContain("Starts");
    expect(first.textContent).toContain("Paused");
  });

  it("says Next for a first phase that is due and not scheduled", () => {
    render(<SeasonDetailClient {...base} today="2026-11-16" next={{ ...base.next, scheduled: false }} />);
    expect(screen.getAllByTestId("phase-row")[0].textContent).toContain("Next");
  });

  it("a season whose first phase lost its later start shows paused with Resume", () => {
    // Another block took the one scheduled start (scheduleCycle): the first phase was due 16 Nov.
    render(<SeasonDetailClient {...base} next={{ ...base.next, scheduled: false }} />);
    expect(screen.getByText("Paused. The next phase is not scheduled.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("a season whose first phase is due today or earlier offers Start", () => {
    render(<SeasonDetailClient {...base} today="2026-11-16" next={{ ...base.next, scheduled: false }} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("does not call a B race change an A race change", () => {
    render(<SeasonDetailClient {...base} replan={{ reason: 'B race "Tune-up" moved from 29 Aug 2027 to 12 Sep 2027' }} />);
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).not.toContain("A race changed");
    expect(banner.textContent).toContain("Your races changed. The phases stay as they are.");
  });

  it("announces a drag with the phase names", () => {
    render(<SeasonDetailClient {...base} />);
    const describedBy = document.querySelector("[aria-roledescription='sortable']")!.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).not.toContain("draggable item");
    const say = phaseAnnouncements((id) => phases.find((p) => p.id === Number(id))?.name ?? "");
    expect(say.onDragStart({ active: { id: 1 } } as never)).toBe("Picked up Aerobic base + strength.");
    expect(say.onDragEnd({ active: { id: 1 }, over: { id: 3 } } as never)).toBe("Aerobic base + strength dropped in the place of Taper.");
    expect(say.onDragCancel({ active: { id: 1 } } as never)).toBe("Aerobic base + strength was not moved.");
  });
});

describe("Resume asks first (fix round 4)", () => {
  const paused = { ...base, next: { ...base.next, scheduled: false } };
  // A cycle outside the season runs from 2 Nov, and another draft is scheduled for 30 Nov.
  const running = { id: 20, name: "Base block", startDate: "2026-11-02", durationWeeks: 6, durationDays: null, seasonId: null };
  const scheduled = { id: 21, name: "Strength upkeep", day: "2026-11-30", season: null };

  it("says what it ends and drops, and resumes only after the confirm", async () => {
    render(<SeasonDetailClient {...paused} running={running} scheduled={scheduled} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    const sheet = screen.getByRole("region", { name: "Resume this season?" });
    expect(sheet.textContent).toContain("Aerobic base + strength starts Mon 16 Nov.");
    expect(sheet.textContent).toContain("This ends Base block at week 3 of 6.");
    expect(sheet.textContent).toContain("Strength upkeep no longer starts Mon 30 Nov.");
    expect(actions.resumeSeasonAction).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Resume season" }));
    await waitFor(() => expect(actions.resumeSeasonAction).toHaveBeenCalledWith({ seasonId: 7 }));
  });

  it("Start on a season due today says it starts today", () => {
    render(<SeasonDetailClient {...paused} today="2026-11-16" running={running} scheduled={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const sheet = screen.getByRole("region", { name: "Start this season?" });
    expect(sheet.textContent).toContain("Aerobic base + strength starts today.");
    expect(sheet.textContent).toContain("This ends Base block at week 3 of 6.");
  });

  it("resumes at once when nothing else runs or is scheduled", async () => {
    render(<SeasonDetailClient {...paused} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(actions.resumeSeasonAction).toHaveBeenCalledWith({ seasonId: 7 }));
  });
});

describe("errors belong to the sheet that caused them (fix round 4)", () => {
  it("a race error is gone once the race sheet closes, on the page and in the Delete season confirm", async () => {
    actions.addRaceAction.mockImplementation(async () => ({ success: false, error: "Pick a race date from today on" }) as never);
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Old race" } });
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2026-01-01" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    await waitFor(() => expect(within(sheet).getByRole("alert")).toBeTruthy());

    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "New race" })).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Season actions" })).getByRole("button", { name: "Delete season" }));
    expect(within(screen.getByRole("region", { name: "Delete this season?" })).queryByRole("alert")).toBeNull();
  });
});

describe("phase length in weeks or days (fix round 4)", () => {
  // Fit the taper set Build to 105 days: a whole number of weeks.
  const fitted = [phases[0], { ...phases[1], durationWeeks: 15, durationDays: 105, end: "2027-04-25", lengthDays: 105 }, phases[2]];

  it("shows a whole number of weeks as weeks, in the row and in the sheet", () => {
    render(<SeasonDetailClient {...base} phases={fitted} />);
    const row = screen.getAllByTestId("phase-row")[1];
    expect(row.textContent).toContain("15 wk");
    expect(row.textContent).not.toContain("105 days");
    fireEvent.click(within(row).getAllByRole("button")[1]);
    expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe("15");
    expect(screen.getByRole("button", { name: "Weeks" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Weeks to Days converts the number, so 12 weeks saves as 84 days", async () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[1]).getAllByRole("button")[1]);
    expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe("84");
    fireEvent.click(screen.getByRole("button", { name: "Save phase" }));
    await waitFor(() => expect(actions.setPhaseAction).toHaveBeenCalledWith(expect.objectContaining({ cycleId: 2, durationDays: 84 })));
  });

  it("Days to Weeks keeps days and says so when the days are not whole weeks", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[2]).getAllByRole("button")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Weeks" }));
    expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe("10");
    expect(screen.getByRole("button", { name: "Days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("10 days is not a whole number of weeks, so the length stays in days.")).toBeTruthy();
  });
});

describe("the phase bar and badges match the Plan list (fix round 6)", () => {
  const tones = () => [...screen.getByTestId("phase-bar").children].map((c) => c.getAttribute("data-tone"));

  it("fills only the phases that have started (J4-13, J6-02)", () => {
    const running = [{ ...phases[0], start: "2026-11-02", state: "active" as const }, phases[1], phases[2]];
    render(<SeasonDetailClient {...base} phases={running} next={{ cycleId: 2, name: phases[1].name, plannedStart: phases[1].start, scheduled: true }} />);
    expect(tones()).toEqual(["current", "grey", "grey"]);
  });

  it("outlines the next phase of a season not started, and does not fill it", () => {
    render(<SeasonDetailClient {...base} />);
    expect(tones()).toEqual(["next", "grey", "grey"]);
  });

  it("gives a start inside the week with its date (J4-17)", () => {
    render(<SeasonDetailClient {...base} />);
    expect(screen.getAllByTestId("phase-row")[0].textContent).toContain("Starts Mon 16 Nov");
  });
});
