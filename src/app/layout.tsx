import { BottomNav } from "@/components/ui/bottom-nav";
import { ImpersonationBanner } from "@/components/features/ImpersonationBanner";
import { OnboardingTutorialLoader } from "@/components/features/OnboardingTutorialLoader";
import { PageTransition } from "@/components/features/PageTransition";
import { StaleWorkoutHealer } from "@/components/features/StaleWorkoutHealer";
import { ViewportFix } from "@/components/features/ViewportFix";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { PendingQueueProvider } from "@/contexts/pending-queue-context";
import { ToastProvider } from "@/contexts/toast-context";
import { WorkoutSessionProvider } from "@/contexts/workout-session-context";
import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // "resizes-visual": the LAYOUT viewport stays full-screen (h-[100dvh] pages
  // never shrink, so no content reflow), but the VISUAL viewport shrinks to
  // exclude the keyboard. This allows visualViewport.height to reflect the
  // visible area, which our BottomSheet uses to lift above the keyboard and
  // ViewportFix uses to scroll inputs into view. The horizontal shift that
  // used to occur is prevented by font-size ≥ 16px on all inputs (globals.css),
  // which stops iOS from auto-zooming and panning the visual viewport.
  interactiveWidget: "resizes-visual",
  // Match the manifest's theme_color so the iOS Safari status bar tints to
  // the app's dark surface (not a stark white) when running standalone.
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "LogEveryLift",
  description: "Track your workouts with intelligent progress monitoring.",
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of light mode — runs before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=localStorage.getItem('theme');if(s!=='light'){document.documentElement.classList.add('dark')}})()`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased pb-nav-safe`}
      >
        <ThemeProvider>
          <div className="portrait-only-overlay fixed inset-0 z-[9999] items-center justify-center bg-background text-foreground text-base font-semibold text-center px-8">
            ↩ Rotate your phone to portrait mode
          </div>
          <ViewportFix />
          <ImpersonationBanner />
          <ToastProvider>
            <PendingQueueProvider>
              <WorkoutSessionProvider>
                <PageTransition>{children}</PageTransition>
                <BottomNav />
                <Suspense fallback={null}>
                  <OnboardingTutorialLoader />
                </Suspense>
                <Suspense fallback={null}>
                  <StaleWorkoutHealer />
                </Suspense>
              </WorkoutSessionProvider>
            </PendingQueueProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
