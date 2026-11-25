import { expect, test } from "./fixtures/test";

/**
 * A tab tapped the moment the tab bar is live, on a slow phone.
 *
 * React hydrates the root layout's Suspense boundaries at idle priority, one
 * by one. When the tab bar had a boundary of its own, it could be live while
 * the page's boundary still held server HTML. A tap then navigated, and React
 * later hydrated the old page's HTML (More) with the new page (Plan): React
 * #418, which the fixture fails on. CI WebKit hit it in back-nav.spec.ts.
 *
 * CPU throttling makes the gap wide enough to hit every time. It is CDP, so
 * Chromium only; the bug is in the hydration order, not in the engine.
 */
test("a tab tapped as soon as the tab bar is live navigates without a hydration error", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CPU throttling is CDP, Chromium only");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  // From inside the page: tap Plan in the first task where React has
  // hydrated the link, before anything else gets to run.
  await page.addInitScript(() => {
    const tapWhenLive = () => {
      const plan = document.querySelector<HTMLAnchorElement>('nav a[href="/cycles"]');
      if (plan && Object.keys(plan).some((k) => k.startsWith("__reactProps"))) {
        plan.click();
        return;
      }
      setTimeout(tapWhenLive, 0);
    };
    if (location.pathname === "/more") setTimeout(tapWhenLive, 0);
  });
  await page.goto("/more", { waitUntil: "commit" });
  await page.waitForURL((u) => u.pathname === "/cycles");
  // The Plan list itself, not its loading skeleton (which has the heading
  // too): React reports the mismatch when it hydrates this content.
  await expect(page.getByRole("button", { name: "New cycle or season" })).toBeVisible();
});
