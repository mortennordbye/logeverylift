import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Setup for the jsdom component tests (files with `@vitest-environment jsdom`).
 *
 * - Testing Library only registers its cleanup itself when Vitest globals are
 *   on; they are off here, so unmount after each test explicitly.
 * - Node 25+ ships its own `localStorage` global, which is undefined without a
 *   storage file and shadows jsdom's. Point the globals at jsdom's storage.
 */
afterEach(cleanup);

const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}
