import { z } from "zod";

const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const skipValidation =
  process.env.SKIP_ENV_VALIDATION === "true" ||
  process.env.SKIP_ENV_VALIDATION === "1";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16, "must be at least 16 chars"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().default("Admin"),
  SENTRY_DSN: z.string().url().optional(),
  // Stable key Next.js uses to hash Server Action IDs. When unset, Next.js
  // generates a fresh key per build, so cached client bundles can't talk to
  // freshly-deployed server pods ("Failed to find Server Action" errors).
  // Set to a stable 32-byte base64 value (`openssl rand -base64 32`) and
  // never rotate. Required in production; warned-on if missing.
  NEXT_PRIVATE_SERVER_ACTIONS_ENCRYPTION_KEY: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  if (isBuild || skipValidation) {
    // During `next build`, env vars are not all available. We trust the
    // runtime instrumentation hook + the parse below to catch issues at boot.
    // Still return a shape-compatible object so type checks stay happy.
    return envSchema.parse({
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://build:build@build:5432/build",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "build-time-placeholder-secret",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
      BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_NAME: process.env.ADMIN_NAME,
      SENTRY_DSN: process.env.SENTRY_DSN,
      NEXT_PRIVATE_SERVER_ACTIONS_ENCRYPTION_KEY:
        process.env.NEXT_PRIVATE_SERVER_ACTIONS_ENCRYPTION_KEY,
    });
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[env] Invalid or missing environment variables:\n${issues}\n\nSee .env.example for required variables.`,
    );
  }

  if (parsed.data.NODE_ENV === "production") {
    // A known/placeholder signing secret means anyone can forge sessions. Refuse
    // to boot rather than ship a publicly-known secret.
    const secret = parsed.data.BETTER_AUTH_SECRET;
    if (secret === "build-time-placeholder-secret" || secret.includes("replace-me")) {
      throw new Error(
        "[env] BETTER_AUTH_SECRET is still a placeholder in production. " +
          "Generate a real one with `openssl rand -base64 32` and set it.",
      );
    }
  }

  if (
    parsed.data.NODE_ENV === "production" &&
    !parsed.data.NEXT_PRIVATE_SERVER_ACTIONS_ENCRYPTION_KEY
  ) {
    console.warn(
      "[env] NEXT_PRIVATE_SERVER_ACTIONS_ENCRYPTION_KEY is unset in production. " +
        "Server Action IDs will be re-randomized every build, causing 'Failed to find Server Action' " +
        "errors in PWA users with cached bundles. Set a stable 32-byte base64 value " +
        "(openssl rand -base64 32) and never rotate it.",
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export function trustedOrigins(): string[] {
  const fromEnv = env.BETTER_AUTH_TRUSTED_ORIGINS
    ? env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const set = new Set<string>([env.BETTER_AUTH_URL, ...fromEnv]);
  if (env.NODE_ENV !== "production") {
    set.add("http://localhost:3000");
    set.add("http://127.0.0.1:3000");
  }
  return Array.from(set);
}
