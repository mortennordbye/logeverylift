/**
 * Runs one home widget's loader so that a failure stays inside that widget
 * (docs/home-widgets-audit.md, 6.5). Next's own signals (redirect, not found,
 * dynamic usage) are rethrown first; anything else is logged with the widget
 * id and the error's name only, and becomes the widget's error state.
 */

import { unstable_rethrow } from "next/navigation";

export type Loaded<D> = { ok: true; data: D } | { ok: false };

export async function safeLoad<D>(id: string, fn: () => Promise<D> | D): Promise<Loaded<D>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    console.error("[homeWidget] load_failed", { id, error: e instanceof Error ? e.name : "unknown" });
    return { ok: false };
  }
}
