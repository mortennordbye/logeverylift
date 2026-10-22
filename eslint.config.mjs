import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // e2e guardrails. These are the habits that make a Playwright suite drift
  // into flakiness: fixed sleeps that a slower runner outlasts, selectors tied
  // to styling, and specs that skip the shared fixture (data reset, page-error
  // check). See TESTING.md, "End-to-end tests".
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            "Wait for a condition (expect.poll, toBeVisible, trackActions), not a fixed time. Only a deliberate timing measurement may opt out, with an eslint-disable comment saying why.",
        },
        {
          selector: "CallExpression[callee.property.name='isVisible']",
          message:
            "isVisible() answers at once and ignores its timeout, so it races whatever is still rendering. Use expect(locator).toBeVisible() or locator.waitFor(), or decide from app state.",
        },
        {
          selector: "CallExpression[callee.property.name='locator'] > Literal[value=/^[a-z]+\\.[a-z0-9-]/]",
          message:
            "Don't select by Tailwind classes; they change with styling. Use getByRole/getByText, or add a data-testid.",
        },
      ],
    },
  },
  {
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              message: "Import test and expect from ./fixtures/test: it resets the data and fails on page errors.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated artifacts:
    "drizzle/**", // drizzle-kit regenerates these from src/db/schema/
    "coverage/**", // vitest coverage output
  ]),
]);

export default eslintConfig;
