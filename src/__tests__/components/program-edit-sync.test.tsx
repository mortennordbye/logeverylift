// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/programs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/programs", () => ({
  createProgram: vi.fn(),
  deleteManyPrograms: vi.fn(),
  exportAllPrograms: vi.fn(),
  exportProgram: vi.fn(),
  importProgram: vi.fn(),
  removeExerciseFromProgram: vi.fn(),
  reorderProgramExercises: vi.fn(),
  updateProgram: vi.fn(),
}));
vi.mock("@/components/features/ProgramShareButton", () => ({ ProgramShareButton: () => null }));

afterEach(cleanup);

const exercise = (id: number, name: string) => ({ id, name, isTimed: false, sets: [] });

describe("ProgramDetailClient opened with ?editing=true", () => {
  it("Cancel brings back the exercises and name it opened with", async () => {
    const { ProgramDetailClient } = await import("@/components/features/ProgramDetailClient");
    render(
      <ProgramDetailClient
        programId={7}
        programName="Push"
        exercises={[exercise(1, "Bench"), exercise(2, "Dips")]}
        initialEditing
      />,
    );
    expect(replace).toHaveBeenCalledWith("/programs/7");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove exercise" })[0]);
    expect(screen.queryByText("Bench")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Bench")).toBeTruthy();
    expect(screen.getByText("Dips")).toBeTruthy();
    expect(screen.getByText("Push")).toBeTruthy();
  });
});

describe("ProgramListClient", () => {
  it("shows the new list when the server sends fresh programs", async () => {
    const { ProgramListClient } = await import("@/components/features/ProgramListClient");
    const program = (id: number, name: string) => ({ id, name }) as never;
    const { rerender } = render(<ProgramListClient programs={[program(1, "Push")]} />);
    expect(screen.getByText("Push")).toBeTruthy();

    rerender(<ProgramListClient programs={[program(1, "Push"), program(2, "Pull")]} />);
    expect(screen.getByText("Pull")).toBeTruthy();
  });
});
