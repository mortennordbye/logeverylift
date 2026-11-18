// @vitest-environment jsdom
import { ToastProvider, useToast } from "@/contexts/toast-context";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * A toast never covers a screen's pinned bottom bar (the ride results' Done,
 * docs/plans/bike-ride-logger.md, final journey review): with a bar marked
 * `data-pinned-bar` on screen, the toast sits above it.
 */

function Show({ message }: { message: string }) {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast({ message })}>
      show
    </button>
  );
}

function bar(top: number) {
  const el = document.createElement("div");
  el.setAttribute("data-pinned-bar", "");
  el.getBoundingClientRect = () => ({ top, bottom: top + 80, left: 0, right: 390, width: 390, height: 80, x: 0, y: top, toJSON: () => ({}) });
  document.body.appendChild(el);
  return el;
}

describe("toast and a pinned bar", () => {
  it("sits above the pinned bar's top", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const el = bar(680);
    render(
      <ToastProvider>
        <Show message="Synced 1 pending set" />
      </ToastProvider>,
    );
    act(() => screen.getByRole("button", { name: "show" }).click());
    const toast = screen.getByRole("status");
    // 844 - 680 = 164 px from the bottom, plus an 8 px gap.
    expect(toast.style.bottom).toBe("172px");
    el.remove();
  });

  it("without a pinned bar keeps its place above the bottom nav", () => {
    render(
      <ToastProvider>
        <Show message="Saved" />
      </ToastProvider>,
    );
    act(() => screen.getByRole("button", { name: "show" }).click());
    expect(screen.getByRole("status").style.bottom).toContain("80px");
  });
});
