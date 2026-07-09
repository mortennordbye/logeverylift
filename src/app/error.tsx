"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log digest so this client error is findable in container logs.
    console.error("[app/error]", {
      digest: error.digest,
      message: error.message,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background text-foreground flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-xs">
        We hit an unexpected error. You can retry, or head back to the home
        screen.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={reset}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-medium active:scale-95 transition-transform"
        >
          Try again
        </button>
        <Link
          href="/"
          className="w-full h-12 rounded-xl bg-muted text-foreground font-medium flex items-center justify-center active:scale-95 transition-transform"
        >
          Go home
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-8 text-xs text-muted-foreground/70 font-mono">
          ref: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
