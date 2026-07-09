"use client";

import { dismissTutorial } from "@/lib/actions/onboarding";
import { CheckCircle, ChevronLeft, Dumbbell, LayoutList, Play, RefreshCw, Smartphone } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const slides = [
  {
    icon: Dumbbell,
    title: "Welcome to LogEveryLift",
    body: "Everything you need to track your training and build real strength over time.",
  },
  {
    icon: LayoutList,
    title: "Programs",
    body: "A program is a workout template — a list of exercises with your planned sets, reps, and weights. Build it once, use it every session.",
  },
  {
    icon: RefreshCw,
    title: "Training Cycles",
    body: "A cycle schedules your programs across the week or in rotation. It tells you what to train each day so you don't have to think about it.",
  },
  {
    icon: Play,
    title: "Your Workout",
    body: "The Workout tab shows today's scheduled session. Tap Start, log your sets as you go, then finish when you're done.",
  },
  {
    icon: Smartphone,
    title: "Add it to your iPhone",
    body: "For the best experience, add LogEveryLift to your Home Screen — it opens like a real app with no browser bar.",
  },
  {
    icon: CheckCircle,
    title: "You're All Set",
    body: "The fastest way to get started is to let AI generate your programs and weekly schedule — just describe what you're looking for.",
  },
];

const INSTALL_SLIDE = slides.findIndex((s) => s.icon === Smartphone);

export function OnboardingTutorial({ defaultShow = false }: { defaultShow?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [visible, setVisible] = useState(defaultShow);
  const [step, setStep] = useState(0);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    function handleShow() {
      setStep(0);
      setVisible(true);
      setConfirmingSkip(false);
    }
    window.addEventListener("show-onboarding", handleShow);
    return () => window.removeEventListener("show-onboarding", handleShow);
  }, []);

  if (!visible) return null;
  if (pathname === "/login" || pathname === "/signup") return null;

  async function dismiss() {
    setVisible(false);
    await dismissTutorial();
  }

  function next() {
    if (step < slides.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }

  const { icon: Icon, title, body } = slides[step];
  const isLast = step === slides.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        {step > 0 && !confirmingSkip ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="flex items-center gap-0.5 text-sm text-muted-foreground px-1 py-1 active:opacity-60 -ml-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
        ) : (
          <div />
        )}
        {!isLast && !confirmingSkip && (
          <button
            onClick={() => setConfirmingSkip(true)}
            className="text-sm text-muted-foreground px-2 py-1 active:opacity-60"
          >
            Skip
          </button>
        )}
      </div>

      {/* Slide content or skip confirmation */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-8 text-center"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null || confirmingSkip) return;
          const delta = touchStartX.current - e.changedTouches[0].clientX;
          touchStartX.current = null;
          if (Math.abs(delta) < 50) return;
          if (delta > 0) next();
          else if (step > 0) setStep((s) => s - 1);
        }}
      >
        {confirmingSkip ? (
          <>
            <p className="text-lg font-semibold mb-2">Skip the intro?</p>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mb-8">
              You can replay it anytime from Settings in the More tab.
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button
                onClick={dismiss}
                className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                Yes, skip
              </button>
              <button
                onClick={() => setConfirmingSkip(false)}
                className="w-full rounded-xl bg-muted text-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                Continue intro
              </button>
            </div>
          </>
        ) : (
          <>
            <Icon className="w-14 h-14 text-primary mb-6" strokeWidth={1.5} />
            <h1 className="text-2xl font-bold tracking-tight mb-3">{title}</h1>
            <p className="text-muted-foreground text-base leading-relaxed max-w-xs">{body}</p>
          </>
        )}
      </div>

      {/* Footer — hidden during skip confirmation (buttons are inline) */}
      {!confirmingSkip && (
        <div
          className="shrink-0 flex flex-col items-center gap-6 px-8"
          style={{ paddingBottom: "max(2.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))" }}
        >
          <div className="flex items-center gap-2">
            {slides.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {step === INSTALL_SLIDE ? (
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={async () => {
                  await dismiss();
                  router.push("/more/install");
                }}
                className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                Set it up now
              </button>
              <button
                onClick={next}
                className="w-full rounded-xl bg-muted text-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                Maybe later
              </button>
            </div>
          ) : isLast ? (
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={async () => {
                  await dismiss();
                  router.push("/more/ai-setup");
                }}
                className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                Set up with AI
              </button>
              <button
                onClick={dismiss}
                className="w-full rounded-xl bg-muted text-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                I&apos;ll do it myself
              </button>
            </div>
          ) : (
            <button
              onClick={next}
              className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-sm font-semibold active:opacity-80"
            >
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
