/**
 * PWA Web App Manifest
 *
 * Defines how the app appears when installed on a device.
 * This enables "Add to Home Screen" functionality on mobile devices.
 *
 * Key features:
 * - Standalone display mode (runs like a native app, no browser UI)
 * - Custom app name and icons
 * - Theme colors for system UI
 * - Start URL for app launch
 *
 * Installation:
 * - On iOS: Safari > Share > Add to Home Screen
 * - On Android: Chrome > Menu > Add to Home Screen
 * - On Desktop: Chrome > Install App button in address bar
 *
 * This file is automatically served at /manifest.webmanifest by Next.js
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LogEveryLift",
    short_name: "LogEveryLift",
    description:
      "Track your workouts with intelligent progress monitoring, offline-first design, and auto-deload detection.",
    start_url: "/",
    display: "standalone", // Runs like a native app
    background_color: "#ffffff",
    theme_color: "#000000",
    orientation: "portrait-primary", // Best for workout logging
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any", // Used for install prompts, splash screens, bookmarks
      },
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable", // Supports adaptive icons on Android
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    // Shortcuts for quick actions from home screen
    shortcuts: [
      {
        name: "Start Workout",
        short_name: "Workout",
        description: "Begin a new workout session",
        url: "/workout",
        icons: [
          {
            src: "/icon-192x192.png",
            sizes: "192x192",
          },
        ],
      },
    ],
  };
}
