// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markSharePromptSeen = vi.fn();
vi.mock("@/lib/actions/onboarding", () => ({
  markSharePromptSeen: () => markSharePromptSeen(),
}));

// SharePrompt remembers within the module that it has been shown, so each
// test loads a fresh copy, the way a full page load would.
async function renderPrompt() {
  const { SharePrompt } = await import("@/components/features/SharePrompt");
  const { ToastProvider } = await import("@/contexts/toast-context");
  return render(
    <ToastProvider>
      <SharePrompt friendCode={null} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.resetModules();
  markSharePromptSeen.mockReset().mockResolvedValue({ success: true, data: undefined });
});
afterEach(() => vi.unstubAllGlobals());

describe("SharePrompt", () => {
  it("records the ask as soon as it is shown, answered or not", async () => {
    await act(async () => {
      await renderPrompt();
    });
    expect(markSharePromptSeen).toHaveBeenCalledOnce();
  });

  it("stays away when home remounts it from a cached render", async () => {
    // Home's payload is kept by the router cache, so going back to home can
    // mount the card again from a render made before the ask was recorded.
    const { SharePrompt } = await import("@/components/features/SharePrompt");
    const { ToastProvider } = await import("@/contexts/toast-context");
    const first = render(<ToastProvider><SharePrompt friendCode={null} /></ToastProvider>);
    await act(async () => screen.getByRole("button", { name: "Not now" }).click());
    first.unmount();

    render(<ToastProvider><SharePrompt friendCode={null} /></ToastProvider>);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(markSharePromptSeen).toHaveBeenCalledOnce();
  });

  it("Share opens the share sheet and closes the card", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    await renderPrompt();

    await act(async () => screen.getByRole("button", { name: "Share with a friend" }).click());

    expect(share).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a toast when the invite was copied instead", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await renderPrompt();

    await act(async () => screen.getByRole("button", { name: "Share with a friend" }).click());

    expect(screen.getByRole("status").textContent).toContain("Link copied");
  });

  it("Not now closes the card without sharing", async () => {
    const share = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, share });
    await renderPrompt();

    await act(async () => screen.getByRole("button", { name: "Not now" }).click());

    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
