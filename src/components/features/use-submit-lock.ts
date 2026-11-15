"use client";

import { useCallback, useRef, useState } from "react";

/**
 * A submit that runs once. `lock()` takes the lock and returns false if it is
 * already taken: the ref catches a second tap that lands before React
 * re-renders the button off. On success a form that leaves the page keeps the
 * lock, so its button stays busy until the next page is on screen; on an
 * error it calls `unlock()`.
 */
export function useSubmitLock() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const lock = useCallback(() => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    return true;
  }, []);
  const unlock = useCallback(() => {
    locked.current = false;
    setBusy(false);
  }, []);
  return { busy, lock, unlock };
}
