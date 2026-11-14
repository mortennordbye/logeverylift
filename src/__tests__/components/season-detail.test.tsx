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

  it("says Next, not Starts, for a first phase that is not scheduled", () => {
    render(<SeasonDetailClient {...base} next={{ ...base.next, scheduled: false }} />);
    const first = screen.getAllByTestId("phase-row")[0];
    expect(first.textContent).not.toContain("Starts");
    expect(first.textContent).toContain("Next");
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
