"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", {
      digest: error.digest,
      message: error.message,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
    Sentry.captureException(error);
  }, [error]);

  // global-error replaces the root layout, so it must render <html> and <body>.
  // Keep styling minimal/inline since the app's CSS layer may not have loaded.
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          textAlign: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: 14,
            opacity: 0.7,
            margin: "0 0 32px",
            maxWidth: 320,
          }}
        >
          The app hit a critical error and couldn&apos;t recover. Try reloading.
        </p>
        <button
          onClick={reset}
          style={{
            width: "100%",
            maxWidth: 320,
            height: 48,
            borderRadius: 12,
            border: "none",
            background: "#fafafa",
            color: "#0a0a0a",
            fontWeight: 500,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        {error.digest ? (
          <p
            style={{
              marginTop: 32,
              fontSize: 12,
              opacity: 0.5,
              fontFamily: "monospace",
            }}
          >
            ref: {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
