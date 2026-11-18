import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The VAPID env vars (src/lib/env.ts): optional, checked only when set, all three or none. */

const KEYS = webpush.generateVAPIDKeys();

async function load() {
  vi.resetModules();
  return import("@/lib/env");
}

beforeEach(() => {
  vi.stubEnv("SKIP_ENV_VALIDATION", "");
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
  vi.stubEnv("BETTER_AUTH_SECRET", "a-test-secret-of-enough-length");
  vi.stubEnv("VAPID_PUBLIC_KEY", undefined);
  vi.stubEnv("VAPID_PRIVATE_KEY", undefined);
  vi.stubEnv("VAPID_SUBJECT", undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("VAPID env", () => {
  it("unset: the app boots and push is off", async () => {
    const { env } = await load();
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    const { pushKeys } = await import("@/lib/push");
    expect(pushKeys()).toBeNull();
  });

  it("empty strings count as unset, so an empty secret field cannot stop the boot", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    const { env } = await load();
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    const { pushKeys } = await import("@/lib/push");
    expect(pushKeys()).toBeNull();
    // A real value with the others empty is still half a set.
    vi.stubEnv("VAPID_PUBLIC_KEY", KEYS.publicKey);
    await expect(load()).rejects.toThrow(/together/);
  });

  it("all three valid: push is on", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", KEYS.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", KEYS.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:owner@example.com");
    await load();
    const { pushKeys } = await import("@/lib/push");
    expect(pushKeys()).toEqual({ publicKey: KEYS.publicKey, privateKey: KEYS.privateKey, subject: "mailto:owner@example.com" });
  });

  it("refuses to boot on a half set or a bad key", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", KEYS.publicKey);
    await expect(load()).rejects.toThrow(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together/);
    vi.stubEnv("VAPID_PRIVATE_KEY", "short");
    vi.stubEnv("VAPID_SUBJECT", "owner@example.com");
    await expect(load()).rejects.toThrow(/VAPID_PRIVATE_KEY: must be 32 bytes[\s\S]*VAPID_SUBJECT: must start with mailto/);
  });
});
