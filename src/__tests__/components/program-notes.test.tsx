// @vitest-environment jsdom
import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Setup notes on the program's exercise page. Text the lifter typed must reach
 * the save on blur even when the screen re-renders in between: on CI the
 * nav's prefetches land just after hydration, and the controlled textarea put
 * React's empty value back over what had been typed, so nothing was saved.
 */

const updateProgramExerciseNotes = vi.fn();
vi.mock("@/lib/actions/programs", () => ({
  updateProgramExerciseNotes: (...a: unknown[]) => updateProgramExerciseNotes(...a),
  reorderProgramSets: vi.fn(),
  updateProgramSet: vi.fn(),
}));
vi.mock("@/lib/actions/workout-sets", () => ({}));
vi.mock("@/contexts/workout-session-context", () => ({
  useWorkoutSession: () => null,
  useRenderedOverrides: () => ({}),
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(), unlogWithRetry: vi.fn() }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const props = { programId: 1, programExerciseId: 9, exerciseName: "Leg Press", sets: [], isWorkout: false };

beforeEach(() => {
  updateProgramExerciseNotes.mockReset();
  updateProgramExerciseNotes.mockResolvedValue({ success: true, data: null });
});

describe("program setup notes", () => {
  it("saves text typed before a re-render the state never saw", async () => {
    const { rerender } = render(<WorkoutSetsClient {...props} />);
    const notes = screen.getByRole("textbox", { name: "Setup notes" }) as HTMLTextAreaElement;
    // The text is in the field; a re-render arrives before blur.
    notes.value = "Seat 4, feet high";
    rerender(<WorkoutSetsClient {...props} exerciseName="Leg Press " />);
    await act(async () => {
      fireEvent.blur(notes);
    });
    expect(updateProgramExerciseNotes).toHaveBeenCalledWith({ programExerciseId: 9, notes: "Seat 4, feet high" });
  });

  it("puts the saved text back when the save fails", async () => {
    updateProgramExerciseNotes.mockResolvedValue({ success: false, error: "nope" });
    render(<WorkoutSetsClient {...props} notes="Seat 3" />);
    const notes = screen.getByRole("textbox", { name: "Setup notes" }) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Seat 9" } });
    await act(async () => {
      fireEvent.blur(notes);
    });
    expect(notes.value).toBe("Seat 3");
  });
});
