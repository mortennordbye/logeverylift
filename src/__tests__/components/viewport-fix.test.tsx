// @vitest-environment jsdom
import { ViewportFix } from "@/components/features/ViewportFix";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scroll reset exists for the iOS keyboard, which only editable fields open.
 * Run on every focusout, it also moved the page while a button was being pressed:
 * pressing Save moved focus off the last button, the page jumped, the release
 * landed elsewhere, and no click fired.
 */

const blur = (el: HTMLElement) => {
  document.body.appendChild(el);
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
};

describe("ViewportFix on focusout", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: Object.assign(new EventTarget(), { height: 800, offsetTop: 0 }),
    });
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    render(<ViewportFix />);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it.each(["button", "a", "div"])("leaves the page alone when a %s loses focus", (tag) => {
    blur(document.createElement(tag));
    vi.advanceTimersByTime(400);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves the page alone when a non-typing input loses focus", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    blur(checkbox);
    vi.advanceTimersByTime(400);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "select"])("resets the page when a %s loses focus", (tag) => {
    blur(document.createElement(tag));
    vi.advanceTimersByTime(400);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("waits for a press to finish before moving the page", () => {
    document.dispatchEvent(new Event("pointerdown"));
    blur(document.createElement("textarea"));
    vi.advanceTimersByTime(400);
    expect(scrollTo).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("pointerup"));
    // Not straight away: iOS can deliver the click just after the release.
    vi.advanceTimersByTime(50);
    expect(scrollTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("gives up waiting when the release never arrives", () => {
    document.dispatchEvent(new Event("pointerdown"));
    blur(document.createElement("textarea"));
    vi.advanceTimersByTime(1200);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("does not keep waiting when the press turned into a scroll", () => {
    document.dispatchEvent(new Event("pointerdown"));
    blur(document.createElement("textarea"));
    document.dispatchEvent(new Event("pointercancel"));
    vi.advanceTimersByTime(150);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("resets the page when a contenteditable loses focus", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    blur(el);
    vi.advanceTimersByTime(400);
    expect(scrollTo).toHaveBeenCalled();
  });
});
