"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type NetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
};

/**
 * Warms the router cache for routes the user is likely to open next.
 *
 * Gated three ways, because this runs on a phone that may be on cellular in a
 * gym basement:
 *   - `requestIdleCallback`, so it never competes with the render that just
 *     happened,
 *   - skipped entirely when the user has Data Saver on,
 *   - skipped on 2g/3g, where prefetching a route the user may not open costs
 *     more than the navigation it might save.
 *
 * Renders nothing.
 */
export function IdlePrefetch({ paths }: { paths: string[] }) {
  const router = useRouter();

  useEffect(() => {
    if (paths.length === 0) return;

    const conn = (
      navigator as Navigator & { connection?: NetworkInformation }
    ).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /(^|-)[23]g$/.test(conn.effectiveType)) return;

    const schedule =
      window.requestIdleCallback ??
      ((cb: IdleRequestCallback) =>
        window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;

    const handle = schedule(
      () => {
        for (const path of paths) router.prefetch(path);
      },
      { timeout: 2000 },
    );

    return () => cancel(handle as number);
    // `paths` is rebuilt each render by the caller; join it so the effect only
    // re-runs when the set of routes actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join("|"), router]);

  return null;
}
