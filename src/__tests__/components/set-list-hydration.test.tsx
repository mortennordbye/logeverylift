// @vitest-environment jsdom
import { WorkoutSetsList } from "@/components/features/WorkoutSetsList";
import type { ProgramSet } from "@/types/workout";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The set list in edit mode must hydrate without a mismatch.
 *
 * The steps journey review (2026-11-16) saw a hydration error on a strength
 * exercise page in edit mode. Edit mode renders the drag handles, and each
 * handle carries dnd-kit's `aria-describedby`. Without a fixed `id` on the
 * DndContext, dnd-kit numbers that id from a module counter, which on the
 * server keeps counting across requests, so the server's id and the
 * browser's differ. Two server renders stand in for two requests here.
 */

vi.mock("@/contexts/workout-session-context", () => ({
  useWorkoutSession: () => null,
  useRenderedOverrides: () => ({}),
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(), unlogWithRetry: vi.fn() }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({ reorderProgramSets: vi.fn(), updateProgramSet: vi.fn() }));
vi.mock("@/lib/actions/workout-sets", () => ({}));

function makeSet(id: number): ProgramSet {
  return {
    id,
    programExerciseId: 9,
    setNumber: id,
    targetReps: 8,
    weightKg: "80.00",
    setType: "working",
    restTimeSeconds: 90,
    durationSeconds: null,
    distanceMeters: null,
    targetRir: null,
  } as unknown as ProgramSet;
}

const list = (
  <WorkoutSetsList sets={[makeSet(1), makeSet(2)]} programId={1} programExerciseId={9} isWorkout={false} isEditing />
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("set list hydration in edit mode", () => {
  it("hydrates the drag handles with the ids the server rendered", async () => {
    renderToString(list);
    const html = renderToString(list);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const serverIds = Array.from(container.querySelectorAll("[aria-describedby]")).map((el) =>
      el.getAttribute("aria-describedby"),
    );
    expect(serverIds.length).toBeGreaterThan(0);

    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args.join(" ")));
    await act(async () => {
      hydrateRoot(container, list, { onRecoverableError: (e) => errors.push(e) });
    });
    spy.mockRestore();

    expect(errors.filter((e) => /hydrat/i.test(String(e)))).toEqual([]);
    // Each handle names the description dnd-kit mounts in the browser.
    for (const id of serverIds) expect(document.getElementById(id!)).not.toBeNull();
  });
});
