import { LoginForm } from "@/components/features/LoginForm";
import { getOptionalSession } from "@/lib/utils/session";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "LogEveryLift: log every lift, know the next one",
  description:
    "A workout log that runs your training block, times your rest and suggests what to lift next session. Works offline, installs to your home screen.",
};

const SHOTS = [
  { src: "/screenshots/home.png", w: 920, h: 2000, title: "Today's session", body: "Your block, your week, one tap to start." },
  { src: "/screenshots/metrics.png", w: 920, h: 2000, title: "Progress you can see", body: "Top lifts and per-exercise charts." },
  { src: "/screenshots/calendar.png", w: 920, h: 2000, title: "Planned vs done", body: "Every cycle on one calendar." },
  { src: "/screenshots/ai-setup.png", w: 920, h: 2000, title: "Program from a prompt", body: "Describe your goal, get a plan." },
];

const FEATURES = [
  { title: "Progression suggestions", body: "Hit your reps and the next weight is waiting for you." },
  { title: "Rest timers per set", body: "Starts when you log. No fiddling between sets." },
  { title: "Works offline", body: "Install it to your home screen. Bad gym signal doesn't lose sets." },
];

export default async function WelcomePage() {
  const session = await getOptionalSession();
  if (session) redirect("/");

  return (
    // Body is position:fixed (globals.css), so the page scrolls in its own container.
    <div className="h-[100dvh] overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-4 pb-28 lg:pb-12">
        <header className="flex h-16 items-center justify-between">
          <span className="text-xl font-extrabold tracking-tight">LogEveryLift</span>
          <Link
            href="/login"
            className="hidden lg:inline-flex min-h-11 items-center rounded-xl border border-border px-5 font-semibold active:opacity-70"
          >
            Sign in
          </Link>
        </header>

        <section className="grid gap-10 pt-8 pb-14 lg:grid-cols-[1.4fr_0.8fr_1fr] lg:items-center lg:py-20">
          <div>
            <h1 className="text-[44px] leading-[1.02] font-extrabold tracking-tight lg:text-5xl">
              Log every lift.
              <br />
              Know the next one.
            </h1>
            <p className="mt-4 max-w-[34ch] text-lg text-muted-foreground">
              A workout log that runs your training block, times your rest and
              tells you what to put on the bar next session.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground active:opacity-80"
              >
                Create free account
              </Link>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[36px] border border-border">
            <Image
              src="/screenshots/exercise-detail.png"
              alt="Deadlift sets with next-session weight suggestions"
              width={1206}
              height={2622}
              sizes="300px"
              priority
              className="block h-auto w-full"
            />
          </div>

          <div id="signin" className="rounded-3xl border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">Welcome back</h2>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">
              Sign in to pick up today&apos;s workout.
            </p>
            <LoginForm />
          </div>
        </section>

        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
          {SHOTS.map((s) => (
            <figure key={s.src} className="w-[70%] shrink-0 snap-start lg:w-auto">
              <Image
                src={s.src}
                alt=""
                width={s.w}
                height={s.h}
                sizes="(min-width: 1024px) 25vw, 70vw"
                className="block h-auto w-full rounded-3xl border border-border"
              />
              <figcaption className="mt-3">
                <span className="block font-semibold">{s.title}</span>
                <span className="text-sm text-muted-foreground">{s.body}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <h2 className="mt-12 mb-4 text-3xl font-bold tracking-tight">Built for the gym floor</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-card p-5">
              <span className="block font-semibold">{f.title}</span>
              <span className="text-[15px] text-muted-foreground">{f.body}</span>
            </div>
          ))}
        </div>

        <footer className="mt-14 border-t border-border pt-8 text-sm text-muted-foreground">
          LogEveryLift · Open source under Apache 2.0 ·{" "}
          <a href="https://github.com/mortennordbye/logeverylift" className="text-primary">
            GitHub
          </a>
        </footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 flex gap-3 border-t border-border bg-background/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <Link
          href="/login"
          className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-border font-semibold active:opacity-70"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground active:opacity-80"
        >
          Get started
        </Link>
      </nav>
    </div>
  );
}
