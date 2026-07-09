"use client";

import { useWorkoutSession } from "@/contexts/workout-session-context";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Self-heals a dangling active-workout pointer.
 *
 * When a workout route can't find its program (it was deleted out from under the
 * persisted session), the server redirects here with `?staleWorkout=1`. We clear
 * the persisted active session so the "Workout" tab stops pointing at the dead
 * program (and its nav dot disappears), then strip the flag from the URL.
 *
 * Mounted once in the root layout; it's route-agnostic and renders nothing.
 */
export function StaleWorkoutHealer() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const session = useWorkoutSession();

  useEffect(() => {
    if (params.get("staleWorkout") !== "1") return;
    session?.clearActiveWorkout();
    router.replace(pathname); // drop the query flag, keep the user on the page
  }, [params, pathname, router, session]);

  return null;
}
