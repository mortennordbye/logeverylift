import { LoginForm } from "@/components/features/LoginForm";
import { getOptionalSession } from "@/lib/utils/session";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "LogEveryLift: early access to the smart training log",
  description:
    "Be one of the first to train with LogEveryLift: AI-built programs, smart progression that reads your effort, and rest timers that run themselves. Free during early access.",
};

const SHOTS = [
  { src: "/screenshots/home.png", w: 920, h: 2000, title: "Your block, on autopilot", body: "The app knows your week. One tap to start." },
  { src: "/screenshots/metrics.png", w: 920, h: 2000, title: "Progress you can see", body: "Top lifts and per-exercise trends." },
  { src: "/screenshots/calendar.png", w: 920, h: 2000, title: "Planned vs done", body: "Every cycle on one calendar." },
  { src: "/screenshots/ai-setup.png", w: 920, h: 2000, title: "AI program builder", body: "Describe your goal. Get a full plan in seconds." },
];

const FEATURES = [
  { title: "Smart progression", body: "Log how hard a set felt and the engine picks your next weight. No spreadsheets, no guessing." },
  { title: "AI-built programs", body: "Tell it your goal, days and equipment. Get a structured block you can tweak and run." },
  { title: "Rest that runs itself", body: "Timers start the moment you log a set, so you stay in the session." },
];

const INSTALL = [
  { title: "iPhone", body: "Open the site in Safari, tap Share, then Add to Home Screen." },
  { title: "Android", body: "Open the site in Chrome, tap the menu, then Install app." },
];

export default async function WelcomePage() {
  const session = await getOptionalSession();
  if (session) redirect("/");

  return (
    // Body is position:fixed (globals.css), so the page scrolls in its own container.
    <div className="relative h-[100dvh] overflow-y-auto bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(ellipse_60%_50%_at_30%_20%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-28 lg:pb-12">
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
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              Early access is open
            </span>
            <h1 className="text-[44px] leading-[1.02] font-extrabold tracking-tight lg:text-5xl">
              The training log
              <br />
              that thinks ahead.
            </h1>
            <p className="mt-4 max-w-[36ch] text-lg text-muted-foreground">
              Be one of the first to train with AI-built programs and a smart
              progression engine that tells you exactly what to put on the bar
              next session.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground active:opacity-80"
              >
                Get early access
              </Link>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Free while in early access. Your feedback shapes what ships next.
            </p>
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

        <h2 className="mt-12 mb-1 text-3xl font-bold tracking-tight">Smarter than a notebook</h2>
        <p className="mb-5 text-muted-foreground">
          New features land every week. Early users see them first.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-card p-5">
              <span className="block font-semibold">{f.title}</span>
              <span className="text-[15px] text-muted-foreground">{f.body}</span>
            </div>
          ))}
        </div>

        <section className="mt-12 rounded-3xl border border-border bg-card p-6 lg:p-8">
          <h2 className="text-2xl font-bold tracking-tight">No app store needed</h2>
          <p className="mt-2 max-w-[60ch] text-muted-foreground">
            For now, LogEveryLift is a web app (a PWA). Add it to your home
            screen and it opens full screen like a native app, keeps working
            offline in the gym and syncs your sets when you&apos;re back online.
            Updates arrive automatically, nothing to download.
          </p>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {INSTALL.map((i) => (
              <div key={i.title} className="rounded-2xl bg-background p-5">
                <span className="block font-semibold">{i.title}</span>
                <span className="text-[15px] text-muted-foreground">{i.body}</span>
              </div>
            ))}
          </div>
        </section>

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
          Get early access
        </Link>
      </nav>
    </div>
  );
}
