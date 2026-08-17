import * as Sentry from "@sentry/nextjs";

// NEXT_PUBLIC_ prefix exposes this var to the browser bundle.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    // A navigation, reload, or app-close aborts every fetch still in flight,
    // and the rejection lands as an unhandled error with no actionable stack.
    // On a phone PWA that happens on essentially every screen change — the
    // session refetch is the usual victim — so without this filter the noisiest
    // issue in Sentry is the browser doing exactly what it should. Genuine
    // write failures don't come through here: they surface as ActionResult
    // errors and the offline queue's retry toast.
    ignoreErrors: [
      "TypeError: Load failed", // WebKit / iOS, i.e. most of this app's users
      "TypeError: Failed to fetch", // Chromium
      "TypeError: NetworkError when attempting to fetch resource.", // Firefox
      "AbortError",
      /due to access control checks/, // WebKit's wording for a cancelled request
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
