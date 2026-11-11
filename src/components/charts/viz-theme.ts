"use client";

import { useEffect, useState } from "react";
import type { VizTheme } from "@/lib/garmin/charts/theme";

let probe: CanvasRenderingContext2D | null = null;

/**
 * Any CSS colour (the base tokens are oklch) as rgba(), which ECharts can parse:
 * paint one pixel and read it back.
 */
function toRgba(color: string): string {
  if (!color) return "rgba(0,0,0,0)";
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!probe) return color;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${Math.round((a / 255) * 100) / 100})`;
}

/** Read the --viz-* roles and the base tokens from the document, as the theme is now. */
export function readVizTheme(): VizTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => toRgba(css.getPropertyValue(name).trim());
  return {
    text: v("--foreground"),
    textMuted: v("--muted-foreground"),
    grid: v("--border"),
    surface: v("--muted"),
    sport: { swim: v("--viz-swim"), bike: v("--viz-bike"), run: v("--viz-run"), strength: v("--viz-strength"), other: v("--viz-other") },
    band: { low: v("--viz-band-low"), mid: v("--viz-band-mid"), high: v("--viz-band-high") },
    positive: v("--viz-positive"),
    negative: v("--viz-negative"),
    status: { good: v("--viz-good"), warning: v("--viz-warning"), serious: v("--viz-serious"), critical: v("--viz-critical") },
    zones: [1, 2, 3, 4, 5].map((z) => v(`--viz-zone-${z}`)),
  };
}

/** The theme, rebuilt when the html element's class (light/dark) changes. Null before mount. */
export function useVizTheme(): VizTheme | null {
  const [theme, setTheme] = useState<VizTheme | null>(null);
  useEffect(() => {
    // The theme lives in the DOM (CSS variables), so it is read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readVizTheme());
    const observer = new MutationObserver(() => setTheme(readVizTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
