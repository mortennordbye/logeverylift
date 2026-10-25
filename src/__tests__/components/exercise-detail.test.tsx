// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PrFeedEntry } from "@/lib/actions/metrics";
import type { Exercise } from "@/types/workout";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A lifter in Oslo: a record set just after midnight belongs to that day, not
// to the UTC day before.
process.env.TZ = "Europe/Oslo";

const upsertExerciseNote = vi.fn();
vi.mock("@/lib/actions/exercises", () => ({
  upsertExerciseNote: (data: unknown) => upsertExerciseNote(data),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

const exercise = { id: 7, name: "Back Squat", category: "strength" } as Exercise;

async function renderPage(props: { note?: string | null; records?: PrFeedEntry[] } = {}) {
  const { ExerciseDetailClient } = await import("@/components/features/ExerciseDetailClient");
  const { ToastProvider } = await import("@/contexts/toast-context");
  return render(
    <ToastProvider>
      <ExerciseDetailClient
        exercise={exercise}
        note={props.note ?? null}
        progress={[]}
        records={props.records ?? []}
        history={[]}
      />
    </ToastProvider>,
  );
}

async function typeAndBlur(text: string) {
  const box = screen.getByRole("textbox", { name: "Your note" });
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.blur(box));
  return box;
}

beforeEach(() => {
  upsertExerciseNote.mockReset().mockResolvedValue({ success: true, data: undefined });
});

describe("ExerciseDetailClient note", () => {
  it("saves the trimmed note on blur", async () => {
    await renderPage();
    const box = await typeAndBlur("  Belt from 140  ");
    expect(upsertExerciseNote).toHaveBeenCalledWith({ exerciseId: 7, note: "Belt from 140" });
    expect(box).toHaveProperty("value", "Belt from 140");
  });

  it("does not save when the note is unchanged", async () => {
    await renderPage({ note: "Belt from 140" });
    await typeAndBlur("Belt from 140 ");
    expect(upsertExerciseNote).not.toHaveBeenCalled();
  });

  it("puts the saved note back and says so when the save fails", async () => {
    upsertExerciseNote.mockResolvedValue({ success: false, error: "Failed to save note" });
    await renderPage({ note: "Old" });
    const box = await typeAndBlur("New");
    expect(box).toHaveProperty("value", "Old");
    expect(screen.getByText(/Couldn't save the note/)).toBeTruthy();
  });
});

describe("ExerciseDetailClient records", () => {
  it("dates a record by the lifter's own day", async () => {
    await renderPage({
      records: [
        {
          id: 1,
          exerciseId: 7,
          exerciseName: "Back Squat",
          prType: "weight",
          value: 140,
          weightKg: null,
          discipline: null,
          distanceMeters: null,
          bracket: null,
          // 00:30 on 5 March in Oslo.
          achievedAt: "2026-03-04T23:30:00.000Z",
          isCurrent: true,
          unverified: false,
        },
      ],
    });
    expect(screen.getByText("5 Mar")).toBeTruthy();
  });
});
