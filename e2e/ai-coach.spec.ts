import { expect, test } from "./fixtures/test";

/**
 * The AI coach hub (docs/plans/ai-coach-hub.md): one More row, and the power
 * parts behind "More options". The assistant card is covered in
 * mcp-oauth.spec.ts, memory in coach-memory.spec.ts, the builder in
 * ai-setup.spec.ts.
 */

test("More has one AI row, and the hub opens the plan builder and the power pages", async ({ page }) => {
  await page.goto("/more");
  for (const gone of ["AI Setup", "Connected assistants", "Coach memory"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${gone}`) })).toHaveCount(0);
  }
  await page.getByRole("link", { name: /AI coach/ }).click();
  await expect(page).toHaveURL(/\/more\/ai-coach$/);
  await expect(page.getByRole("heading", { name: "AI coach" })).toBeVisible();
  // A user with no assistant sees no assistant card.
  await expect(page.getByRole("region", { name: "Your assistant" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /What your coach knows/ })).toBeVisible();

  const more = page.getByRole("button", { name: /More options/ });
  await expect(async () => {
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
  }).toPass({ timeout: 10_000 });

  await page.getByRole("link", { name: /Use your own AI chat/ }).click();
  await expect(page.getByRole("heading", { name: "Your own AI chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy prompt" })).toBeVisible();

  await page.goto("/more/ai-coach/connect");
  await expect(page.getByRole("heading", { name: "Connect an assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy MCP endpoint" })).toContainText("/api/mcp");
});
