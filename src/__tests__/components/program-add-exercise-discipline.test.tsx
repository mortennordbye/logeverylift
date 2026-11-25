// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCustomExercise = vi.fn();
vi.mock("@/lib/actions/exercises", () => ({
  createCustomExercise: (data: unknown) => createCustomExercise(data),
  deleteCustomExercise: vi.fn(),
  updateCustomExercise: vi.fn(),
}));
vi.mock("@/lib/actions/programs", () => ({ addExerciseToProgram: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

async function openNewExerciseForm(enduranceEnabled: boolean) {
  const { ProgramAddExerciseWrapper } = await import("@/components/features/ProgramAddExerciseWrapper");
  render(<ProgramAddExerciseWrapper programId={3} exercises={[]} enduranceEnabled={enduranceEnabled} />);
  // The "+" button sits next to the "Exercises" heading.
  fireEvent.click(screen.getByRole("heading", { name: "Exercises" }).nextElementSibling!);
}

beforeEach(() => {
  createCustomExercise.mockReset().mockResolvedValue({ success: true, data: { id: 1 } });
});

describe("ProgramAddExerciseWrapper custom-exercise form", () => {
  it("shows the discipline field and saves the discipline when endurance is on", async () => {
    await openNewExerciseForm(true);
    fireEvent.change(screen.getByPlaceholderText("Exercise name"), { target: { value: "Hill repeats" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Discipline" }), { target: { value: "run" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create Exercise" })));
    expect(createCustomExercise).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Hill repeats", discipline: "run" }),
    );
  });

  it("hides the discipline field when endurance is off", async () => {
    await openNewExerciseForm(false);
    expect(screen.queryByRole("combobox", { name: "Discipline" })).toBeNull();
  });
});
