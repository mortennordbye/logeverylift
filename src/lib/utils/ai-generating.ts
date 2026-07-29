/**
 * Owns the "an AI program generation is in flight" flag.
 *
 * The flag lives in localStorage because generation survives navigation — the
 * user can start it on /more/ai-setup and wander off, and the bottom nav shows
 * a pulsing dot until it finishes.
 *
 * localStorage has no same-tab change event (`storage` only fires in *other*
 * tabs), which is why BottomNav used to poll every 500ms for the app's whole
 * lifetime. Writing through this module instead emits an event, so the nav can
 * subscribe and stay idle the rest of the time.
 *
 * Every write must go through `setAiGenerating` — a raw
 * `localStorage.removeItem` leaves the dot stuck until the next reload.
 */
const KEY = "ai_generating";
const EVENT = "ai-generating-change";

export function setAiGenerating(active: boolean): void {
  if (typeof window === "undefined") return;
  if (active) {
    localStorage.setItem(KEY, Date.now().toString());
  } else {
    localStorage.removeItem(KEY);
  }
  window.dispatchEvent(new Event(EVENT));
}

export function isAiGenerating(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(KEY);
}

/** Epoch ms when generation started, or 0 if not running. */
export function aiGeneratingStartedAt(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(KEY) ?? "0", 10) || 0;
}

/** Subscribe to changes in this tab (custom event) and others (`storage`). */
export function subscribeAiGenerating(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
