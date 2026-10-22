"use client";

import { useToast } from "@/contexts/toast-context";
import { markSharePromptSeen } from "@/lib/actions/onboarding";
import { shareApp } from "@/lib/utils/share";
import { callAction } from "@/lib/utils/stale-bundle";
import { Share2, X } from "lucide-react";
import { useState } from "react";

/**
 * A card above the bottom nav asking the user to share the app. The loader
 * only renders it when the prompt is due; either answer records it as seen
 * so it stays away for the interval in src/lib/utils/share-prompt.ts.
 */
export function SharePrompt() {
  const [open, setOpen] = useState(true);
  const { showToast } = useToast();

  if (!open) return null;

  function close() {
    setOpen(false);
    void callAction(markSharePromptSeen());
  }

  async function handleShare() {
    close();
    if ((await shareApp(window.location.origin)) === "copied") {
      showToast({ message: "Link copied" });
    }
  }

  return (
    <div
      role="dialog"
      aria-labelledby="share-prompt-title"
      className="fixed left-0 right-0 z-40 flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-lg p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p id="share-prompt-title" className="font-bold text-base">
              Enjoying LogEveryLift?
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              If it helps your training, it might help a friend too. Send them a link.
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="-mr-2 -mt-2 w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            className="flex-1 min-h-11 flex items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            <Share2 className="w-4 h-4" />
            Share with a friend
          </button>
          <button
            onClick={close}
            className="min-h-11 px-4 rounded-xl bg-muted text-sm font-medium text-muted-foreground active:opacity-80"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
