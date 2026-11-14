// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "@/components/ui/theme-provider";
import { customAccentTokens } from "@/lib/utils/accent";

/**
 * Owner decision C (2026-11-14): the home's brand colour follows the accent.
 * The provider marks <html> with the accent; globals.css maps it to --brand.
 */

const grabbed: { api: ReturnType<typeof useTheme> | null } = { api: null };
function Grab() {
  const api = useTheme();
  useEffect(() => {
    grabbed.api = api;
  });
  return null;
}

describe("accent on <html>", () => {
  it("the stored accent after load, and a new pick at once; a custom one sets --brand-custom", () => {
    localStorage.setItem("accentColor", "green");
    render(
      <ThemeProvider>
        <Grab />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.accent).toBe("green");
    act(() => grabbed.api!.setAccentColor("orange"));
    expect(document.documentElement.dataset.accent).toBe("orange");
    act(() => grabbed.api!.setCustomAccentHex("#ff0066"));
    expect(document.documentElement.dataset.accent).toBe("custom");
    // Dark theme (the default): lightened until it reads on the home's dark surfaces (accent.ts).
    expect(document.documentElement.style.getPropertyValue("--brand-custom")).toBe(customAccentTokens("#ff0066", true)!.brand);
  });
});
