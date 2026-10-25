"use client";

import { markFriendsSeen } from "@/lib/actions/friends";
import { callAction } from "@/lib/utils/stale-bundle";
import { useEffect } from "react";

/**
 * Once the Friends page is on screen, mark what it read as seen. Runs from
 * the browser, as a Server Action, so it can refresh More's cached badge count.
 */
export function MarkFriendsSeen({ at }: { at: string }) {
  useEffect(() => {
    void callAction(markFriendsSeen({ at })).catch(() => {});
  }, [at]);
  return null;
}
