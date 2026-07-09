import { withSentryConfig } from "@sentry/nextjs";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

// Configure Serwist for PWA functionality
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development", // Disable in development for faster iteration
});

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  // This creates a minimal production server in .next/standalone/
  output: "standalone",

  // Explicitly enable Turbopack (Next.js 16 default)
  // Empty config silences the webpack/turbopack conflict warning
  turbopack: {},

  // Cache dynamic page payloads in the client-side router cache for 30 seconds.
  // Navigating back to a recently visited tab shows data instantly without
  // hitting the server again.
  experimental: {
    staleTimes: {
      dynamic: 30,
    },
  },
};

// Sentry build-time wrapper. Source maps upload only when SENTRY_AUTH_TOKEN is
// set; otherwise this is a no-op. Org/project read from SENTRY_ORG / SENTRY_PROJECT.
export default withSentryConfig(withSerwist(nextConfig), {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
