// @vitest-environment jsdom
import { customAccentTokens, prePaintThemeScript } from "@/lib/utils/accent";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A custom accent's home tokens (review 2026-11-14, findings 2 and 3): text
 * in the brand colour and text on its fills meet 4.5:1, whatever colour is
 * picked, and the pre-paint script sets them before the first paint.
 */

const lum = (h: string) => {
  const l = [1, 3, 5].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const LIGHT = ["#f3f3f1", "#ffffff", "#efefec"];
const DARK = ["#0b0b0c", "#161618", "#222225"];

describe("customAccentTokens", () => {
  const picks = ["#ffee00", "#ffffff", "#9ef0ff", "#5b8fff", "#ff0066", "#1a1a40", "#000000", "#2457d6"];

  for (const hex of picks) {
    it(`${hex}: brand text, its fill and text on it all reach 4.5:1, light and dark`, () => {
      for (const [dark, surfaces] of [[false, LIGHT], [true, DARK]] as const) {
        const t = customAccentTokens(hex, dark)!;
        for (const s of surfaces) expect(contrast(t.brand, s), `${hex} brand on ${s}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.fill, "#ffffff"), `${hex} white on fill`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.onBrand, t.brand), `${hex} text on brand`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("dark text on a light brand, white on a dark one", () => {
    expect(customAccentTokens("#ffee00", true)!.onBrand).toBe("#0b0b0c");
    expect(customAccentTokens("#1a1a40", true)!.onBrand).toBe("#0b0b0c");
    expect(customAccentTokens("#2457d6", false)!.onBrand).toBe("#ffffff");
  });

  it("a colour that already reads is kept", () => {
    expect(customAccentTokens("#2457d6", false)).toEqual({ brand: "#2457d6", fill: "#2457d6", onBrand: "#ffffff" });
  });

  it("anything but #rrggbb gives null", () => {
    for (const bad of ["", "red", "#fff", "#12345g", "#1234567", "url(x)"]) expect(customAccentTokens(bad, false)).toBeNull();
  });
});

describe("prePaintThemeScript", () => {
  const html = document.documentElement;
  const run = () => new Function(prePaintThemeScript())();
  afterEach(() => {
    localStorage.clear();
    html.className = "";
    html.removeAttribute("style");
    delete html.dataset.accent;
  });

  it("marks the stored accent and theme", () => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("accentColor", "green");
    run();
    expect(html.dataset.accent).toBe("green");
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("dark by default, blue by default, and an unknown accent is blue", () => {
    run();
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.dataset.accent).toBe("blue");
    localStorage.setItem("accentColor", "</script>");
    run();
    expect(html.dataset.accent).toBe("blue");
  });

  it("a custom accent sets the same tokens as customAccentTokens; a bad stored value falls back to the default", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("accentColor", "custom");
    localStorage.setItem("customAccentHex", "#1a1a40");
    run();
    const t = customAccentTokens("#1a1a40", true)!;
    expect(html.dataset.accent).toBe("custom");
    expect(html.style.getPropertyValue("--brand-custom")).toBe(t.brand);
    expect(html.style.getPropertyValue("--brand-fill-custom")).toBe(t.fill);
    expect(html.style.getPropertyValue("--on-brand-custom")).toBe(t.onBrand);
    localStorage.setItem("customAccentHex", "red;color:x");
    run();
    expect(html.style.getPropertyValue("--brand-custom")).toBe(customAccentTokens("#5B8FFF", true)!.brand);
  });
});
