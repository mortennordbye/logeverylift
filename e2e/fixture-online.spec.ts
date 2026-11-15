import { expect, test } from "./fixtures/test";

/**
 * The fixture keeps the browser online unless a spec calls
 * `context.setOffline` (e2e/fixtures/test.ts). A host Wi-Fi drop once made the
 * finish page queue its save while the loopback server was up, and
 * cycle-day.spec.ts read the workout as still open. Chromium's network
 * emulation over CDP stands in for the host here: it flips the browser's own
 * online state without going through `context.setOffline`.
 */
test("navigator.onLine follows context.setOffline, not the browser's own network state", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "CDP is Chromium only");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Edit home" })).toBeVisible();

  const cdp = await context.newCDPSession(page);
  const emulate = (offline: boolean) =>
    cdp.send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await emulate(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await emulate(false);

  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await context.setOffline(false);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
});
