/**
 * Haptic feedback helpers.
 *
 * Wraps the Vibration API. iOS Safari ignores it, but PWAs installed on
 * Android (and some Chromium-based iOS PWAs via WebKit experimental APIs)
 * vibrate. The single-spot abstraction means we can later swap to a
 * native bridge or the Web Haptics API without touching call sites.
 *
 * Each named tap is calibrated for its moment:
 *   - tap     — quick acknowledgement (button press, set complete)
 *   - tick    — subtle confirm (drag-drop end, toggle)
 *   - success — celebratory pulse (PR, milestone)
 *   - warn    — destructive heads-up (delete confirmation)
 */

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  navigator.vibrate?.(pattern);
}

export const haptics = {
  tap: () => vibrate(12),
  tick: () => vibrate(8),
  success: () => vibrate([20, 40, 20]),
  warn: () => vibrate(40),
};
