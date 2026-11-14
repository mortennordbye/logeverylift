// @vitest-environment jsdom
import { CreateCycleForm, CycleSetupSessions } from "@/components/features/CreateCycleForm";
import { CycleScheduleBuilder, type PickerProgram } from "@/components/features/CycleScheduleBuilder";
import {
  createTrainingCycle,
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

const days: StartDays = { today: "2026-11-14", nextMonday: "2026-11-16", afterCurrent: null, latest: "2027-03-14" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createTrainingCycle).mockResolvedValue({ success: true, data: { id: 5 } as TrainingCycle });
  vi.mocked(updateTrainingCycle).mockResolvedValue({ success: true, data: { id: 5 } as TrainingCycle });
  vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: { id: 5 } as TrainingCycle });
  vi.mocked(upsertCycleSlot).mockResolvedValue({ success: true, data: {} as never });
  vi.mocked(removeCycleSlot).mockResolvedValue({ success: true, data: undefined });
  vi.mocked(reorderCycleSlots).mockResolvedValue({ success: true, data: undefined });
});

describe("step 1: the basics", () => {
  it("makes a rotation draft and opens step 2 with the start day", async () => {
    render(<CreateCycleForm days={days} />);
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Upper / Lower hypertrophy"), { target: { value: "Upper / Lower" } });
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
    fireEvent.change(screen.getByPlaceholderText("Upper / Lower hypertrophy"), { target: { value: "Odd block" } });
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const weeks = screen.getByLabelText("Length in weeks");
    fireEvent.change(weeks, { target: { value: "60" } });
    expect((screen.getByRole("button", { name: "Build the week" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(weeks, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Build the week" }));
    await waitFor(() => expect(createTrainingCycle).toHaveBeenCalledWith(expect.objectContaining({ name: "Odd block", durationWeeks: 7 })));
  });

  it("needs a day for Pick a date, and offers After current cycle only while a cycle runs", async () => {
    const { unmount } = render(<CreateCycleForm days={days} />);
    expect(screen.queryByRole("button", { name: "After current cycle" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Upper / Lower hypertrophy"), { target: { value: "Block" } });
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

  it("shows a refused write and stays on step 1", async () => {
    vi.mocked(createTrainingCycle).mockResolvedValue({ success: false, error: "Failed to create the cycle" });
    render(<CreateCycleForm days={days} />);
    fireEvent.change(screen.getByPlaceholderText("Upper / Lower hypertrophy"), { target: { value: "Block" } });
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
    expect(screen.getByRole("link", { name: "‹ Back" }).getAttribute("href")).toBe("/cycles/new?cycle=3&start=2026-11-16&step=1");
    fireEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    await waitFor(() => expect(returnTo).toHaveBeenCalledWith("/cycles/3"));
    expect(startTrainingCycle).toHaveBeenCalledWith(3, "2026-11-16");
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

  it("adds a rest day", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add rest day" }));
    await waitFor(() =>
      expect(upsertCycleSlot).toHaveBeenCalledWith({ trainingCycleId: 3, orderIndex: 4, programId: null, label: "Rest" }),
    );
  });

  it("moves a session up from its options", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Lower A" }));
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(reorderCycleSlots).toHaveBeenCalledWith(3, [21, 23, 22]));
  });

  it("removes a session from its options", async () => {
    render(<CycleScheduleBuilder cycle={rotation} programs={programs} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Upper A" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove session" }));
    await waitFor(() => expect(removeCycleSlot).toHaveBeenCalledWith(21, 3));
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
