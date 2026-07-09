/// <reference lib="webworker" />

/**
 * Service Worker Configuration (Serwist)
 *
 * Enables offline functionality and intelligent caching for the PWA.
 * This runs in the background, separate from the main application thread.
 *
 * Caching strategies:
 * - Static assets (JS, CSS, images): Cache first, fallback to network
 * - API routes (/api/*): Network first, fallback to cache (for offline data)
 * - Pages: Network first for fresh content
 *
 * The service worker is automatically generated from this config by Serwist.
 * It will be built to public/sw.js during the build process.
 *
 * Offline behavior:
 * - Static UI elements always available
 * - Previously viewed workout data cached
 * - New workout logging queued until online (future enhancement)
 */

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// actual precache manifest. By default, this string is set to
// `"self.__SW_MANIFEST"`.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Initialize Serwist with default caching strategies
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true, // Activate new service worker immediately
  clientsClaim: true, // Take control of all pages immediately
  navigationPreload: true, // Speed up navigation requests
  runtimeCaching: defaultCache, // Use Serwist's recommended caching strategies
});

// Register the service worker
serwist.addEventListeners();
