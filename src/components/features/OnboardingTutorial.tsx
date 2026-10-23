"use client";

import { dismissTutorial } from "@/lib/actions/onboarding";
import { updateUserProfile } from "@/lib/actions/profile";
import { callAction } from "@/lib/utils/stale-bundle";
import { CheckCircle, ChevronLeft, Dumbbell, LayoutList, Play, RefreshCw, Smartphone, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LEGAL_PATHS } from "@/lib/constants/legal";

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
    icon: UserRound,
    title: "About you",
    body: "Optional. Used to set your starting weights and tailor your plan. You can change it any time in Account.",
  },
  {
    icon: CheckCircle,
    title: "You're All Set",
    body: "The fastest way to get started is to let AI generate your programs and weekly schedule — just describe what you're looking for.",
  },
];

const INSTALL_SLIDE = slides.findIndex((s) => s.icon === Smartphone);
const PROFILE_SLIDE = slides.findIndex((s) => s.icon === UserRound);

type Profile = { heightCm: number | null; weightKg: number | null; birthYear: number | null };

const PROFILE_FIELDS = [
  { key: "heightCm", label: "Height (cm)", inputMode: "numeric", placeholder: "175" },
  { key: "weightKg", label: "Weight (kg)", inputMode: "decimal", placeholder: "75" },
  { key: "birthYear", label: "Birth year", inputMode: "numeric", placeholder: "1990" },
] as const;

const toText = (profile: Profile) =>
  Object.fromEntries(PROFILE_FIELDS.map(({ key }) => [key, profile[key]?.toString() ?? ""])) as Record<keyof Profile, string>;

export function OnboardingTutorial({ defaultShow = false, profile }: { defaultShow?: boolean; profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [visible, setVisible] = useState(defaultShow);
  const [step, setStep] = useState(0);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const [fields, setFields] = useState(() => toText(profile));
  const [profileError, setProfileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  if (pathname === "/login" || pathname === "/signup" || LEGAL_PATHS.includes(pathname)) return null;

  async function dismiss() {
    setVisible(false);
    await dismissTutorial().catch(() => undefined);
  }

  // Saves only the fields that changed; an empty field is left as it was.
  async function saveProfile() {
    const changes: Partial<Profile> = {};
    for (const { key } of PROFILE_FIELDS) {
      const text = fields[key].trim().replace(",", ".");
      if (text === "" || Number(text) === profile[key]) continue;
      changes[key] = Number(text);
    }
    if (Object.keys(changes).length > 0) {
      setSaving(true);
      const result = await callAction(updateUserProfile(changes));
      setSaving(false);
      if (!result.success) {
        setProfileError("Couldn't save that. Check the numbers: height up to 300 cm, weight up to 500 kg, birth year from 1900.");
        return;
      }
    }
    setProfileError(null);
    next();
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
          if (delta > 0) {
            if (step === PROFILE_SLIDE) saveProfile();
            else next();
          }
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
            {step === PROFILE_SLIDE && (
              <div className="w-full max-w-xs mt-8 flex flex-col gap-3 text-left">
                {PROFILE_FIELDS.map(({ key, label, inputMode, placeholder }) => (
                  <label key={key} className="flex items-center justify-between gap-4 rounded-xl bg-muted px-4 min-h-12">
                    <span className="text-sm font-medium">{label}</span>
                    <input
                      type="text"
                      inputMode={inputMode}
                      placeholder={placeholder}
                      value={fields[key]}
                      onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-24 bg-transparent text-right text-base py-3 outline-none placeholder:text-muted-foreground/50"
                    />
                  </label>
                ))}
                {profileError && (
                  <p role="alert" className="text-sm text-destructive">
                    {profileError}
                  </p>
                )}
              </div>
            )}
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
          ) : step === PROFILE_SLIDE ? (
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={saveProfile}
                disabled={saving}
                className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-sm font-semibold active:opacity-80 disabled:opacity-60"
              >
                Save and continue
              </button>
              <button
                onClick={() => {
                  setProfileError(null);
                  next();
                }}
                className="w-full rounded-xl bg-muted text-foreground py-4 text-sm font-semibold active:opacity-80"
              >
                Skip for now
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
