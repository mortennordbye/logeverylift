import { test as setup, expect } from "@playwright/test";
import path from "path";

const authFile = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL and E2E_USER_PASSWORD must be set to run e2e tests. " +
        "Use a test account, not a real user.",
    );
  }

  // Sign-in is rate limited, and this project runs once per suite invocation —
  // so a developer re-running the specs a few times in a row gets throttled and
  // every spec then fails on "did not navigate", as if the account were broken.
  // Retrying with backoff simply waits the window out.
  setup.setTimeout(180_000);
  await expect(async () => {
    await page.goto("/login");
    const emailField = page.getByLabel("Email");
    const passwordField = page.getByLabel("Password");
    // Re-fill until it sticks. React can mount after the fields are filled and
    // reset them to their initial empty state; the submit then fails HTML5
    // validation, no request is sent, and the only symptom is a navigation
    // timeout that reads like broken credentials.
    await expect(async () => {
      await emailField.fill(email);
      await passwordField.fill(password);
      await expect(emailField).toHaveValue(email);
      await expect(passwordField).toHaveValue(password);
    }).toPass({ timeout: 15_000 });
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL("/", { timeout: 15_000 });
  }).toPass({ timeout: 150_000, intervals: [2_000, 10_000, 20_000, 30_000] });
  // exact: the dashboard's own "Welcome to LogEveryLift" heading also contains
  // the app name, so a substring match is ambiguous on an account that still
  // sees the welcome panel and fails strict mode before login is even judged.
  await expect(
    page.getByRole("heading", { name: "LogEveryLift", exact: true }),
  ).toBeVisible();

  await page.context().storageState({ path: authFile });
});
