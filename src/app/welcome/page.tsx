import { LoginForm } from "@/components/features/LoginForm";
import { shareMetadata } from "@/lib/share-metadata";
import { getOptionalSession } from "@/lib/utils/session";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

export function generateMetadata(): Promise<Metadata> {
  return shareMetadata({
    title: "LogEveryLift. Log every lift, know the next one",
    description:
      "AI-built programs, smart progression that picks your next weight and rest timers that run themselves.",
    path: "/welcome",
  });
}

const SHOT_FILES = [
  { src: "/screenshots/home.png", w: 920, h: 2000 },
  { src: "/screenshots/metrics.png", w: 920, h: 2000 },
  { src: "/screenshots/calendar.png", w: 920, h: 2000 },
  { src: "/screenshots/ai-setup.png", w: 920, h: 2000 },
];

// All visible copy on this page, per language. `?lang=no` switches to Norwegian.
const COPY = {
  en: {
    signIn: "Sign in",
    iconAlt: "LogEveryLift app icon",
    badge: "Early access is open",
    heading: ["Log every lift.", "Know the next one."],
    intro:
      "Be one of the first to train with AI-built programs and a smart progression engine that tells you exactly what to put on the bar next session.",
    cta: "Get early access",
    ctaNote: "Free while in early access. Your feedback shapes what ships next.",
    heroAlt: "Deadlift sets with next-session weight suggestions",
    welcomeBack: "Welcome back",
    welcomeBackBody: "Sign in to pick up today's workout.",
    shots: [
      { title: "Your block, on autopilot", body: "The app knows your week. One tap to start." },
      { title: "Progress you can see", body: "Top lifts and per-exercise trends." },
      { title: "Planned vs done", body: "Every cycle on one calendar." },
      { title: "AI program builder", body: "Describe your goal. Get a full plan in seconds." },
    ],
    featuresHeading: "Smarter than a notebook",
    featuresIntro: "New features land every week. Early users see them first.",
    features: [
      { title: "Smart progression", body: "Hit your reps and the engine picks your next weight. Add an effort target and it checks that too. No spreadsheets, no guessing." },
      { title: "AI-built programs", body: "Tell it your goal, days and equipment. Get a structured block you can tweak and run." },
      { title: "Rest that runs itself", body: "Timers start the moment you log a set, so you stay in the session." },
    ],
    pwaHeading: "No app store needed",
    pwaBody:
      "For now, LogEveryLift is a web app (a PWA). Add it to your home screen and it opens full screen like a native app, keeps working offline in the gym and syncs your sets when you're back online. Updates arrive automatically, nothing to download.",
    install: [
      { title: "iPhone", body: "Open the site in Safari, tap Share, then Add to Home Screen." },
      { title: "Android", body: "Open the site in Chrome, tap the menu, then Install app." },
    ],
    builtIn: "Built in Oslo",
    license: "Open source under Apache 2.0",
    privacy: "Privacy",
    terms: "Terms",
  },
  no: {
    signIn: "Logg inn",
    iconAlt: "LogEveryLift-appikon",
    badge: "Tidlig tilgang er åpen",
    heading: ["Log every lift.", "Vit hva som kommer."],
    intro:
      "Bli en av de første som trener med AI-bygde programmer og en smart progresjonsmotor som forteller deg nøyaktig hva du skal legge på stanga neste økt.",
    cta: "Få tidlig tilgang",
    ctaNote: "Gratis i perioden med tidlig tilgang. Tilbakemeldingene dine former det som kommer.",
    heroAlt: "Markløftsett med vektforslag til neste økt",
    welcomeBack: "Velkommen tilbake",
    welcomeBackBody: "Logg inn for å fortsette dagens økt.",
    shots: [
      { title: "Treningsblokken på autopilot", body: "Appen kjenner uka di. Ett trykk for å starte." },
      { title: "Fremgang du kan se", body: "Beste løft og utvikling per øvelse." },
      { title: "Planlagt mot gjennomført", body: "Alle sykluser i én kalender." },
      { title: "AI-programbygger", body: "Beskriv målet ditt. Få en komplett plan på sekunder." },
    ],
    featuresHeading: "Smartere enn en notatbok",
    featuresIntro: "Nye funksjoner kommer hver uke. De første brukerne ser dem først.",
    features: [
      { title: "Smart progresjon", body: "Treff repetisjonene, så velger motoren neste vekt. Legg til et innsatsmål, så sjekker den det også. Ingen regneark, ingen gjetting." },
      { title: "AI-bygde programmer", body: "Fortell mål, dager og utstyr. Få en strukturert blokk du kan justere og kjøre." },
      { title: "Pause som styrer seg selv", body: "Timeren starter i det du logger et sett, så du holder fokus på økta." },
    ],
    pwaHeading: "Ingen app-butikk nødvendig",
    pwaBody:
      "Foreløpig er LogEveryLift en nettapp (PWA). Legg den til på hjemskjermen, så åpnes den i fullskjerm som en vanlig app, fungerer uten nett på treningssenteret og synkroniserer settene når du er på nett igjen. Oppdateringer kommer automatisk, ingenting å laste ned.",
    install: [
      { title: "iPhone", body: "Åpne siden i Safari, trykk Del, og deretter Legg til på Hjem-skjerm." },
      { title: "Android", body: "Åpne siden i Chrome, trykk på menyen, og deretter Installer app." },
    ],
    builtIn: "Laget i Oslo",
    license: "Åpen kildekode under Apache 2.0",
    privacy: "Personvern",
    terms: "Vilkår",
  },
};

type Props = {
  searchParams: Promise<{ lang?: string }>;
};

export default async function WelcomePage({ searchParams }: Props) {
  const session = await getOptionalSession();
  if (session) redirect("/");

  const lang = (await searchParams).lang === "no" ? "no" : "en";
  const t = COPY[lang];

  return (
    // Body is position:fixed (globals.css), so the page scrolls in its own container.
    <div lang={lang === "no" ? "nb" : "en"} className="relative h-[100dvh] overflow-y-auto bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(ellipse_60%_50%_at_30%_20%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-28 lg:pb-12">
        <header className="flex h-16 items-center justify-between">
          <span className="text-xl font-extrabold tracking-tight">LogEveryLift</span>
          <nav aria-label="Language" className="flex rounded-xl border border-border p-1 text-sm font-semibold">
            {(["en", "no"] as const).map((l) => (
              <Link
                key={l}
                href={l === "no" ? "/welcome?lang=no" : "/welcome"}
                aria-current={l === lang ? "true" : undefined}
                className={`flex min-h-9 min-w-11 items-center justify-center rounded-lg px-2 active:opacity-70 ${
                  l === lang ? "bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                {l === "no" ? "NO" : "EN"}
              </Link>
            ))}
          </nav>
        </header>

        <section className="grid gap-10 pt-8 pb-14 lg:grid-cols-[1.4fr_0.8fr_1fr] lg:items-center lg:py-20">
          <div>
            <Image
              src="/icon-512x512.png"
              alt={t.iconAlt}
              width={128}
              height={128}
              priority
              className="mb-6 rounded-[29px] shadow-2xl shadow-black/60 ring-1 ring-white/10 lg:h-40 lg:w-40 lg:rounded-[36px]"
            />
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {t.badge}
            </span>
            <h1 className="text-[44px] leading-[1.02] font-extrabold tracking-tight lg:text-5xl">
              {t.heading[0]}
              <br />
              <span className="text-primary">{t.heading[1]}</span>
            </h1>
            <p className="mt-4 max-w-[36ch] text-lg text-muted-foreground">{t.intro}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground active:opacity-80"
              >
                {t.cta}
              </Link>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t.ctaNote}</p>
          </div>

          <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[36px] border border-border">
            <Image
              src="/screenshots/exercise-detail.png"
              alt={t.heroAlt}
              width={1206}
              height={2622}
              sizes="300px"
              priority
              className="block h-auto w-full"
            />
          </div>

          <div id="signin" className="rounded-3xl border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">{t.welcomeBack}</h2>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">{t.welcomeBackBody}</p>
            <LoginForm />
          </div>
        </section>

        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
          {SHOT_FILES.map((s, i) => (
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
                <span className="block font-semibold">{t.shots[i].title}</span>
                <span className="text-sm text-muted-foreground">{t.shots[i].body}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <h2 className="mt-12 mb-1 text-3xl font-bold tracking-tight">{t.featuresHeading}</h2>
        <p className="mb-5 text-muted-foreground">{t.featuresIntro}</p>
        <div className="grid gap-3 lg:grid-cols-3">
          {t.features.map((f) => (
            <div key={f.title} className="rounded-2xl bg-card p-5">
              <span className="block font-semibold">{f.title}</span>
              <span className="text-[15px] text-muted-foreground">{f.body}</span>
            </div>
          ))}
        </div>

        <section className="mt-12 rounded-3xl border border-border bg-card p-6 lg:p-8">
          <div className="flex items-center gap-4">
            <Image
              src="/icon-512x512.png"
              alt={t.iconAlt}
              width={96}
              height={96}
              className="rounded-[22px] shadow-xl shadow-black/50 ring-1 ring-white/10"
            />
            <h2 className="text-2xl font-bold tracking-tight">{t.pwaHeading}</h2>
          </div>
          <p className="mt-4 max-w-[60ch] text-muted-foreground">{t.pwaBody}</p>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {t.install.map((i) => (
              <div key={i.title} className="rounded-2xl bg-background p-5">
                <span className="block font-semibold">{i.title}</span>
                <span className="text-[15px] text-muted-foreground">{i.body}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-14 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-8 text-sm text-muted-foreground">
          <Image src="/icon-192x192.png" alt="" width={20} height={20} className="rounded-[5px]" />
          <span>LogEveryLift</span>
          <span aria-hidden>·</span>
          <span className="font-medium text-foreground">{t.builtIn}</span>
          <span aria-hidden>·</span>
          <span>{t.license}</span>
          <span aria-hidden>·</span>
          <a href="https://github.com/mortennordbye/logeverylift" className="text-primary">
            GitHub
          </a>
          <span aria-hidden>·</span>
          <Link href="/privacy" className="text-primary">
            {t.privacy}
          </Link>
          <span aria-hidden>·</span>
          <Link href="/terms" className="text-primary">
            {t.terms}
          </Link>
        </footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 flex gap-3 border-t border-border bg-background/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <Link
          href="/login"
          className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-border font-semibold active:opacity-70"
        >
          {t.signIn}
        </Link>
        <Link
          href="/signup"
          className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground active:opacity-80"
        >
          {t.cta}
        </Link>
      </nav>
    </div>
  );
}
