import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Avoid leaking PII per CLAUDE.md — never send user input or full records.
    sendDefaultPii: false,
  });
}
