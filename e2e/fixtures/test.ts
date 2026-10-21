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
      page.on("pageerror", (err) => {
        // WebKit raises this for Next.js's own RSC fetches (`?_rsc=`) when a
        // spec's page.goto cuts them off mid-flight. It is the router's
        // prefetch being cancelled by the test navigating, not app code.
        if (/\?_rsc=\S* due to access control checks/.test(err.message)) return;
        errors.push(err.stack ?? err.message);
      });
      await use();
      expect(errors, "uncaught exceptions in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
