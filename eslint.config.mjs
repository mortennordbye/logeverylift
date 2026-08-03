import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
  // eslint-config-next 16.2 turned on the React Compiler rules. They fire on 14
  // pre-existing sites — mostly the hydrate-from-localStorage-in-an-effect
  // pattern, which is deliberate here — plus one false positive (a Date.now()
  // inside an async event handler read as a render-phase call). Demoted to warn
  // so the rules stay visible without blocking; see BACKLOG.md for the cleanup.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;
