"use client";

import { useEffect } from "react";

/**
 * Prevents iOS Safari from permanently shifting the app layout when the keyboard
 * appears. Three complementary techniques:
 *
 * 1. font-size ≥ 16px on all inputs (globals.css) — primary fix.
 *    iOS auto-zooms inputs with font-size < 16px, which shifts visualViewport.
 *    Keeping font-size at 16px prevents the auto-zoom entirely.
 *
 * 2. Viewport-meta zoom reset when an editable field loses focus — secondary fix.
 *    If a zoom still occurs (e.g. user pinch-zoomed), temporarily adding
 *    maximum-scale=1 forces the browser to snap zoom back to 1× before we
 *    remove the constraint, restoring the correct viewport position.
 *
 * 3. window/body scroll reset — tertiary fix.
 *    Clears any residual scrollX / scrollY and scrollLeft / scrollTop that
 *    iOS may have applied. Double-fired (immediate + 300 ms) to catch
 *    offsets iOS applies after the keyboard fully dismisses.
 *
 * 4. Focused-input scroll correction — quality-of-life fix.
 *    When the keyboard opens, the browser auto-scrolls the nearest overflow
 *    container to bring the input into view — but positions it at the bottom
 *    of the full-screen layout viewport (behind the keyboard). This corrects
 *    that scroll so the input sits 16 px above the keyboard.
 */
const PRESS_EXPIRY_MS = 1000;
const CLICK_SETTLE_MS = 100;

const NON_TYPING_INPUTS = new Set([
  "button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit",
]);

function opensKeyboard(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NON_TYPING_INPUTS.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.getAttribute("contenteditable") !== null
    && target.getAttribute("contenteditable") !== "false";
}

export function ViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // ── Helpers ──────────────────────────────────────────────────────────────

    let pressing = false;
    let resetAfterPress = false;
    let pressExpiry: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    function resetScroll() {
      // Moving the page mid-press puts the button somewhere else before the
      // release, and no click fires. Wait for the press to end.
      if (pressing) {
        resetAfterPress = true;
        return;
      }
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
    }

    /** Temporarily add maximum-scale=1 to snap any residual zoom back to 1×. */
    function resetZoom() {
      const meta = document.querySelector(
        'meta[name="viewport"]',
      ) as HTMLMetaElement | null;
      if (!meta) return;
      const original = meta.content;
      meta.content = original + ",maximum-scale=1";
      requestAnimationFrame(() => {
        meta.content = original;
      });
    }

    function findScrollableParent(el: HTMLElement): HTMLElement | null {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === "auto" || overflowY === "scroll") return node;
        node = node.parentElement;
      }
      return null;
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    /**
     * Full reset when a field that can open the keyboard loses focus. Only those:
     * pressing any button moves focus off the last one, and moving the page right
     * then puts the button somewhere else before the release, so no click fires.
     */
    function onFocusOut(e: FocusEvent) {
      if (!opensKeyboard(e.target)) return;
      resetZoom();
      requestAnimationFrame(resetScroll);
      setTimeout(resetScroll, 300);
    }

    /** Reset whenever the visual viewport scrolls (catches mid-session drift). */
    function onVVScroll() {
      resetScroll();
    }

    /**
     * Called whenever the visual viewport resizes (keyboard open or close).
     * - Keyboard close → reset zoom + scroll.
     * - Keyboard open  → scroll focused input above the keyboard.
     */
    function onViewportResize() {
      const kbHeight = Math.max(0, window.innerHeight - (vv?.height ?? window.innerHeight));

      // Keep a CSS variable in sync so BottomSheet can shift above the keyboard.
      document.documentElement.style.setProperty("--kb-height", `${kbHeight}px`);

      if (kbHeight < 50) {
        // Keyboard closed — cancel any pending scroll correction and reset offsets.
        if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
        resetZoom();
        resetScroll();
        setTimeout(resetScroll, 300);
        return;
      }

      // Keyboard opened — debounce: only the last resize event during the
      // keyboard animation fires the scroll correction. Without this, every
      // intermediate vv.resize fires a separate setTimeout, they all execute
      // ~150 ms later, and each calls scrollBy() independently — the scroll
      // amounts add up and overshoot the target (intermittent "jump" bug).
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        const el = document.activeElement as HTMLElement | null;
        if (!el || !["INPUT", "TEXTAREA"].includes(el.tagName)) return;

        const rect = el.getBoundingClientRect();
        const finalKbHeight = Math.max(0, window.innerHeight - (vv?.height ?? window.innerHeight));
        const safeBottom = window.innerHeight - finalKbHeight - 16;
        if (rect.bottom <= safeBottom) return; // already visible above keyboard

        const scrollable = findScrollableParent(el);

        // For textareas: scroll the element's TOP to 20px from the screen top.
        // iOS overlays a ~44px input toolbar at rect.top, so placing the element
        // near the top maximises the visible/usable rows below the toolbar.
        // For regular inputs: scrolling rect.bottom above the keyboard is enough.
        let scrollAmount = rect.bottom - safeBottom;
        if (el.tagName === "TEXTAREA") {
          const toTop = rect.top - 20;
          if (toTop > scrollAmount) scrollAmount = toTop;
        }

        scrollable?.scrollBy({ top: scrollAmount, behavior: "smooth" });
      }, 150);
    }

    function onPressStart() {
      pressing = true;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      // Some gestures never send a release. Don't hold the resets back forever.
      if (pressExpiry) clearTimeout(pressExpiry);
      pressExpiry = setTimeout(onPressEnd, PRESS_EXPIRY_MS);
    }

    function onPressEnd() {
      if (pressExpiry) clearTimeout(pressExpiry);
      pressExpiry = null;
      // Still pressing until the click has landed, which iOS can deliver just
      // after the release.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        pressing = false;
        if (!resetAfterPress) return;
        resetAfterPress = false;
        resetScroll();
      }, CLICK_SETTLE_MS);
    }

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    vv.addEventListener("scroll", onVVScroll);
    vv.addEventListener("resize", onViewportResize);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPressStart, true);
    document.addEventListener("pointerup", onPressEnd, true);
    document.addEventListener("pointercancel", onPressEnd, true);

    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      if (pressExpiry) clearTimeout(pressExpiry);
      if (settleTimer) clearTimeout(settleTimer);
      vv.removeEventListener("scroll", onVVScroll);
      vv.removeEventListener("resize", onViewportResize);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPressStart, true);
      document.removeEventListener("pointerup", onPressEnd, true);
      document.removeEventListener("pointercancel", onPressEnd, true);
    };
  }, []);

  return null;
}
