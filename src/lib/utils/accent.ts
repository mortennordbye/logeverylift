/**
 * The home's brand tokens for a custom accent colour (owner decision C,
 * 2026-11-14; docs/home-widgets-audit.md, section 12). A picked colour can be
 * too light or too dark to read, so the tokens are derived from it:
 *
 * - `brand`: text and icons on the widget surfaces. Darkened (light theme) or
 *   lightened (dark theme) until it has 4.5:1 against every home surface.
 * - `fill`: a solid fill that carries white text (the Today hero, buttons).
 *   Darkened until white on it has 4.5:1.
 * - `onBrand`: text on `brand` used as a fill (`--primary` in `.home-ui`):
 *   white or #0b0b0c, whichever reads better on it.
 *
 * The function is self-contained (no imports, no helpers outside it): the
 * pre-paint script in src/app/layout.tsx embeds its source, so the first
 * paint already has the right colour.
 */
export function customAccentTokens(hex: string, dark: boolean): { brand: string; fill: string; onBrand: string } | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const l = c.map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const contrast = (a: number[], b: number[]) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const mix = (c: number[], to: number, t: number) => c.map((v) => v + (to - v) * t);
  // Step towards `to` until the colour reads on every surface.
  const until = (c: number[], to: number, surfaces: number[][]) => {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const m = mix(c, to, t);
      if (surfaces.every((s) => contrast(m, s) >= 4.5)) return m;
    }
    return mix(c, to, 1);
  };
  // The home surfaces in globals.css (--home-bg, --widget, --widget-2).
  const surfaces = dark ? ["#0b0b0c", "#161618", "#222225"] : ["#f3f3f1", "#ffffff", "#efefec"];
  const base = rgb(hex);
  const brand = until(base, dark ? 255 : 0, surfaces.map(rgb));
  const fill = until(base, 0, [rgb("#ffffff")]);
  const onBrand = contrast(brand, rgb("#ffffff")) >= contrast(brand, rgb("#0b0b0c")) ? "#ffffff" : "#0b0b0c";
  return { brand: toHex(brand), fill: toHex(fill), onBrand };
}

/** The default custom colour, as in the theme provider. */
export const DEFAULT_CUSTOM_ACCENT = "#5B8FFF";

/**
 * The script that runs before the first paint: the theme class, `data-accent`
 * and, for a custom accent, its tokens, read from the same localStorage keys
 * as the theme provider. Without it a non-blue accent paints blue first.
 */
export function prePaintThemeScript(): string {
  return `(function(){try{var d=document.documentElement;var t=localStorage.getItem('theme');if(t!=='light'){d.classList.add('dark')}
var a=localStorage.getItem('accentColor')||'blue';if(['blue','white','green','purple','orange','custom'].indexOf(a)<0){a='blue'}
if(a==='custom'){var f=${customAccentTokens.toString()};var k=f(localStorage.getItem('customAccentHex')||'',t!=='light')||f('${DEFAULT_CUSTOM_ACCENT}',t!=='light');
d.style.setProperty('--brand-custom',k.brand);d.style.setProperty('--brand-fill-custom',k.fill);d.style.setProperty('--on-brand-custom',k.onBrand)}
d.dataset.accent=a}catch(e){}})()`;
}
