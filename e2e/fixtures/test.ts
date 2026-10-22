import { test as base, expect } from "@playwright/test";
import { closeResetPool, resetE2EUser } from "./reset";

/**
 * The `test` every spec imports. Two automatic fixtures:
 *
 * - **resetData** puts the e2e user back to the seeded state before the spec,
 *   so specs are independent and order doesn't matter.
 * - **failOnPageError** fails the spec on any uncaught exception in the page.
 *   A crash in an effect or event handler often leaves the screen looking fine
 *   while the feature behind it is dead, and no assertion about the UI notices.
 *   That is the class of bug that used to pass the suite and then break in a
 *   real workout.
 */
export const test = base.extend<{ resetData: void; failOnPageError: void }, { resetPool: void }>({
  resetPool: [
    async ({}, use) => {
      await use();
      await closeResetPool();
    },
    { scope: "worker", auto: true },
  ],
  resetData: [
    async ({}, use) => {
      await resetE2EUser();
      await use();
    },
    { auto: true },
  ],
  failOnPageError: [
    async ({ page }, use) => {
      const errors: string[] = [];
      // WebKit reports every request a navigation cancels as an uncaught
      // "Fetch API cannot load <url> due to access control checks", whether or
      // not the code that made it handles the failure (a genuinely unhandled
      // rejection shows up separately, as "Unhandled Promise Rejection"). When
      // the spec itself loaded a page just before, the cancellation is the
      // spec's doing and not a finding; so is a cancelled router read. When
      // the app cancelled one of its own writes, that is a bug: it is how the
      // set editor's router.back() killing its own write was found.
      let lastPageLoad = 0;
      page.on("request", (r) => {
        if (r.isNavigationRequest() && r.frame() === page.mainFrame()) lastPageLoad = Date.now();
      });
      page.on("pageerror", (err) => {
        // WebKit can leave this text out of `message` and put it in `stack`.
        const cancelled = /Fetch API cannot load (\S+) due to access control checks/.exec(`${err.message}\n${err.stack ?? ""}`);
        // `?_rsc=` is the router fetching a page payload: a read, nothing lost.
        if (cancelled && (cancelled[1].includes("?_rsc=") || Date.now() - lastPageLoad < 3_000)) return;
        errors.push(err.stack ?? err.message);
      });
      await use();
      expect(errors, "uncaught exceptions in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
