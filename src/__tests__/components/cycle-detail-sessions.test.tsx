// @vitest-environment jsdom
import { CycleCompletionBanner } from "@/components/features/CycleCompletionBanner";
import { CycleWeek, RotationOrder } from "@/components/features/CycleSessionsClient";
import { blockWeeks, type DetailSession, rotationRows } from "@/lib/utils/cycle-detail";
import type { ProgramWithExercises, TrainingCycle } from "@/types/workout";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cycle detail's sessions (docs/plans/plan-tab-redesign.md, P2): the
 * weekday week switcher and its session sheet, "Did you do it?" from a past
 * row, the rotation order with skip and swap by position, and the completed
 * state.
 */

const updatePlannedSession = vi.fn();
const updateRotationSession = vi.fn();
vi.mock("@/lib/actions/planned-sessions", () => ({
  updatePlannedSession: (...a: unknown[]) => updatePlannedSession(...a),
  updateRotationSession: (...a: unknown[]) => updateRotationSession(...a),
}));
const confirmPlannedDone = vi.fn();
vi.mock("@/lib/actions/workouts-compliance", () => ({
  confirmPlannedDone: (...a: unknown[]) => confirmPlannedDone(...a),
  manageIllness: vi.fn(),
}));
const startTrainingCycle = vi.fn();
vi.mock("@/lib/actions/training-cycles", () => ({ startTrainingCycle: (...a: unknown[]) => startTrainingCycle(...a) }));
vi.mock("@/lib/utils/stale-bundle", () => ({ callAction: (p: Promise<unknown>) => p }));
vi.mock("@/contexts/user-settings-context", () => ({ useUnits: () => ({ distance: "km", swim: "m" }) }));
const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const TODAY = "2026-11-17"; // Tue

function session(o: Partial<DetailSession> & Pick<DetailSession, "id" | "date" | "name">): DetailSession {
  return {
    position: 1,
    label: null,
    notes: null,
    summary: null,
    exercises: null,
    programId: 1,
    status: "planned",
    touched: false,
    templateDate: o.date,
    key: false,
    brick: false,
    answer: null,
    ...o,
  };
}

const programsMap = {
  1: {
    id: 1,
    name: "Strength A",
    programExercises: [
      { id: 1, exercise: { name: "Squat", category: "strength", isTimed: false, discipline: null }, programSets: Array(4).fill({ targetReps: null, repRangeMin: 6, repRangeMax: 8, durationSeconds: null }) },
    ],
  },
} as unknown as Record<number, ProgramWithExercises>;

beforeEach(() => {
  updatePlannedSession.mockReset().mockResolvedValue({ success: true, data: { id: 1, date: null, status: "planned" } });
  updateRotationSession.mockReset().mockResolvedValue({ success: true, data: { id: 9, status: "skipped" } });
  confirmPlannedDone.mockReset().mockResolvedValue({ success: true, data: { sessionId: 99 } });
  startTrainingCycle.mockReset().mockResolvedValue({ success: true, data: {} });
  refresh.mockReset();
  push.mockReset();
});

// An 8-week block from Mon 16 Nov.
const weeks = blockWeeks("2026-11-16", 56);
const sessions = [
  session({ id: 1, date: "2026-11-16", name: "Strength A", status: "done", exercises: "Squat" }),
  session({ id: 2, date: "2026-11-17", name: "Strength A", exercises: "Squat" }),
  session({ id: 3, date: "2026-11-19", name: "Bike tempo", programId: null, summary: "60 min", touched: true, templateDate: "2026-11-18" }),
  session({ id: 4, date: "2026-11-22", name: "Long ride", programId: null, summary: "2 h 15", key: true }),
  session({ id: 5, date: "2026-11-22", name: "Run off bike", programId: null, brick: true, position: 2 }),
  session({ id: 6, date: "2026-11-24", name: "Strength B" }),
];

function renderWeek(extra: Partial<Parameters<typeof CycleWeek>[0]> = {}) {
  return render(
    <CycleWeek
      weeks={weeks}
      initialWeek={0}
      sessions={sessions}
      today={TODAY}
      phaseLine="Phase 1 · General prep"
      programs={[
        { id: 1, name: "Strength A" },
        { id: 7, name: "Strength C" },
      ]}
      programsMap={programsMap}
      templateHref="/cycles/5/template"
      {...extra}
    />,
  );
}

describe("weekday week", () => {
  it("shows one week of dated sessions, with rest days, a key session and a brick, and switches weeks", () => {
    renderWeek();
    expect(screen.getByText("Week 1 of 8")).toBeTruthy();
    expect(screen.getByText("16–22 Nov")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous week" }) as HTMLButtonElement).disabled).toBe(true);
    const rows = screen.getAllByTestId("week-row");
    // Mon, Tue, Wed rest, Thu, Fri rest, Sat rest, Sun ride, Sun run.
    expect(rows).toHaveLength(8);
    expect(rows[2].textContent).toContain("Rest");
    expect(within(rows[6]).getByText("Key")).toBeTruthy();
    expect(within(rows[7]).getByRole("img", { name: "Brick, linked to the ride" })).toBeTruthy();
    // A done session does not open a sheet.
    expect(rows[0].tagName).toBe("DIV");
    expect(rows[0].textContent).toContain("Done");
    expect(screen.getByRole("link", { name: /Edit weekly template/ }).getAttribute("href")).toBe("/cycles/5/template");

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByText("Week 2 of 8")).toBeTruthy();
    expect(screen.getByText("23–29 Nov")).toBeTruthy();
    expect(screen.getByText("Strength B")).toBeTruthy();
    expect(screen.queryByText("Long ride")).toBeNull();
  });

  it("names a labelled day with no session, and marks a moved session and the day it left", () => {
    renderWeek({ dayLabels: { 5: "Mobility" } });
    const rows = screen.getAllByTestId("week-row");
    // Fri 20 Nov: the label, not Rest.
    expect(rows[4].textContent).toBe("Fri20 NovMobility›");
    // Bike tempo moved from Wed to Thu.
    expect(rows[2].textContent).toBe("Wed18 NovRestMoved to Thu");
    expect(rows[3].textContent).toContain("Moved from Wed");
  });

  it("a labelled day shows its whole label and opens a sheet with the label and the note (J5-11)", () => {
    const label = "Mobility, stretching and the long drive home after the race weekend";
    renderWeek({ dayLabels: { 5: label }, dayNotes: { 5: "Twenty minutes on the hips." } });
    const row = screen.getByRole("button", { name: `Fri 20 Nov: ${label}` });
    expect(within(row).getByText(label).className).not.toContain("truncate");
    fireEvent.click(row);
    const sheet = screen.getByTestId("day-label-sheet");
    expect(within(sheet).getByRole("heading", { name: label })).toBeTruthy();
    expect(within(sheet).getByText("Twenty minutes on the hips.")).toBeTruthy();
    expect(within(sheet).getByText("Fri 20 Nov")).toBeTruthy();
  });

  it("a plain rest day does not open", () => {
    renderWeek();
    expect(screen.queryByRole("button", { name: /^Wed 18 Nov/ })).toBeNull();
  });

  it("marks a session changed on its own day", () => {
    renderWeek({ sessions: [session({ id: 9, date: "2026-11-18", name: "Hill repeats", touched: true, exercises: "Squat" })] });
    expect(screen.getAllByTestId("week-row")[2].textContent).toContain("Changed · Squat");
  });

  it("opens today's session with its exercises and Start workout", () => {
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Tue 17 Nov: Strength A/ }));
    const sheet = screen.getByTestId("session-sheet");
    expect(within(sheet).getByText("Today")).toBeTruthy();
    expect(within(sheet).getByText("4 × 6–8")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Start workout" }).getAttribute("href")).toBe("/programs/1/workout?planned=2");
  });

  it("moves a session to another day of its week; past days and the current day cannot be picked", async () => {
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    const sheet = screen.getByTestId("session-sheet");
    expect(within(sheet).getByRole("heading", { name: "Bike tempo · 60 min" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Move to another day" }));
    expect((within(sheet).getByRole("button", { name: "Mon 16 Nov" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(sheet).getByRole("button", { name: "Thu 19 Nov, current day" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText("Sun has a key session. You cannot pick a day in the past.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Sat 21 Nov" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "move", id: 3, date: "2026-11-21" });
    expect(refresh).toHaveBeenCalled();
  });

  it("swaps the program, puts a changed day back to the template, and skips", async () => {
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    let sheet = screen.getByTestId("session-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Swap program" }));
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Strength C" }));
    });
    expect(updatePlannedSession).toHaveBeenLastCalledWith({ op: "change", id: 3, programId: 7 });

    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    sheet = screen.getByTestId("session-sheet");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: /Back to the template/ }));
    });
    expect(updatePlannedSession).toHaveBeenLastCalledWith({ op: "reset", id: 3 });

    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    sheet = screen.getByTestId("session-sheet");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Skip this session" }));
    });
    expect(updatePlannedSession).toHaveBeenLastCalledWith({ op: "skip", id: 3 });
  });

  it("wraps a long session name to two lines instead of cutting it (J5-01)", () => {
    renderWeek();
    for (const name of screen.getAllByTestId("week-row-name")) {
      expect(name.className).toContain("line-clamp-2");
      expect(name.className).not.toContain("truncate");
    }
  });

  it("saves a label and a note for one day", async () => {
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    const sheet = screen.getByTestId("session-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Label and note" }));
    fireEvent.change(within(sheet).getByLabelText("Label"), { target: { value: "Hills" } });
    fireEvent.change(within(sheet).getByLabelText("Note"), { target: { value: "Keep it steady" } });
    // The label style and button layout of the other Plan sheets (J5-06):
    // uppercase labels, Save full width over a plain Cancel.
    expect(within(sheet).getByText("Label").className).toContain("uppercase");
    const save = within(sheet).getByRole("button", { name: "Save" });
    const cancel = within(sheet).getByRole("button", { name: "Cancel" });
    expect(save.className).toContain("w-full");
    expect(save.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.parentElement).toBe(save.parentElement);
    expect(cancel.parentElement!.className).not.toContain("grid-cols-2");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "change", id: 3, label: "Hills", notes: "Keep it steady" });
  });

  it("shows a failed change in the sheet and keeps it open", async () => {
    updatePlannedSession.mockResolvedValue({ success: false, error: "Pick a day in the block." });
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    const sheet = screen.getByTestId("session-sheet");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Skip this session" }));
    });
    expect(within(sheet).getByRole("alert").textContent).toBe("Pick a day in the block.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers Use a workout only with the library (endurance) and plans a skipped session again", async () => {
    const { unmount } = renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    expect(within(screen.getByTestId("session-sheet")).queryByRole("button", { name: "Use a workout" })).toBeNull();
    unmount();

    renderWeek({
      library: [{ id: 40, name: "Tempo 2x20", sport: "bike", summary: "60 min" }],
      sessions: [...sessions.slice(0, 2), { ...sessions[2], status: "skipped" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    const sheet = screen.getByTestId("session-sheet");
    expect(within(sheet).queryByRole("button", { name: "Use a workout" })).toBeNull();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Plan again" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "unskip", id: 3 });
  });

  it("uses a library workout for one day (endurance)", async () => {
    renderWeek({ library: [{ id: 40, name: "Tempo 2x20", sport: "bike", summary: "60 min" }] });
    fireEvent.click(screen.getByRole("button", { name: /^Thu 19 Nov: Bike tempo/ }));
    const sheet = screen.getByTestId("session-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Use a workout" }));
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: /Tempo 2x20/ }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "set_workout", id: 3, workoutId: 40 });
  });
});

describe("Did you do it? from a past row", () => {
  const answer = { id: 1, date: "2026-11-16", name: "Run aerobic", summary: "65 min", sport: "run" as const };
  const past = [session({ id: 1, date: "2026-11-16", name: "Run aerobic", programId: null, status: "missed", answer })];

  it("opens with no answer chosen", () => {
    renderWeek({ sessions: past });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Run aerobic/ }));
    const sheet = screen.getByTestId("did-you-do-it-sheet");
    expect(within(sheet).getByRole("button", { name: "Yes, I did it" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(sheet).getByRole("button", { name: "Missed" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(sheet).queryByLabelText("Time (h:mm)")).toBeNull();
    expect((within(sheet).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("logs Yes with the time and effort", async () => {
    renderWeek({ sessions: past });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Run aerobic, Did you do it\?/ }));
    const sheet = screen.getByTestId("did-you-do-it-sheet");
    expect(within(sheet).getByText("No run found for this day. Did you do it?")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Yes, I did it" }));
    fireEvent.change(within(sheet).getByLabelText("Time (h:mm)"), { target: { value: "1:05" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Effort 6" }));
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });
    expect(confirmPlannedDone).toHaveBeenCalledWith({ plannedSessionId: 1, durationSeconds: 3900, distanceMeters: null, rpe: 6, notes: null });
    expect(refresh).toHaveBeenCalled();
  });

  it("stores Missed", async () => {
    renderWeek({ sessions: past });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Run aerobic/ }));
    const sheet = screen.getByTestId("did-you-do-it-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Missed" }));
    expect(within(sheet).queryByLabelText("Time (h:mm)")).toBeNull();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "miss", id: 1 });
    expect(confirmPlannedDone).not.toHaveBeenCalled();
  });

  it("says why Save is off for a negative distance", () => {
    renderWeek({ sessions: past });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Run aerobic/ }));
    const sheet = screen.getByTestId("did-you-do-it-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Yes, I did it" }));
    fireEvent.change(within(sheet).getByLabelText("Time (h:mm)"), { target: { value: "1:05" } });
    fireEvent.change(within(sheet).getByLabelText(/^Distance/), { target: { value: "-5" } });
    expect((within(sheet).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText("Type a distance of 0 or more.")).toBeTruthy();
  });
});

describe("a missed key session", () => {
  const missed = session({ id: 7, date: "2026-11-16", name: "Long ride", programId: null, status: "missed", key: true, moveTo: { date: "2026-11-21" } });

  it("offers the suggested day, as home does, and moves it there", async () => {
    renderWeek({ sessions: [missed] });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Long ride/ }));
    const sheet = screen.getByTestId("session-sheet");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Move to Sat 21 Nov" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "move", id: 7, date: "2026-11-21" });
  });

  it("says why there is no day to move to", () => {
    renderWeek({ sessions: [{ ...missed, moveTo: { date: null, reason: "No free day this week. Skip it and go on." } }] });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Long ride/ }));
    expect(within(screen.getByTestId("session-sheet")).getByText("No free day this week. Skip it and go on.")).toBeTruthy();
  });
});

describe("closing a Plan sheet", () => {
  it("closes on Escape and on its 44 px close button", async () => {
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Tue 17 Nov: Strength A/ }));
    expect(screen.getByTestId("session-sheet")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("session-sheet")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /^Tue 17 Nov: Strength A/ }));
    const close = within(screen.getByTestId("session-sheet")).getByRole("button", { name: "Close" });
    expect(close.className).toMatch(/\bw-11\b/);
    expect(close.className).toMatch(/\bh-11\b/);
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByTestId("session-sheet")).toBeNull());
  });
});

describe("rotation order", () => {
  const slots = [
    { id: 11, orderIndex: 1, programId: 1, label: null, programName: "Upper A" },
    { id: 12, orderIndex: 2, programId: 2, label: null, programName: "Lower A" },
    { id: 13, orderIndex: 3, programId: null, label: "Rest", programName: null },
    { id: 14, orderIndex: 4, programId: 3, label: null, programName: "Upper B" },
  ];
  const walk = [
    { date: "2026-11-16", slotId: 11, rotationPosition: 0, programId: 1, programName: "Upper A", status: "done" as const },
    { date: "2026-11-17", slotId: 12, rotationPosition: 1, programId: 2, programName: "Lower A", status: "planned" as const },
    { date: "2026-11-19", slotId: 14, rotationPosition: 3, programId: 3, programName: "Upper B", status: "planned" as const },
    { date: "2026-11-20", slotId: 11, rotationPosition: 4, programId: 1, programName: "Upper A", status: "planned" as const },
  ];

  function renderOrder() {
    return render(
      <RotationOrder
        cycleId={5}
        rows={rotationRows(slots, walk, TODAY)}
        today={TODAY}
        programs={[
          { id: 1, name: "Upper A" },
          { id: 2, name: "Lower A" },
          { id: 9, name: "Full body" },
        ]}
        programsMap={programsMap}
        editHref="/cycles/5/template"
        active
      />,
    );
  }

  it("lists the order with the last done, the next session and the rest day", () => {
    renderOrder();
    const rows = screen.getAllByTestId("rotation-row");
    expect(rows.map((r) => r.textContent)).toEqual(["1Upper ADone Mon", "2Lower ANext", "3RestRest day", expect.stringMatching(/^4Upper B/)]);
    expect(within(rows[2]).queryByRole("button")).toBeNull();
    expect(screen.getByText("Repeats every 4 days. A missed session waits for you.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit order" }).getAttribute("href")).toBe("/cycles/5/template");
  });

  it("marks a coming swapped session as swapped, not done", () => {
    const swapped = walk.map((d) => (d.rotationPosition === 4 ? { ...d, programId: 9, programName: "Full body" } : d));
    render(
      <RotationOrder cycleId={5} rows={rotationRows(slots, swapped, TODAY)} today={TODAY} programs={[]} programsMap={programsMap} editHref="/cycles/5/template" active />,
    );
    expect(screen.getAllByTestId("rotation-row")[0].textContent).toBe("1Full bodySwapped");
  });

  it("skips today's session by its position", async () => {
    renderOrder();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Lower A" }));
    const sheet = screen.getByTestId("rotation-sheet");
    expect(within(sheet).getByText("Today")).toBeTruthy();
    expect(within(sheet).getByText(/Position 2 of 4/)).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Start workout" }).getAttribute("href")).toBe("/programs/2/workout");
    // A real action: the normal row text, not the grey of a dimmed one (J3-03).
    expect(within(sheet).getByRole("button", { name: "Skip this time" }).className).not.toContain("text-muted-foreground");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Skip this time" }));
    });
    expect(updateRotationSession).toHaveBeenCalledWith({ op: "skip", cycleId: 5, rotationPosition: 1 });
    expect(refresh).toHaveBeenCalled();
  });

  it("swaps the program of a later session by its position", async () => {
    renderOrder();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Upper A" }));
    const sheet = screen.getByTestId("rotation-sheet");
    expect(within(sheet).queryByRole("link", { name: "Start workout" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Swap program" }));
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Full body" }));
    });
    expect(updateRotationSession).toHaveBeenCalledWith({ op: "change", cycleId: 5, rotationPosition: 4, programId: 9 });
  });
});

describe("the session sheets say the session's state (J3-10, J5-08, J5-13, J5-15)", () => {
  it("a skipped, a missed, a moved and a changed day each say so in the header line", () => {
    renderWeek({
      sessions: [
        session({ id: 1, date: "2026-11-16", name: "Long ride", programId: null, status: "missed", key: true, moveTo: { date: "2026-11-21" } }),
        session({ id: 3, date: "2026-11-19", name: "Bike tempo", programId: null, touched: true, templateDate: "2026-11-18" }),
        session({ id: 6, date: "2026-11-20", name: "Bike intervals", programId: null, status: "skipped", touched: true }),
        session({ id: 8, date: "2026-11-21", name: "Hill repeats", touched: true }),
      ],
    });
    const open = (name: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name }));
      return screen.getByTestId("session-sheet");
    };
    expect(within(open(/^Mon 16 Nov: Long ride/)).getByText("Mon 16 Nov · Missed")).toBeTruthy();
    expect(within(open(/^Thu 19 Nov: Bike tempo/)).getByText("Thu 19 Nov · Moved from Wed")).toBeTruthy();
    expect(within(open(/^Fri 20 Nov: Bike intervals/)).getByText("Fri 20 Nov · Skipped")).toBeTruthy();
    expect(within(open(/^Sat 21 Nov: Hill repeats/)).getByText("Sat 21 Nov · Changed")).toBeTruthy();
  });

  it("a day that was only skipped offers Plan again and not Back to the template (J5-08)", () => {
    renderWeek({ sessions: [session({ id: 6, date: "2026-11-20", name: "Bike intervals", programId: null, status: "skipped", touched: true })] });
    fireEvent.click(screen.getByRole("button", { name: /^Fri 20 Nov: Bike intervals/ }));
    const sheet = screen.getByTestId("session-sheet");
    expect(within(sheet).getByRole("button", { name: "Plan again" })).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: /Back to the template/ })).toBeNull();
  });

  it("a plain planned day shows only its day", () => {
    renderWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Tue 17 Nov: Strength A/ }));
    expect(within(screen.getByTestId("session-sheet")).getByText("Today")).toBeTruthy();
  });

  it("a swapped rotation turn says Swapped, also when it is the next one", () => {
    const slots = [
      { id: 11, orderIndex: 1, programId: 1, label: null, programName: "Upper A" },
      { id: 12, orderIndex: 2, programId: 2, label: null, programName: "Lower A" },
    ];
    const walk = [
      { date: "2026-11-17", slotId: 11, rotationPosition: 0, programId: 9, programName: "Full body", status: "planned" as const },
      { date: "2026-11-18", slotId: 12, rotationPosition: 1, programId: 9, programName: "Full body", status: "planned" as const },
    ];
    render(<RotationOrder cycleId={5} rows={rotationRows(slots, walk, TODAY)} today={TODAY} programs={[]} programsMap={programsMap} editHref="/cycles/5/template" active />);
    fireEvent.click(screen.getAllByRole("button", { name: "Actions for Full body" })[1]);
    expect(within(screen.getByTestId("rotation-sheet")).getByText("Later · Swapped")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: "Actions for Full body" })[0]);
    expect(within(screen.getByTestId("rotation-sheet")).getByText("Today · Swapped")).toBeTruthy();
  });

  it("the swapped turn's sheet names the program it replaced and swaps back to it (J3-10)", async () => {
    const slots = [
      { id: 11, orderIndex: 1, programId: 1, label: null, programName: "Upper A" },
      { id: 12, orderIndex: 2, programId: 2, label: null, programName: "Lower A" },
    ];
    const walk = [
      { date: "2026-11-17", slotId: 11, rotationPosition: 0, programId: 1, programName: "Upper A", status: "planned" as const },
      { date: "2026-11-18", slotId: 12, rotationPosition: 1, programId: 9, programName: "Full body", status: "planned" as const },
    ];
    render(<RotationOrder cycleId={5} rows={rotationRows(slots, walk, TODAY)} today={TODAY} programs={[]} programsMap={programsMap} editHref="/cycles/5/template" active />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Full body" }));
    const sheet = screen.getByTestId("rotation-sheet");
    expect(within(sheet).getByText("Swapped from Lower A")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Back to Lower A" }));
    });
    expect(updateRotationSession).toHaveBeenCalledWith({ op: "change", programId: 2, cycleId: 5, rotationPosition: 1 });
  });
});

describe("a dimmed Save says what is missing (J5-10)", () => {
  const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
  const answer = { id: 1, date: "2026-11-16", name: "Run aerobic", summary: "65 min", sport: "run" as const };

  it("asks for an answer, then for the time", () => {
    renderWeek({ sessions: [session({ id: 1, date: "2026-11-16", name: "Run aerobic", programId: null, status: "missed", answer })] });
    fireEvent.click(screen.getByRole("button", { name: /^Mon 16 Nov: Run aerobic/ }));
    const sheet = screen.getByTestId("did-you-do-it-sheet");
    const save = within(sheet).getByRole("button", { name: "Save" });
    expect(reasonOf(save)).toBe("Pick Yes or Missed.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Yes, I did it" }));
    expect(reasonOf(save)).toBe("Type a time.");
    fireEvent.change(within(sheet).getByLabelText("Time (h:mm)"), { target: { value: "1:05" } });
    expect(save.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Missed" }));
    expect(save.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("completed cycle", () => {
  const done = { id: 5, name: "Upper / Lower", status: "completed", endAction: "none", endMessage: null } as unknown as TrainingCycle;

  it("names the next cycle and starts it now", async () => {
    render(<CycleCompletionBanner cycle={done} lengthLabel="6 weeks" endedLabel="ended 20 Dec" next={{ id: 8, name: "Strength peak", startsLabel: "Mon 28 Dec", startsTomorrow: false }} />);
    expect(screen.getByText("Cycle complete")).toBeTruthy();
    expect(screen.getByText("6 weeks · ended 20 Dec")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Strength peak starts Mon\s28\sDec/ }).getAttribute("href")).toBe("/cycles/8");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start now instead" }));
    });
    expect(startTrainingCycle).toHaveBeenCalledWith(8);
    expect(push).toHaveBeenCalledWith("/cycles/8");
  });

  it("has no Start now instead when the next cycle starts tomorrow", () => {
    render(<CycleCompletionBanner cycle={done} lengthLabel="6 weeks" endedLabel="ended 20 Dec" next={{ id: 8, name: "Strength peak", startsLabel: "Mon 21 Dec", startsTomorrow: true }} />);
    expect(screen.getByRole("link", { name: /Strength peak starts Mon\s21\sDec/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start now instead" })).toBeNull();
  });

  it("offers no start while another cycle is running, only the link to the next cycle", () => {
    render(
      <CycleCompletionBanner
        cycle={done}
        lengthLabel="6 weeks"
        endedLabel="ended 20 Dec"
        next={{ id: 8, name: "Strength peak", startsLabel: "Mon 28 Dec", startsTomorrow: false }}
        running={{ id: 4, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6 }}
      />,
    );
    expect(screen.getByRole("link", { name: /Strength peak starts Mon\s28\sDec/ }).getAttribute("href")).toBe("/cycles/8");
    expect(screen.queryByRole("button", { name: "Start now instead" })).toBeNull();
  });

  it("hides on Not now", () => {
    render(<CycleCompletionBanner cycle={done} lengthLabel="6 weeks" endedLabel="ended 20 Dec" next={{ id: 8, name: "Strength peak", startsLabel: "Mon 28 Dec", startsTomorrow: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("cycle-complete")).toBeNull();
  });
});
