// @vitest-environment jsdom
import { CycleMenu, StartCycleButton } from "@/components/features/CycleDetailClient";
import { CycleScheduleBuilder } from "@/components/features/CycleScheduleBuilder";
import { deleteTrainingCycle, removeCycleSlot, restartTrainingCycle, startTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle, TrainingCycleWithSlots } from "@/types/workout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The cycle page's actions show a refused write, and starting a later season phase asks first. */

const openWorkout = "A workout from this cycle is still open. Finish or discard it first.";
vi.mock("@/lib/actions/training-cycles", () => ({
  deleteTrainingCycle: vi.fn(),
  restartTrainingCycle: vi.fn(),
  startTrainingCycle: vi.fn(),
  removeCycleSlot: vi.fn(),
  reorderCycleSlots: vi.fn(),
  upsertCycleSlot: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({ createProgram: vi.fn() }));
const returnTo = vi.fn();
vi.mock("@/components/ui/BackLink", () => ({ useReturnTo: () => returnTo }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, back: vi.fn() }) }));

const cycle = { id: 3, name: "Build", status: "draft", scheduleType: "rotation" } as unknown as TrainingCycle;

beforeEach(() => {
  vi.mocked(deleteTrainingCycle).mockReset().mockResolvedValue({ success: false, error: openWorkout });
  vi.mocked(restartTrainingCycle).mockReset().mockResolvedValue({ success: false, error: "Cycle not found" });
  vi.mocked(startTrainingCycle).mockReset().mockResolvedValue({ success: false, error: "Failed to start the cycle" });
  vi.mocked(removeCycleSlot).mockReset().mockResolvedValue({ success: false, error: "Failed to remove the slot" });
  returnTo.mockReset();
  refresh.mockReset();
});

describe("cycle actions show a refused write", () => {
  it("Delete asks in a sheet from the ⋯ menu, then shows why the cycle was not deleted and stays on the page", async () => {
    render(<CycleMenu cycle={{ ...cycle, status: "active" } as TrainingCycle} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete cycle" }));
    expect(deleteTrainingCycle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(openWorkout));
    expect(returnTo).not.toHaveBeenCalled();
  });

  it("Delete goes back to the Plan list when it works", async () => {
    vi.mocked(deleteTrainingCycle).mockResolvedValue({ success: true, data: undefined });
    render(<CycleMenu cycle={cycle} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete cycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(returnTo).toHaveBeenCalledWith("/cycles"));
    expect(deleteTrainingCycle).toHaveBeenCalledWith(3);
  });

  it("the menu links to Edit details and Change history, and a draft has no Restart", () => {
    render(<CycleMenu cycle={cycle} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("link", { name: "Edit details" }).getAttribute("href")).toBe("/cycles/3/edit");
    expect(screen.getByRole("link", { name: "Change history" }).getAttribute("href")).toBe("/cycles/3/history");
    expect(screen.queryByRole("button", { name: "Restart cycle" })).toBeNull();
  });

  it("Start shows its error", async () => {
    render(<StartCycleButton cycle={cycle} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cycle" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed to start the cycle"));
  });

  it("Restart asks in a sheet from the ⋯ menu and shows its error", async () => {
    render(<CycleMenu cycle={{ ...cycle, status: "completed" } as TrainingCycle} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart cycle" }));
    expect(screen.getByText("The cycle starts again from today, at week 1. It becomes the running cycle again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, restart" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Cycle not found"));
    expect(restartTrainingCycle).toHaveBeenCalledWith(3);
  });

  it("removing a rotation slot shows its error", async () => {
    const withSlots = {
      ...cycle,
      slots: [{ id: 9, orderIndex: 1, label: "Day 1", programId: null, program: null, autoComplete: false }],
    } as unknown as TrainingCycleWithSlots;
    render(<CycleScheduleBuilder cycle={withSlots} programs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Day 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove session" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed to remove the slot"));
  });
});

describe("starting a season phase that is not the next one", () => {
  it("asks first, names the phase and the skipped phases, and starts only on confirm", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} skippedPhases={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cycle" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    expect(screen.getByText("This starts Build today. 2 earlier phases will be skipped and the dates after it move.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Build" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });

  it("starts the next phase at once", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} skippedPhases={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cycle" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });
});

describe("a scheduled draft", () => {
  it("shows its start day and starts today on \"Start today instead\"", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} scheduledFor="2026-11-16" />);
    expect(screen.getByText("Starts Mon 16 Nov")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start cycle" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start today instead" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the out-of-order phase confirm", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} scheduledFor="2026-11-16" skippedPhases={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Start today instead" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    expect(screen.getByText("This starts Build today. 1 earlier phase will be skipped and the dates after it move.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Build" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });
});

describe("a start that ends the running cycle", () => {
  const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6 };

  it("Start today instead asks first and names the running cycle and its week", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} scheduledFor="2026-11-16" running={running} />);
    fireEvent.click(screen.getByRole("button", { name: "Start today instead" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    expect(screen.getByText(/This ends Upper \/ Lower hypertrophy at week 3 of 6\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Build" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });

  it("Start cycle asks first too, and Cancel starts nothing", () => {
    render(<StartCycleButton cycle={cycle} running={running} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cycle" }));
    expect(screen.getByText(/This ends Upper \/ Lower hypertrophy at week 3 of 6\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
  });

  it("says when the start drops another draft's scheduled start", () => {
    render(<StartCycleButton cycle={cycle} otherScheduled={{ id: 7, name: "Strength peak", day: "2026-11-23", season: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cycle" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    expect(screen.getByText(/Strength peak no longer starts Mon 23 Nov\./)).toBeTruthy();
  });

  it("says the season pauses when the start drops its next phase", () => {
    const phase = { id: 8, name: "Build 2", day: "2026-11-16", season: { id: 4, name: "Jevnaker Half 2027" } };
    render(<StartCycleButton cycle={cycle} scheduledFor="2026-11-30" otherScheduled={phase} />);
    fireEvent.click(screen.getByRole("button", { name: "Start today instead" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    expect(screen.getByText(/Jevnaker Half 2027 pauses\. Its next phase no longer starts Mon 16 Nov\. You can resume it from the season\./)).toBeTruthy();
  });

  it("a later phase of the same season does not say its own season pauses", async () => {
    const phase = { id: 8, name: "Build 2", day: "2026-11-16", season: { id: 4, name: "Jevnaker Half 2027" } };
    render(<StartCycleButton cycle={{ ...cycle, seasonId: 4 } as TrainingCycle} otherScheduled={phase} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cycle" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });

  it("Restart of another cycle names the running one", () => {
    render(<CycleMenu cycle={{ ...cycle, status: "completed" } as TrainingCycle} running={running} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart cycle" }));
    expect(screen.getByText(/This ends Upper \/ Lower hypertrophy at week 3 of 6\./)).toBeTruthy();
  });
});
