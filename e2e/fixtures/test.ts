import { test as base, expect } from "@playwright/test";
import { authFile, e2eUser, signUpClientIp } from "./env";
import { closeResetPool, resetE2EUser } from "./reset";

/**
 * The `test` every spec imports. Two automatic fixtures:
 *
 * - **resetData** puts this worker's e2e account back to the seeded state
 *   before the spec, so specs are independent and order doesn't matter.
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
  // Each worker logs in as, and resets, its own account (fixtures/env.ts), so
  // specs in different workers never see each other's data.
  // `provide`, not `use`: React's hooks lint rule reads a named `use` call as a hook.
  storageState: async ({}, provide, testInfo) => {
    await provide(authFile(testInfo.parallelIndex));
  },
  // The guided player beeps through Web Audio, and WebKit has no mute flag
  // (Chromium gets --mute-audio in playwright.config.ts). Each audio context's
  // `destination` becomes a gain node at 0 in front of the real one, so the
  // app's audio code still runs in full and nothing reaches the speakers.
  //
  // Better Auth also rate limits per client IP (100 session checks per 10 s),
  // and every worker reaches the server from 127.0.0.1, so a busy run could
  // push one spec's session check into a 429. Each test's auth calls carry a
  // client IP of its own. A spec that sets its own (signup, invite) keeps it.
  context: async ({ context }, provide, testInfo) => {
    const ip = signUpClientIp(testInfo);
    await context.route("**/api/auth/**", (route) => {
      const headers = route.request().headers();
      if (headers["x-forwarded-for"]) return route.continue();
      return route.continue({ headers: { ...headers, "x-forwarded-for": ip } });
    });
    await context.addInitScript(() => {
      const Base = (window as unknown as { BaseAudioContext?: typeof BaseAudioContext }).BaseAudioContext;
      const real = Base ? Object.getOwnPropertyDescriptor(Base.prototype, "destination")?.get : undefined;
      if (!Base || !real) return;
      const silent = new WeakMap<BaseAudioContext, GainNode>();
      Object.defineProperty(Base.prototype, "destination", {
        configurable: true,
        get(this: BaseAudioContext) {
          let gain = silent.get(this);
          if (!gain) {
            gain = this.createGain();
            gain.gain.value = 0;
            gain.connect(real.call(this) as AudioDestinationNode);
            silent.set(this, gain);
          }
          return gain;
        },
      });
    });
    await provide(context);
  },
  resetData: [
    async ({}, use, testInfo) => {
      await resetE2EUser(e2eUser(testInfo.parallelIndex).email);
      await use();
    },
    { auto: true },
  ],
  failOnPageError: [
    async ({ page }, use) => {
      const errors: string[] = [];
      // WebKit reports every request a navigation cancels as an uncaught
      // "Fetch API cannot load <url> due to access control checks" (or "Cannot
      // load blob:<url> ..." for a blob read, as MapLibre does), whether or
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
        const cancelled = /(?:Fetch API cannot|Cannot) load (\S+) due to access control checks/.exec(`${err.message}\n${err.stack ?? ""}`);
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
