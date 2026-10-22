// @vitest-environment jsdom
import { SharePrompt } from "@/components/features/SharePrompt";
import { ToastProvider } from "@/contexts/toast-context";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markSharePromptSeen = vi.fn();
vi.mock("@/lib/actions/onboarding", () => ({
  markSharePromptSeen: () => markSharePromptSeen(),
}));

beforeEach(() => {
  markSharePromptSeen.mockReset().mockResolvedValue({ success: true, data: undefined });
});
afterEach(() => vi.unstubAllGlobals());

function renderPrompt() {
  render(
    <ToastProvider>
      <SharePrompt />
    </ToastProvider>,
  );
}

describe("SharePrompt", () => {
  it("Share opens the share sheet, closes the card and records the ask", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    renderPrompt();

    await act(async () => screen.getByRole("button", { name: "Share with a friend" }).click());

    expect(share).toHaveBeenCalledOnce();
    expect(markSharePromptSeen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a toast when the invite was copied instead", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    renderPrompt();

    await act(async () => screen.getByRole("button", { name: "Share with a friend" }).click());

    expect(screen.getByRole("status").textContent).toContain("Link copied");
  });

  it("Not now closes the card and records the ask without sharing", async () => {
    const share = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, share });
    renderPrompt();

    await act(async () => screen.getByRole("button", { name: "Not now" }).click());

    expect(share).not.toHaveBeenCalled();
    expect(markSharePromptSeen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
