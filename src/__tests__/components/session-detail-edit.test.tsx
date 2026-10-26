// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SessionDetail } from "@/types/workout";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateWorkoutSession = vi.fn();
vi.mock("@/lib/actions/workout-sets", () => ({
  updateWorkoutSession: (data: unknown) => updateWorkoutSession(data),
  updateLoggedSet: vi.fn(),
  deleteWorkoutSession: vi.fn(),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const detail = {
  id: 9,
  date: "2026-10-20",
  startTime: new Date("2026-10-20T17:00:00Z"),
  endTime: new Date("2026-10-20T18:00:00Z"),
  notes: null,
  feeling: null,
  isCompleted: true,
  source: "app",
  programName: "Full Body A",
  setsByExercise: [],
  reactions: [],
} as unknown as SessionDetail;

async function renderPage() {
  const { SessionDetailClient } = await import("@/components/features/SessionDetailClient");
  const { ToastProvider } = await import("@/contexts/toast-context");
  return render(
    <ToastProvider>
      <SessionDetailClient detail={detail} />
    </ToastProvider>,
  );
}

async function editNotesAndTapDone(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: text } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
}

beforeEach(() => {
  updateWorkoutSession.mockReset();
  refresh.mockReset();
});

describe("SessionDetailClient edit mode", () => {
  it("Done saves an unsaved change and leaves edit mode", async () => {
    updateWorkoutSession.mockResolvedValue({ success: true, data: undefined });
    await renderPage();
    await editNotesAndTapDone("  Felt strong ");

    expect(updateWorkoutSession).toHaveBeenCalledWith({ sessionId: 9, date: "2026-10-20", notes: "Felt strong" });
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("a failed save stays in edit mode with the change kept", async () => {
    updateWorkoutSession.mockResolvedValue({ success: false, error: "Failed to save the workout" });
    await renderPage();
    await editNotesAndTapDone("Felt strong");

    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveProperty("value", "Felt strong");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Done with nothing changed saves nothing", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));

    expect(updateWorkoutSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});
