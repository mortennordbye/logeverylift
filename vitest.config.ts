import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Vitest's defaults pick up everything under `e2e/`. Those are Playwright
    // specs run separately via `pnpm test:e2e` and use the Playwright runner,
    // not Vitest — exclude them so `pnpm test` doesn't try to load them.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json"],
      include: ["src/lib/**/*.ts", "src/db/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
