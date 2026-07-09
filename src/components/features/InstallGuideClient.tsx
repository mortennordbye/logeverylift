"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

const STEPS = [
  {
    title: "Open this page in Safari",
    description: "This only works in Safari, not Chrome or other browsers.",
  },
  {
    title: "Tap the three dots (•••) at the bottom right",
    description: 'Tap them, then tap "Share" in the menu that appears.',
  },
  {
    title: 'Tap "View More" in the share menu',
    description: 'Scroll down in the menu until you see "View More" and tap it — this shows the full list of options.',
  },
  {
    title: 'Tap "Add to Home Screen"',
    description: 'Find "Add to Home Screen" in the list and tap it.',
  },
  {
    title: 'Tap "Add"',
    description: '"Open as Web App" is already on by default — just tap the blue "Add" button in the top-right corner. Done!',
  },
];

export function InstallGuideClient() {
  const [isStandalone, setIsStandalone] = useState<boolean | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from window.matchMedia (unavailable at SSR render)
    setIsStandalone(standalone);
  }, []);

  // Don't render anything until we know the install state (avoids flash)
  if (isStandalone === null) return null;

  if (isStandalone) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <div>
          <p className="text-xl font-bold">You&apos;re all set</p>
          <p className="text-sm text-muted-foreground mt-1">
            LogEveryLift is already installed on your Home Screen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Intro */}
      <p className="text-sm text-muted-foreground">
        You can add LogEveryLift to your iPhone Home Screen so it looks and feels just like a normal app — no browser bar, nothing extra. It only takes a minute.
      </p>

      {/* Steps */}
      <div className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <div key={i} className="bg-card rounded-2xl px-4 py-4 flex gap-4 items-start">
            <span className="text-2xl font-bold text-primary leading-none mt-0.5 w-6 shrink-0">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-sm">{step.title}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Callout */}
      <div className="bg-primary/10 rounded-2xl px-4 py-4">
        <p className="text-sm text-primary font-medium">
          That&apos;s it! From now on, open LogEveryLift by tapping its icon on your Home Screen — not through Safari.
        </p>
      </div>
    </div>
  );
}
