// @vitest-environment jsdom
import { CreateCycleForm, CycleSetupSessions } from "@/components/features/CreateCycleForm";
import { CycleScheduleBuilder, type PickerProgram } from "@/components/features/CycleScheduleBuilder";
import {
  createTrainingCycle,
  deleteTrainingCycle,
  removeCycleSlot,
  reorderCycleSlots,
  startTrainingCycle,
  updateTrainingCycle,
  upsertCycleSlot,
} from "@/lib/actions/training-cycles";
import type { StartDays } from "@/lib/utils/cycle-setup";
import type { TrainingCycle, TrainingCycleWithSlots } from "@/types/workout";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The new cycle setup (docs/plans/plan-tab-redesign.md, P3): step 1 makes the
 * draft with its start day, step 2 builds the sessions and starts or schedules
 * it; the rotation and weekday builders save each change.
 */

vi.mock("@/lib/actions/training-cycles", () => ({
  createTrainingCycle: vi.fn(),
  deleteTrainingCycle: vi.fn(),
  updateTrainingCycle: vi.fn(),
  startTrainingCycle: vi.fn(),
  removeCycleSlot: vi.fn(),
  reorderCycleSlots: vi.fn(),
  upsertCycleSlot: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({ createProgram: vi.fn() }));
const returnTo = vi.fn();
const goBack = vi.fn();
vi.mock("@/components/ui/BackLink", () => ({
  useReturnTo: () => returnTo,
  useBack: () => ({ label: "Plan", onClick: vi.fn(), go: goBack }),
}));
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** The line a dimmed button points to with aria-describedby. */
const reasonOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

const days: StartDays = { today: "2026-11-14", nextMonday: "2026-11-16", afterCurrent: null, latest: "2027-03-14" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createTrainingCycle).mockResolvedValue({ success: true, data: { id: 5 } as TrainingCycle });
  vi.mocked(updateTrainingCycle).mockResolvedValue({ success: true, data: { id: 5 } as TrainingCycle });
  vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: { id: 5 } as TrainingCycle });
  vi.mocked(upsertCycleSlot).mockResolvedValue({ success: true, data: {} as never });
  vi.mocked(removeCycleSlot).mockResolvedValue({ success: true, data: undefined });
  vi.mocked(reorderCycleSlots).mockResolvedValue({ success: true, data: undefined });
  vi.mocked(deleteTrainingCycle).mockResolvedValue({ success: true, data: undefined });
});

describe("step 1: the basics", () => {
  it("makes a rotation draft and opens step 2 with the start day", async () => {
    render(<CreateCycleForm days={days} />);
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Upper / Lower" } });
    fireEvent.click(screen.getByLabelText(/Rotation/));
    fireEvent.click(screen.getByRole("button", { name: "6 weeks" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Monday · 16 Nov" }));
    fireEvent.click(screen.getByRole("button", { name: "Deload week" }));
    fireEvent.click(screen.getByRole("button", { name: "Put the sessions in order" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/cycles/new?cycle=5&start=2026-11-16"));
    expect(createTrainingCycle).toHaveBeenCalledWith({
      name: "Upper / Lower",
      durationWeeks: 6,
      endAction: "deload",
      scheduleType: "rotation",
      endMessage: undefined,
    });
  });

  it("Custom takes any number of weeks from 1 to 52", async () => {
    render(<CreateCycleForm days={days} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Odd block" } });
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const weeks = screen.getByLabelText("Length in weeks");
    fireEvent.change(weeks, { target: { value: "60" } });
    expect((screen.getByRole("button", { name: "Build the week" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pick 1 to 52 weeks.")).toBeTruthy();
    fireEvent.change(weeks, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Build the week" }));
    await waitFor(() => expect(createTrainingCycle).toHaveBeenCalledWith(expect.objectContaining({ name: "Odd block", durationWeeks: 7 })));
  });

  it("the Custom field has no native spin buttons, which are under 44 px: a text field with a number keypad (round 8)", () => {
    render(<CreateCycleForm days={days} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const weeks = screen.getByLabelText("Length in weeks") as HTMLInputElement;
    expect(weeks.type).toBe("text");
    expect(weeks.inputMode).toBe("numeric");
    fireEvent.change(weeks, { target: { value: "1x2" } });
    expect(weeks.value).toBe("12");
  });

  it("labels Start day as the other fields are, and says the picked day in words (round 8)", () => {
    render(<CreateCycleForm days={days} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    const label = screen.getByText("Start day");
    expect(label.className).toContain("uppercase");
    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-12-07" } });
    expect(screen.getByText("Starts Mon 7 Dec")).toBeTruthy();
  });

  it("needs a day for Pick a date, and offers After current cycle only while a cycle runs", async () => {
    const { unmount } = render(<CreateCycleForm days={days} />);
    expect(screen.queryByRole("button", { name: "After current cycle" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Block" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    const next = screen.getByRole("button", { name: "Build the week" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-12-01" } });
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/cycles/new?cycle=5&start=2026-12-01"));
    unmount();

    render(<CreateCycleForm days={{ ...days, afterCurrent: "2026-12-21" }} />);
    fireEvent.click(screen.getByRole("button", { name: "After current cycle" }));
    expect(screen.getByText("Starts Mon 21 Dec")).toBeTruthy();
  });

  it("back from step 2 changes the draft: the same start is chosen, the schedule type is fixed", async () => {
    const draft = { id: 5, name: "Block", durationWeeks: 16, scheduleType: "rotation", endAction: "none", endMessage: null } as unknown as TrainingCycle;
    render(<CreateCycleForm days={days} draft={draft} start="2026-11-16" />);
    expect(screen.getByRole("button", { name: "Next Monday · 16 Nov" }).getAttribute("aria-pressed")).toBe("true");
    // 16 is not a main chip, so Custom is on with 16 in its field.
    expect(screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Length in weeks") as HTMLInputElement).value).toBe("16");
    expect((screen.getByLabelText(/Same days each week/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Put the sessions in order" }));
    await waitFor(() => expect(updateTrainingCycle).toHaveBeenCalledWith({ id: 5, name: "Block", durationWeeks: 16, endAction: "none", endMessage: null }));
    expect(createTrainingCycle).not.toHaveBeenCalled();
  });

  it("says which scheduled draft the start drops, in the words the cycle page uses", () => {
    const scheduled = { id: 7, name: "Strength peak", day: "2026-12-14", season: null };
    render(<CreateCycleForm days={days} scheduled={scheduled} />);
    const line = "Strength peak no longer starts Mon 14 Dec.";
    // No day picked yet: no start is chosen.
    expect(screen.queryByText(line)).toBeNull();
    // A start today drops the other scheduled start too (activateInSession).
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText(line)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next Monday · 16 Nov" }));
    expect(screen.getByText(line)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    expect(screen.queryByText(line)).toBeNull();
    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-12-01" } });
    expect(screen.getByText(line)).toBeTruthy();
  });

  it("says a season pauses when the start drops its next phase", () => {
    const scheduled = { id: 8, name: "Build", day: "2026-11-16", season: { id: 4, name: "Jevnaker Half 2027" } };
    render(<CreateCycleForm days={days} scheduled={scheduled} />);
    fireEvent.click(screen.getByRole("button", { name: "Next Monday · 16 Nov" }));
    expect(screen.getByText("Jevnaker Half 2027 pauses. Its next phase no longer starts Mon 16 Nov. You can resume it from the season.")).toBeTruthy();
  });

  it("says the start ends the running cycle, at the last week it runs (J2-01, J2-05, round 8)", () => {
    const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6, startDate: "2026-10-31", durationDays: null };
    render(<CreateCycleForm days={{ ...days, afterCurrent: "2026-12-12" }} running={running} />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("This ends Upper / Lower hypertrophy at week 2 of 6.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-12-07" } });
    expect(screen.getByText("This ends Upper / Lower hypertrophy at week 6 of 6.")).toBeTruthy();
    // After the running cycle nothing ends.
    fireEvent.click(screen.getByRole("button", { name: "After current cycle" }));
    expect(screen.queryByText(/^This ends/)).toBeNull();
  });

  it("starts after the running cycle by default, so nothing ends or is dropped until the user picks Today (round 8)", () => {
    const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6, startDate: "2026-10-31", durationDays: null };
    render(<CreateCycleForm days={{ ...days, afterCurrent: "2026-12-12" }} running={running} />);
    expect(screen.getByRole("button", { name: "After current cycle" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/^This ends/)).toBeNull();
    // Today stays one tap away.
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("This ends Upper / Lower hypertrophy at week 2 of 6.")).toBeTruthy();
  });

  it("with a draft scheduled, no start is chosen by default, so nothing is dropped until the user picks one (round 9)", () => {
    const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6, startDate: "2026-10-31", durationDays: null };
    const scheduled = { id: 7, name: "Strength peak", day: "2026-12-13", season: null };
    const line = "Strength peak no longer starts Sun 13 Dec.";
    for (const props of [{ days: { ...days, afterCurrent: "2026-12-12" }, running }, { days }]) {
      const { unmount } = render(<CreateCycleForm {...props} scheduled={scheduled} />);
      expect(screen.getByRole("button", { name: "Pick a date" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.queryByText(line)).toBeNull();
      expect(screen.queryByText(/^This ends/)).toBeNull();
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Base" } });
      const build = screen.getByRole("button", { name: "Build the week" });
      expect(build.hasAttribute("disabled")).toBe(true);
      expect(reasonOf(build)).toBe("Pick a start day.");
      // The user can still pick a start that drops it.
      fireEvent.click(screen.getByRole("button", { name: "Today" }));
      expect(screen.getByText(line)).toBeTruthy();
      unmount();
    }
  });

  it("starts today by default when no cycle runs", () => {
    render(<CreateCycleForm days={days} />);
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the Name placeholder is neutral, not a cycle name the user may have (round 8)", () => {
    render(<CreateCycleForm days={days} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).placeholder).toBe("Cycle name");
  });

  it("a dimmed Build the week says what is missing (J2-01)", () => {
    render(<CreateCycleForm days={days} />);
    const next = screen.getByRole("button", { name: "Build the week" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(reasonOf(next)).toBe("Give the cycle a name.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Block" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    expect(reasonOf(next)).toBe("Pick a start day.");
    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-12-01" } });
    expect(next.disabled).toBe(false);
    expect(next.getAttribute("aria-describedby")).toBeNull();
  });

  it("shows a refused write and stays on step 1", async () => {
    vi.mocked(createTrainingCycle).mockResolvedValue({ success: false, error: "Failed to create the cycle" });
    render(<CreateCycleForm days={days} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Block" } });
    fireEvent.click(screen.getByRole("button", { name: "Build the week" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed to create the cycle"));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

const programs: PickerProgram[] = [
  { id: 11, name: "Upper A", exerciseCount: 6 },
  { id: 12, name: "Lower A", exerciseCount: 1 },
] as PickerProgram[];

const slot = (s: Record<string, unknown>) => ({
  label: null,
  notes: null,
  programId: null,
  program: null,
  workoutId: null,
  autoComplete: false,
  priority: null,
  brickWithNext: false,
  daySlot: 1,
  dayOfWeek: null,
  orderIndex: null,
  ...s,
});

const rotation = {
  id: 3,
  scheduleType: "rotation",
  slots: [
    slot({ id: 21, orderIndex: 1, label: "Upper A", programId: 11, program: programs[0] }),
    slot({ id: 22, orderIndex: 2, label: "Rest" }),
    slot({ id: 23, orderIndex: 3, label: "Lower A", programId: 12, program: programs[1] }),
  ],
} as unknown as TrainingCycleWithSlots;

describe("step 2", () => {
  it("Create cycle starts or schedules the draft for the chosen day", async () => {
    render(<CycleSetupSessions cycle={rotation} programs={programs} start="2026-11-16" endurance={false} />);
    expect(screen.getByRole("heading", { name: "Rotation order" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/cycles/new?cycle=3&start=2026-11-16&step=1");
    fireEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    await waitFor(() => expect(returnTo).toHaveBeenCalledWith("/cycles/3"));
    expect(startTrainingCycle).toHaveBeenCalledWith(3, "2026-11-16");
  });

  it("asks first when the start ends the running cycle or drops a scheduled start (round 8 B14)", async () => {
    const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6, startDate: "2026-10-31", durationDays: null };
    const scheduled = { id: 7, name: "Strength peak", day: "2026-11-23", season: null };
    render(
      <CycleSetupSessions cycle={{ ...rotation, name: "Push / Pull" }} programs={programs} start="2026-11-14" endurance={false} running={running} scheduled={scheduled} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    const sheet = screen.getByRole("region", { name: "Start Push / Pull Sat 14 Nov?" });
    expect(sheet.textContent!.replace(/ /g, " ")).toContain("This ends Upper / Lower hypertrophy at week 2 of 6.");
    expect(sheet.textContent!.replace(/ /g, " ")).toContain("Strength peak no longer starts Mon 23 Nov.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Create cycle" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3, "2026-11-14"));
  });

  it("creates at once when the start ends and drops nothing", async () => {
    const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6, startDate: "2026-10-31", durationDays: null };
    render(<CycleSetupSessions cycle={rotation} programs={programs} start="2026-12-12" endurance={false} running={running} scheduled={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3, "2026-12-12"));
  });

  it("names the cycle being built under the title (round 8)", () => {
    render(<CycleSetupSessions cycle={{ ...rotation, name: "Push / Pull rotation" }} programs={programs} start="2026-11-16" endurance={false} />);
    const header = screen.getByTestId("form-header");
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("New cycle");
    expect(within(header).getByText("Push / Pull rotation")).toBeTruthy();
  });

  it("puts Cancel on the left on both steps, as step 1 does (J2-07)", () => {
    const { unmount } = render(<CreateCycleForm days={days} />);
    const leftOf = () => screen.getByTestId("form-header").firstElementChild as HTMLElement;
    expect(within(leftOf()).getByRole("button", { name: "Cancel" })).toBeTruthy();
    unmount();
    render(<CycleSetupSessions cycle={rotation} programs={programs} start="2026-11-16" endurance={false} />);
    expect(within(leftOf()).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(screen.getByTestId("form-header").lastElementChild as HTMLElement).getByRole("link", { name: "Back" })).toBeTruthy();
  });

  it("Create cycle stays off with a reason until the cycle has a session", () => {
    const empty = { ...rotation, slots: [slot({ id: 22, orderIndex: 1, label: "Rest" })] } as unknown as TrainingCycleWithSlots;
    render(<CycleSetupSessions cycle={empty} programs={programs} start="2026-11-16" endurance={false} />);
    expect((screen.getByRole("button", { name: "Create cycle" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Add a session first.")).toBeTruthy();
  });

  it("Cancel asks first, then discards the draft and goes back to Plan", async () => {
    render(<CycleSetupSessions cycle={rotation} programs={programs} start="2026-11-16" endurance={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const sheet = screen.getByRole("region", { name: "Discard this cycle?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep building" }));
    expect(deleteTrainingCycle).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Discard this cycle?" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Discard this cycle?" })).getByRole("button", { name: "Discard cycle" }));
    await waitFor(() => expect(returnTo).toHaveBeenCalledWith("/cycles"));
    expect(deleteTrainingCycle).toHaveBeenCalledWith(3);
    expect(startTrainingCycle).not.toHaveBeenCalled();
  });

  it("a refused discard shows in the sheet and stays on step 2", async () => {
    vi.mocked(deleteTrainingCycle).mockResolvedValue({ success: false, error: "Failed to delete the cycle" });
    render(<CycleSetupSessions cycle={rotation} programs={programs} start="2026-11-16" endurance={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const sheet = screen.getByRole("region", { name: "Discard this cycle?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Discard cycle" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toBe("Failed to delete the cycle"));
    expect(returnTo).not.toHaveBeenCalled();
  });

  it("shows why the cycle did not start", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: false, error: "The start day is in the past" });
    render(<CycleSetupSessions cycle={rotation} programs={programs} start="2026-11-13" endurance={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The start day is in the past"));
    expect(returnTo).not.toHaveBeenCalled();
  });
});

describe("rotation builder", () => {
  it("lists the order and says how often it repeats", () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["1Upper A", "2Rest", "3Lower A"]);
    expect(screen.getByText("Repeats every 3 days. A missed session waits for you. It does not skip.")).toBeTruthy();
  });

  it("adds a session from the program picker after the last position", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add session" }));
    const sheet = screen.getByRole("region", { name: "Pick a program" });
    expect(within(sheet).getByText("6 exercises")).toBeTruthy();
    expect(within(sheet).getByText("1 exercise")).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Search programs"), { target: { value: "low" } });
    expect(within(sheet).queryByText("Upper A")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: /Lower A/ }));
    await waitFor(() =>
      expect(upsertCycleSlot).toHaveBeenCalledWith({ trainingCycleId: 3, orderIndex: 4, programId: 12, label: "Lower A" }),
    );
  });

  it("a dimmed Create for a new program says the name is missing", () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add session" }));
    const sheet = screen.getByRole("region", { name: "Pick a program" });
    fireEvent.click(within(sheet).getByRole("button", { name: "+ New program" }));
    const create = within(sheet).getByRole("button", { name: "Create" });
    expect(reasonOf(create)).toBe("Type a name for the program.");
    fireEvent.change(within(sheet).getByLabelText("Program name"), { target: { value: "Push" } });
    expect(create.getAttribute("aria-describedby")).toBeNull();
  });

  it("adds a rest day", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add rest day" }));
    await waitFor(() =>
      expect(upsertCycleSlot).toHaveBeenCalledWith({ trainingCycleId: 3, orderIndex: 4, programId: null, label: "Rest" }),
    );
  });

  it("fast adds each take their own place, before the page has refreshed (round 8 B12)", async () => {
    // The writes stay open, so the slots on screen do not change between taps.
    const pending: (() => void)[] = [];
    vi.mocked(upsertCycleSlot).mockImplementation(
      () => new Promise((resolve) => pending.push(() => resolve({ success: true, data: {} as never }))),
    );
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    const rest = screen.getByRole("button", { name: "+ Add rest day" });
    fireEvent.click(rest);
    fireEvent.click(rest);
    fireEvent.click(screen.getByRole("button", { name: "+ Add session" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Pick a program" })).getByRole("button", { name: /^Lower A/ }));
    fireEvent.click(rest);
    await waitFor(() => expect(upsertCycleSlot).toHaveBeenCalledTimes(4));
    const orders = vi.mocked(upsertCycleSlot).mock.calls.map((c) => (c[0] as { orderIndex: number }).orderIndex);
    expect(orders).toEqual([4, 5, 6, 7]);
    pending.forEach((done) => done());
  });

  it("moves a session up from its options", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Lower A" }));
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(reorderCycleSlots).toHaveBeenCalledWith(3, [21, 23, 22]));
  });

  it("closes the options sheet with its Close button", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Lower A" }));
    const sheet = screen.getByRole("region", { name: "Lower A" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Lower A" })).toBeNull());
  });

  it("removes a session from its options", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Upper A" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove session" }));
    await waitFor(() => expect(removeCycleSlot).toHaveBeenCalledWith(21, 3));
  });

  it("puts Remove session at the bottom of the options sheet, under Done (round 8)", () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Upper A" }));
    const done = screen.getByRole("button", { name: "Done" });
    const remove = screen.getByRole("button", { name: "Remove session" });
    expect(done.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the drag instructions the same on every render, so the server HTML hydrates", () => {
    // dnd-kit numbers its ids from a module counter when DndContext has no id:
    // the server and the browser count differently ("DndDescribedBy-0" vs "-4").
    const describedBy = () => document.querySelector("[aria-roledescription='sortable']")?.getAttribute("aria-describedby");
    const first = render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    const a = describedBy();
    first.unmount();
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    expect(a).toBeTruthy();
    expect(describedBy()).toBe(a);
  });

  it("puts the order back when a reorder is refused", async () => {
    vi.mocked(reorderCycleSlots).mockResolvedValue({ success: false, error: "Failed to reorder the slots" });
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Lower A" }));
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed to reorder the slots"));
    const rows = within(screen.getAllByRole("list")[0]).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["1Upper A", "2Rest", "3Lower A"]);
  });
});

const week = {
  id: 4,
  scheduleType: "day_of_week",
  slots: [
    slot({ id: 31, dayOfWeek: 1, daySlot: 1, label: "Upper A", programId: 11, program: programs[0] }),
    slot({ id: 32, dayOfWeek: 7, daySlot: 1, label: "Long ride", programId: 11, program: { ...programs[0], name: "Long ride" }, priority: "key" }),
    slot({ id: 33, dayOfWeek: 7, daySlot: 2, label: "Run off bike", programId: 12, program: { ...programs[1], name: "Run off bike" } }),
  ],
} as unknown as TrainingCycleWithSlots;

describe("weekday builder", () => {
  it("shows each day's sessions, rest days, and adds a session on a day", async () => {
    render(<CycleScheduleBuilder cycle={week} programs={programs} />);
    expect(screen.getAllByText("Rest")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Add a session on Sun" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Pick a program" })).getByRole("button", { name: /Upper A/ }));
    await waitFor(() =>
      expect(upsertCycleSlot).toHaveBeenCalledWith({ trainingCycleId: 4, dayOfWeek: 7, daySlot: 3, programId: 11, label: "Upper A" }),
    );
  });

  it("a day with only a labelled slot shows its label, not Rest", () => {
    const labelled = {
      ...week,
      slots: [...week.slots, slot({ id: 35, dayOfWeek: 5, daySlot: 1, label: "Mobility" })],
    } as unknown as TrainingCycleWithSlots;
    render(<CycleScheduleBuilder cycle={labelled} programs={programs} />);
    expect(screen.getByText("Mobility")).toBeTruthy();
    expect(screen.getAllByText("Rest")).toHaveLength(4);
  });

  it("a session with its own label shows the label, not the program name", () => {
    const labelled = {
      ...week,
      slots: [slot({ id: 34, dayOfWeek: 3, daySlot: 1, label: "Legs PM", programId: 12, program: programs[1] })],
    } as unknown as TrainingCycleWithSlots;
    render(<CycleScheduleBuilder cycle={labelled} programs={programs} />);
    expect(screen.getByRole("button", { name: "Legs PM" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lower A" })).toBeNull();
  });

  it("the session sheet saves key session, brick link, auto, label and note with the endurance features on", async () => {
    render(<CycleScheduleBuilder cycle={week} programs={programs} endurance />);
    fireEvent.click(screen.getByRole("button", { name: "Run off bike" }));
    const sheet = screen.getByRole("region", { name: "Sunday · session 2" });
    expect(within(sheet).getByText("Run right after Long ride")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("switch", { name: "Key session" }));
    fireEvent.click(within(sheet).getByRole("switch", { name: "Link to the session before (brick)" }));
    fireEvent.click(within(sheet).getByRole("switch", { name: "Complete automatically" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Label and note" }));
    fireEvent.change(within(sheet).getByLabelText("Label"), { target: { value: "Brick run" } });
    fireEvent.change(within(sheet).getByLabelText("Note"), { target: { value: "Fast feet" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(upsertCycleSlot).toHaveBeenCalledTimes(2));
    expect(upsertCycleSlot).toHaveBeenNthCalledWith(1, {
      trainingCycleId: 4,
      dayOfWeek: 7,
      daySlot: 2,
      autoComplete: true,
      priority: "key",
      label: "Brick run",
      notes: "Fast feet",
    });
    expect(upsertCycleSlot).toHaveBeenNthCalledWith(2, { trainingCycleId: 4, dayOfWeek: 7, daySlot: 1, brickWithNext: true });
  });

  it("with the endurance features off the sheet has no key session, brick link or complete automatically", () => {
    render(<CycleScheduleBuilder cycle={week} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Run off bike" }));
    const sheet = screen.getByRole("region", { name: "Sunday · session 2" });
    expect(within(sheet).queryAllByRole("switch")).toHaveLength(0);
    expect(within(sheet).getByRole("button", { name: "Label and note" })).toBeTruthy();
  });

  it("Change opens the picker and saves the new program at once", async () => {
    render(<CycleScheduleBuilder cycle={week} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Upper A" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const picker = screen.getByRole("region", { name: "Pick a program" });
    expect(within(picker).getByRole("button", { name: /Upper A/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(picker).getByRole("button", { name: /Lower A/ }));
    await waitFor(() =>
      expect(upsertCycleSlot).toHaveBeenCalledWith({ trainingCycleId: 4, dayOfWeek: 1, daySlot: 1, programId: 12, label: "Lower A" }),
    );
  });

  it("Remove session removes it and a refused write shows in the sheet", async () => {
    vi.mocked(removeCycleSlot).mockResolvedValue({ success: false, error: "Failed to remove the slot" });
    render(<CycleScheduleBuilder cycle={week} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Upper A" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove session" }));
    await waitFor(() => expect(removeCycleSlot).toHaveBeenCalledWith(31, 4));
    expect(within(screen.getByRole("region", { name: "Monday · session 1" })).getByRole("alert").textContent).toBe("Failed to remove the slot");
  });
});
