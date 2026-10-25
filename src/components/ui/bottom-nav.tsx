"use client";

import { useWorkoutSession } from "@/contexts/workout-session-context";
import { getFriendsBadgeCount } from "@/lib/actions/friends";
import { isAiGenerating, subscribeAiGenerating } from "@/lib/utils/ai-generating";
import { Dumbbell, MoreHorizontal, RefreshCw, LayoutList } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LEGAL_PATHS } from "@/lib/constants/legal";

const staticNavItems = [
  {
    label: "Workout",
    defaultHref: "/",
    icon: Dumbbell,
  },
  {
    label: "Cycles",
    href: "/cycles",
    icon: RefreshCw,
  },
  {
    label: "Programs",
    href: "/programs",
    icon: LayoutList,
  },
  {
    label: "More",
    href: "/more",
    icon: MoreHorizontal,
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const workoutSession = useWorkoutSession();
  const workoutPath = workoutSession?.workoutPath ?? null;
  const lastWorkoutPath = workoutSession?.lastWorkoutPath ?? null;
  const [isGenerating, setIsGenerating] = useState(false);
  const [friendsBadge, setFriendsBadge] = useState(0);

  // Only match real workout routes like /programs/[id]/workout/..., not /new-workout
  const isWorkoutRoute = pathname.startsWith("/programs") && pathname.includes("/workout");

  // Keep lastWorkoutPath in context up to date as the user navigates deeper.
  // Both effects must run on every render (Rules of Hooks); the conditional
  // null-return below them comes AFTER all hooks have been called.
  useEffect(() => {
    if (isWorkoutRoute && workoutSession) {
      workoutSession.updateLastWorkoutPath(pathname);
    }
  }, [pathname, isWorkoutRoute, workoutSession]);

  // Event-driven, not polled. This used to run setInterval(500ms) for the
  // lifetime of the app to watch a localStorage key that changes a handful of
  // times ever — a permanent wakeup on a phone. See lib/utils/ai-generating.
  useEffect(() => {
    const check = () => setIsGenerating(isAiGenerating());
    check();
    return subscribeAiGenerating(check);
  }, []);

  // Friend requests, nudges and reactions waiting on the Friends page. Checked
  // when the app opens or comes back to the foreground, and when moving
  // between More, Friends and the rest, where the count changes. On Friends
  // itself it is all on screen, so the dot is off and nothing is fetched: the
  // page marks it seen in its streamed part, which can land after this effect.
  const hideNav = pathname === "/login" || pathname === "/signup" || pathname === "/welcome" || LEGAL_PATHS.includes(pathname);
  const badgeScope = pathname === "/more" ? "more" : pathname.startsWith("/more/friends") ? "friends" : "other";
  useEffect(() => {
    if (hideNav || badgeScope === "friends") return;
    const refresh = () => {
      getFriendsBadgeCount()
        .then((r) => {
          if (r.success) setFriendsBadge(r.data);
        })
        .catch(() => {});
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hideNav, badgeScope]);

  if (hideNav) return null;

  const isActive = (label: string, href: string) => {
    if (label === "Workout") {
      return isWorkoutRoute || pathname === "/" || pathname.startsWith("/new-workout");
    }
    if (isWorkoutRoute) {
      return false; // on workout routes only the Workout tab is active
    }
    if (href === "/more") {
      return (
        pathname.startsWith("/more") ||
        pathname.startsWith("/settings") ||
        pathname.startsWith("/history") ||
        pathname.startsWith("/exercises")
      );
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {staticNavItems.map((item) => {
          const Icon = item.icon;
          // Only use saved workout paths while there's actually an active workout.
          // After discard/finish, workoutPath is null and the tab should go home.
          const href = item.label === "Workout"
            ? (workoutPath !== null ? (lastWorkoutPath ?? workoutPath) : "/")
            : (item.href ?? "/");
          const active = isActive(item.label, href);
          const showDot = item.label === "Workout" && workoutPath !== null;
          const showGeneratingDot = item.label === "More" && isGenerating;
          const showFriendsDot = item.label === "More" && !isGenerating && friendsBadge > 0 && badgeScope !== "friends";

          return (
            <Link
              key={item.label}
              href={href}
              prefetch={true}
              suppressHydrationWarning
              className={`
                flex flex-col items-center justify-center gap-1 flex-1 h-full
                transition-colors
                ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
              `}
            >
              {/* Both dots are always in the DOM, hidden by class rather than
                  conditionally rendered. They derive from client-only state
                  (the active-workout pointer and the AI-generating flag, both
                  localStorage), and this nav hydrates inside a Suspense
                  boundary, which React may hydrate *after* those effects have
                  run — so a conditional render made the client tree differ
                  structurally from the server HTML. A differing attribute is
                  suppressible; a missing child is not. */}
              <div className="relative">
                <Icon className="w-5 h-5" />
                <span
                  suppressHydrationWarning
                  className={`absolute -top-0.5 -right-1 w-1.5 h-1.5 bg-primary rounded-full${showDot ? "" : " hidden"}`}
                />
                <span
                  suppressHydrationWarning
                  className={`absolute -top-0.5 -right-1 w-1.5 h-1.5 bg-primary rounded-full animate-pulse${showGeneratingDot ? "" : " hidden"}`}
                />
                <span
                  suppressHydrationWarning
                  data-testid={item.label === "More" ? "friends-badge" : undefined}
                  className={`absolute -top-0.5 -right-1 w-2 h-2 bg-red-500 rounded-full${showFriendsDot ? "" : " hidden"}`}
                />
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
