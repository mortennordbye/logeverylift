// @vitest-environment jsdom

import { SeasonDetailClient, phaseAnnouncements, phaseDrop, type SeasonPhaseView } from "@/components/features/SeasonDetailClient";
import type { DragEndEvent } from "@dnd-kit/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A label shows the year of a date outside the current one (round 11 I2):
// the clock stays in the year of the dates these tests use.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

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
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: router.refresh, back: vi.fn() }) }));

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
  // jsdom has no scrollIntoView; the length note scrolls itself into view.
  Element.prototype.scrollIntoView = vi.fn();
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

  it("a paused season does not warn about the taper: its dates assume a Resume today (J8-12)", () => {
    render(
      <SeasonDetailClient
        {...base}
        taperFit={{ status: "early", taperId: 3, days: 30 }}
        next={{ cycleId: 2, name: "Longer ride and run", plannedStart: "2027-01-11", scheduled: false }}
        phases={[{ ...phases[0], state: "active" }, phases[1], phases[2]]}
      />,
    );
    expect(screen.queryByTestId("replan-banner")).toBeNull();
    expect(screen.queryByText(/Taper ends .* before the race/)).toBeNull();
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
    expect(screen.getByTestId("season-hero").textContent!.replace(/\u00a0/g, " ")).toContain("Goal by 17 Apr 2027");
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
    const sheet = screen.getByRole("heading", { name: "Longer ride and run" }).closest("section")!;
    fireEvent.click(within(sheet).getByRole("button", { name: "Save phase" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("1 to 52 weeks"));
    expect(actions.setPhaseAction).toHaveBeenCalledWith({ seasonId: 7, cycleId: 2, phaseType: "base", durationWeeks: 12, durationDays: null });
  });

  it("shows a failed race save inside the open sheet", async () => {
    actions.addRaceAction.mockImplementation(async () => ({ success: false, error: "A season holds at most 20 races." }) as never);
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("heading", { name: "New race" }).closest("section")!;
    // Priority has the uppercase label of Name and Date (J4-07).
    expect(within(sheet).getByText("Priority").className).toBe(within(sheet).getByText("Name").className);
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Haugesund" } });
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2027-08-22" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("at most 20 races"));
  });
});

describe("a dimmed Save in a season sheet says what is missing", () => {
  const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

  it("the race sheet asks for a name, then a date", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    const save = within(sheet).getByRole("button", { name: "Save race" });
    expect(reasonOf(save)).toBe("Give the race a name.");
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Haugesund" } });
    expect(reasonOf(save)).toBe("Pick the race day.");
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2027-08-22" } });
    expect(save.getAttribute("aria-describedby")).toBeNull();
  });

  it("the phase sheet asks for a length", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[1]).getAllByRole("button")[1]);
    const sheet = screen.getByRole("region", { name: "Longer ride and run" });
    fireEvent.change(within(sheet).getByLabelText("Length"), { target: { value: "" } });
    expect(reasonOf(within(sheet).getByRole("button", { name: "Save phase" }))).toBe("Type a length.");
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

  it("says Next, not Paused, for a first phase of a season not started that lost its later start (round 8)", () => {
    render(<SeasonDetailClient {...base} next={{ ...base.next, scheduled: false }} />);
    const first = screen.getAllByTestId("phase-row")[0];
    expect(first.textContent).not.toContain("Paused");
    expect(within(first).getByText("Next").className).toContain("text-primary");
  });

  it("a season with no goal and no race says when it ends, not Goal by (round 8)", () => {
    render(<SeasonDetailClient {...base} season={{ ...base.season, goal: null }} enduranceEnabled={false} races={[]} aRaceId={null} phases={[]} next={null} />);
    const hero = screen.getByTestId("season-hero");
    expect(hero.textContent).not.toContain("Goal by");
    expect(hero.textContent!.replace(/\u00a0/g, " ")).toContain("Ends 17 Apr 2027");
  });

  it("sets the next goal apart from its label, so its capital letter does not sit mid-sentence (round 8)", () => {
    render(<SeasonDetailClient {...base} season={{ ...base.season, nextGoal: "Hold it through the spring" }} />);
    const line = screen.getByTestId("next-goal");
    expect(line.textContent!.replace(/\u00a0/g, " ")).toBe("Next goal · Hold it through the spring");
  });

  it("says Next for a first phase that is due and not scheduled", () => {
    render(<SeasonDetailClient {...base} today="2026-11-16" next={{ ...base.next, scheduled: false }} />);
    expect(screen.getAllByTestId("phase-row")[0].textContent).toContain("Next");
  });

  it("a season not started whose first phase lost its later start offers Start, not Resume (round 8)", () => {
    render(<SeasonDetailClient {...base} next={{ ...base.next, scheduled: false }} />);
    expect(screen.queryByText("Paused. The next phase is not scheduled.")).toBeNull();
    expect(screen.getByText("“Aerobic base + strength” is not started.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    // The short word is still a 44 px wide target (QA round 11).
    expect(screen.getByRole("button", { name: "Start" }).className).toMatch(/\bmin-w-11\b/);
  });

  it("a season not started still warns that the taper misses race day and offers Fit the taper (round 8)", () => {
    render(
      <SeasonDetailClient
        {...base}
        next={{ ...base.next, scheduled: false }}
        replan={{ reason: 'The A race "Jevnaker" moved from 3 Apr 2027 to 17 Apr 2027' }}
        taperFit={{ status: "early", taperId: 3, days: 14 }}
      />,
    );
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).toContain("Race date changed. The taper no longer ends on race day.");
    expect(within(banner).getByRole("button", { name: "Fit the taper" })).toBeTruthy();
    expect(within(screen.getAllByTestId("phase-row")[2]).getByText("Taper ends 14 days before the race")).toBeTruthy();
  });

  it("a season whose phase ended and whose next phase is not scheduled shows paused with Resume", () => {
    const done = [{ ...phases[0], state: "done" as const }, phases[1], phases[2]];
    render(<SeasonDetailClient {...base} today="2027-01-20" phases={done} next={{ cycleId: 2, name: "Longer ride and run", plannedStart: "2027-01-20", scheduled: false }} />);
    expect(within(screen.getAllByTestId("phase-row")[1]).getByText("Paused").className).toContain("text-muted-foreground");
    expect(screen.getByText("Paused. The next phase is not scheduled.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    // While paused the chain has a gap, so the helper says when the later phases start (round 9 F8).
    expect(screen.queryByText("Each phase starts the day after the one before.")).toBeNull();
    expect(screen.getByText("The later phases start when you resume.")).toBeTruthy();
  });

  it("a season that is not paused says each phase starts the day after the one before", () => {
    render(<SeasonDetailClient {...base} />);
    expect(screen.getByText("Each phase starts the day after the one before.")).toBeTruthy();
  });

  it("a season whose first phase is due today or earlier offers Start", () => {
    render(<SeasonDetailClient {...base} today="2026-11-16" next={{ ...base.next, scheduled: false }} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("shows the stored re-plan reason with curly quotes, as every other name in the Plan UI (round 9)", () => {
    render(<SeasonDetailClient {...base} replan={{ reason: 'The A race "Jevnaker" moved from 3 Apr 2027 to 17 Apr 2027; "Tune-up" changed from A priority to B priority' }} />);
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).toContain("The A race “Jevnaker” moved");
    expect(banner.textContent).toContain("“Tune-up” changed");
    expect(banner.textContent).not.toContain('"');
  });

  it("does not call a B race change an A race change", () => {
    render(<SeasonDetailClient {...base} replan={{ reason: 'B race "Tune-up" moved from 29 Aug 2027 to 12 Sep 2027' }} />);
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).not.toContain("A race changed");
    expect(banner.textContent).toContain("Race date changed. The phases stay as they are.");
  });

  it("a second A race added: the title says an A race was added, not that a date changed (round 11 I2)", () => {
    const reason = 'The A race "Jevnaker" added on 1 May 2027; "Jevnaker" on 17 Apr 2027 changed from A priority to B priority';
    render(<SeasonDetailClient {...base} replan={{ reason }} taperFit={{ status: "early", taperId: 3, days: 14 }} />);
    const banner = screen.getByTestId("replan-banner");
    expect(banner.textContent).toContain("An A race was added. The taper no longer ends on race day.");
    expect(banner.textContent).not.toContain("Race date changed");
  });

  it("the race sheet says the season end moves before an A race past it is saved (round 11 I2)", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Jevnaker Halv Full Distanse" } });
    // A new race is an A race; the season ends on 17 Apr.
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2027-05-01" } });
    const text = () => sheet.textContent!.replace(/ /g, " ");
    expect(text()).toContain("“Jevnaker Halv Full Distanse” on 17 Apr 2027 becomes a B race.");
    expect(text()).toContain("The season end moves to 1 May 2027.");
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2027-04-10" } });
    expect(text()).not.toContain("The season end moves");
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
  // The first phase ran and ended; the next one is not scheduled (seasonPaused).
  const paused = {
    ...base,
    phases: [{ ...phases[0], state: "done" as const }, phases[1], phases[2]],
    next: { cycleId: 2, name: "Longer ride and run", plannedStart: "2026-11-16", scheduled: false },
  };
  const notStarted = { ...base, next: { ...base.next, scheduled: false } };
  // A cycle outside the season runs from 2 Nov, and another draft is scheduled for 30 Nov.
  const running = { id: 20, name: "Base block", startDate: "2026-11-02", durationWeeks: 6, durationDays: null, seasonId: null };
  const scheduled = { id: 21, name: "Strength upkeep", day: "2026-11-30", season: null };

  it("says what it ends and drops, and resumes only after the confirm", async () => {
    render(<SeasonDetailClient {...paused} running={running} scheduled={scheduled} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    const sheet = screen.getByRole("region", { name: "Resume this season?" });
    // The dates keep their words together with no-break spaces (keepDates).
    const text = sheet.textContent!.replace(/\u00a0/g, " ");
    expect(text).toContain("Longer ride and run starts Mon 16 Nov.");
    expect(text).toContain("This ends Base block at week 2 of 6.");
    expect(text).toContain("Strength upkeep no longer starts Mon 30 Nov.");
    expect(actions.resumeSeasonAction).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Resume season" }));
    await waitFor(() => expect(actions.resumeSeasonAction).toHaveBeenCalledWith({ seasonId: 7 }));
  });

  it("Start on a season due today says it starts today", () => {
    render(<SeasonDetailClient {...notStarted} today="2026-11-16" running={running} scheduled={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const sheet = screen.getByRole("region", { name: "Start this season?" });
    const text = sheet.textContent!.replace(/\u00a0/g, " ");
    expect(text).toContain("Aerobic base + strength starts today.");
    expect(text).toContain("This ends Base block at week 2 of 6.");
  });

  it("resumes at once when nothing else runs or is scheduled", async () => {
    render(<SeasonDetailClient {...paused} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(actions.resumeSeasonAction).toHaveBeenCalledWith({ seasonId: 7 }));
  });
});

describe("a season deleted in another tab (round 8)", () => {
  it("a failed write reloads the page, so a deleted season shows its deleted state", async () => {
    router.refresh.mockClear();
    actions.resumeSeasonAction.mockImplementation(async () => ({ success: false, error: "Season not found" }) as never);
    render(<SeasonDetailClient {...base} next={{ ...base.next, scheduled: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(actions.resumeSeasonAction).toHaveBeenCalled());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe("one A race per season (round 8)", () => {
  it("the race sheet says before Save that the old A race becomes a B race", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    fireEvent.click(within(within(sheet).getByRole("group", { name: "Priority" })).getByRole("button", { name: "B" }));
    expect(within(sheet).queryByText(/becomes a B race/)).toBeNull();
    fireEvent.click(within(within(sheet).getByRole("group", { name: "Priority" })).getByRole("button", { name: "A" }));
    expect(sheet.textContent!.replace(/\u00a0/g, " ")).toContain("“Jevnaker Halv Full Distanse” on 17 Apr 2027 becomes a B race.");
  });

  it("says nothing when the race edited is the A race", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /Jevnaker Halv Full Distanse/ }));
    expect(screen.queryByText(/becomes a B race/)).toBeNull();
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

describe("field errors show under their field (round 8)", () => {
  it("a refused race date shows under Date, not under Save race", async () => {
    const msg = "Pick a race date from today on.";
    actions.addRaceAction.mockImplementation(async () => ({ success: false, error: msg, fieldErrors: { raceDate: [msg] } }) as never);
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Old race" } });
    const date = within(sheet).getByLabelText("Date");
    fireEvent.change(date, { target: { value: "2026-01-01" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    const alert = await waitFor(() => within(sheet).getByRole("alert"));
    expect(alert.textContent).toBe(msg);
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(date.getAttribute("aria-describedby")).toBe(alert.id);
    const save = within(sheet).getByRole("button", { name: "Save race" });
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A new date clears it.
    fireEvent.change(date, { target: { value: "2027-01-01" } });
    expect(within(sheet).queryByRole("alert")).toBeNull();
  });
});

describe("phase length in weeks or days (fix round 4)", () => {
  // Fit the taper set Build to 105 days: a whole number of weeks.
  const fitted = [phases[0], { ...phases[1], durationWeeks: 15, durationDays: 105, end: "2027-04-25", lengthDays: 105 }, phases[2]];

  it("shows a whole number of weeks as weeks, in the row and in the sheet", () => {
    render(<SeasonDetailClient {...base} phases={fitted} />);
    const row = screen.getAllByTestId("phase-row")[1];
    expect(row.textContent!.replace(/\u00a0/g, " ")).toContain("15 wk");
    expect(row.textContent!.replace(/\u00a0/g, " ")).not.toContain("105 days");
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

  it("Days to Weeks switches to weeks and says how the days were rounded; the unit shown is the unit saved (round 8)", async () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[2]).getAllByRole("button")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Weeks" }));
    expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe("1");
    expect(screen.getByRole("button", { name: "Weeks" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("10 days is not a whole number of weeks, so it is now 1 week.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save phase" }));
    await waitFor(() => expect(actions.setPhaseAction).toHaveBeenCalledWith(expect.objectContaining({ cycleId: 3, durationWeeks: 3, durationDays: null })));
  });

  it("a length out of range says the range instead of a bare Invalid input (round 8)", () => {
    const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[2]).getAllByRole("button")[1]);
    const save = screen.getByRole("button", { name: "Save phase" });
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "365" } });
    expect(reasonOf(save)).toBe("Pick 1 to 364 days.");
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "9999999" } });
    expect(reasonOf(save)).toBe("Pick 1 to 364 days.");
    fireEvent.click(screen.getByRole("button", { name: "Weeks" }));
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "53" } });
    expect(reasonOf(save)).toBe("Pick 1 to 52 weeks.");
    expect(actions.setPhaseAction).not.toHaveBeenCalled();
  });

  it("the sheet's dates follow the length as it is typed (round 8)", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(within(screen.getAllByTestId("phase-row")[0]).getAllByRole("button")[1]);
    const sheet = screen.getByRole("region", { name: "Aerobic base + strength" });
    const text = () => sheet.textContent!.replace(/\u00a0/g, " ");
    expect(text()).toContain("16 Nov 2026 – 10 Jan 2027");
    fireEvent.change(within(sheet).getByLabelText("Length"), { target: { value: "4" } });
    expect(text()).toContain("16 Nov – 13 Dec");
    fireEvent.click(within(sheet).getByRole("button", { name: "Days" }));
    fireEvent.change(within(sheet).getByLabelText("Length"), { target: { value: "10" } });
    expect(text()).toContain("16 – 25 Nov");
  });
});

describe("a phase cut by a scheduled start (fix round 7)", () => {
  // Base was planned for 7 weeks; a draft scheduled for 16 Nov ends it on 15 Nov.
  const cut = [{ ...phase(1, "Base", "base", "2026-11-09", "2026-11-15", 7), durationWeeks: 7, durationDays: null, state: "active" as const }, phases[1], phases[2]];

  it("shows the length it runs in the row, and the planned length in the sheet's length field", () => {
    render(<SeasonDetailClient {...base} phases={cut} />);
    const row = screen.getAllByTestId("phase-row")[0];
    // keepDates joins the dates with no-break spaces.
    const text = row.textContent!.replace(/\u00a0/g, " ");
    expect(text).toContain("1 wk · 9 – 15 Nov");
    expect(text).not.toContain("7 wk");
    fireEvent.click(within(row).getAllByRole("button")[1]);
    expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe("7");
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

  it("gives a start inside the week in the same date format as a later one (J4-17, round 8)", () => {
    render(<SeasonDetailClient {...base} />);
    const text = screen.getAllByTestId("phase-row")[0].textContent?.replace(/\u00a0/g, " ");
    expect(text).toContain("Starts 16 Nov");
    expect(text).not.toContain("Mon");
  });
});

describe("the race sheet's choices (round 8)", () => {
  it("labels the sport chips on screen", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    expect(within(sheet).getByRole("group", { name: "Sport" })).toBeTruthy();
    expect(within(sheet).getByText("Sport").className).toContain("uppercase");
  });

  it("draws the chosen priority with the same tint as the chosen sport", () => {
    render(<SeasonDetailClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add race" }));
    const sheet = screen.getByRole("region", { name: "New race" });
    const pressed = Array.from(sheet.querySelectorAll('button[aria-pressed="true"]'));
    expect(pressed.map((b) => b.textContent)).toEqual(["Triathlon", "A"]);
    expect(pressed[1].className).toBe(pressed[0].className);
  });
});

describe("dates across a year (round 11 I2)", () => {
  it("a 52-week taper shows both years in its row and its sheet, so it does not read backwards", () => {
    const long = [phase(1, "Long taper", "taper", "2026-09-06", "2027-09-03", 364)];
    render(<SeasonDetailClient {...base} phases={long} next={null} taperFit={{ status: "fits", taperId: 1 }} />);
    const row = screen.getByTestId("phase-row");
    expect(within(row).getByTestId("phase-sub").textContent!.replace(/ /g, " ")).toContain("6 Sep 2026 – 3 Sep 2027");
    fireEvent.click(within(row).getAllByRole("button")[1]);
    const sheet = screen.getByRole("region", { name: "Long taper" });
    expect(sheet.textContent!.replace(/ /g, " ")).toContain("6 Sep 2026 – 3 Sep 2027");
  });
});
