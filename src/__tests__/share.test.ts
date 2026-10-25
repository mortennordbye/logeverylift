import { SHARE_TEXT, shareApp } from "@/lib/utils/share";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://example.test";

function stubNavigator(nav: Partial<Navigator>) {
  vi.stubGlobal("navigator", nav);
}

afterEach(() => vi.unstubAllGlobals());

describe("shareApp", () => {
  it("opens the share sheet with the invite and the welcome page", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    expect(await shareApp(origin)).toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "LogEveryLift",
      text: SHARE_TEXT,
      url: "https://example.test/welcome",
    });
  });

  it("adds the sharer's friend code so the new account sends them a friend request", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await shareApp(origin, "abc_DEF-123");
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.test/welcome?ref=abc_DEF-123" }),
    );
  });

  it("copies the invite where there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } as unknown as Clipboard });
    expect(await shareApp(origin)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(`${SHARE_TEXT}\n\nhttps://example.test/welcome`);
  });

  it("treats closing the share sheet as cancelled, without copying", async () => {
    const writeText = vi.fn();
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")),
      clipboard: { writeText } as unknown as Clipboard,
    });
    expect(await shareApp(origin)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the share sheet is refused", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException("no gesture", "NotAllowedError")),
      clipboard: { writeText } as unknown as Clipboard,
    });
    expect(await shareApp(origin)).toBe("copied");
  });

  it("keeps the invite free of colons, semicolons and dashes", () => {
    expect(SHARE_TEXT).not.toMatch(/[:;—–]/);
  });
});
